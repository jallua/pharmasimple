"""Atomic staging and fail-closed verified publication with version/LKG manifest."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Mapping, Sequence, Union

from .normalize import ProvenanceError

logger = logging.getLogger(__name__)
DEFAULT_STAGING_DIR = Path(__file__).resolve().parent.parent / "data" / "staging"
_NON_SLUG = re.compile(r"[^a-z0-9]+")
PathLike = Union[str, Path]
MANIFEST_SCHEMA = "pharmasimple.ingestion-manifest"
MANIFEST_VERSION = "1.0.0"


def _slugify(text: str) -> str:
    return _NON_SLUG.sub("-", (text or "").lower()).strip("-")


def record_filename(record: Mapping[str, Any]) -> str:
    generic = str(record.get("genericName") or "")
    slug = _slugify(generic)
    basis = f"{record.get('sourceUrl', '')}|{generic}".encode("utf-8")
    digest = hashlib.sha1(basis).hexdigest()[:8]
    return f"{slug}-{digest}.json" if slug else f"{digest}.json"


def _reject_binaries(value: Any) -> None:
    if isinstance(value, (bytes, bytearray, memoryview)):
        raise TypeError("binary values are not allowed in staging records")
    if isinstance(value, Mapping):
        for item in value.values(): _reject_binaries(item)
    elif isinstance(value, (list, tuple)):
        for item in value: _reject_binaries(item)


def _assert_publishable(record: Mapping[str, Any]) -> None:
    if not record.get("sourceUrl"): raise ProvenanceError("record is missing a non-empty sourceUrl")
    if not record.get("retrievedDate"): raise ProvenanceError("record is missing a non-empty retrievedDate")
    _reject_binaries(record)


def serialize(record: Mapping[str, Any]) -> str:
    return json.dumps(record, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def _atomic_write(path: Path, data: bytes, *, replace: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not replace and path.exists():
        if path.read_bytes() != data:
            raise ProvenanceError(f"immutable version collision: {path.name}")
        return
    handle = tempfile.NamedTemporaryFile(mode="wb", dir=path.parent, prefix=f".{path.name}.",
                                         suffix=".tmp", delete=False)
    temporary = Path(handle.name)
    try:
        with handle:
            handle.write(data); handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def export_record(record: Mapping[str, Any], staging_dir: PathLike = DEFAULT_STAGING_DIR) -> Path:
    _assert_publishable(record)
    path = Path(staging_dir) / record_filename(record)
    _atomic_write(path, serialize(record).encode("utf-8"))
    logger.info("staged record -> %s", path)
    return path


def export_records(records, staging_dir: PathLike = DEFAULT_STAGING_DIR) -> List[Path]:
    return [export_record(record, staging_dir) for record in records]


def _manifest_path(staging: Path) -> Path:
    return staging / "version-manifest.json"


def _load_manifest(staging: Path) -> dict[str, Any]:
    path = _manifest_path(staging)
    if not path.exists():
        return {"schema": MANIFEST_SCHEMA, "schemaVersion": MANIFEST_VERSION, "records": {}}
    try: value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc: raise ProvenanceError("version manifest is unreadable") from exc
    if value.get("schema") != MANIFEST_SCHEMA or value.get("schemaVersion") != MANIFEST_VERSION or not isinstance(value.get("records"), dict):
        raise ProvenanceError("version manifest schema is invalid")
    return value


def mark_ingestion_state(record_key: str, status: str, reason: str, *,
                         staging_dir: PathLike = DEFAULT_STAGING_DIR,
                         at: datetime | None = None) -> None:
    """Record stale/blocked state without replacing the last-known-good payload."""
    if status not in {"stale", "blocked"}: raise ValueError("status must be stale or blocked")
    if not record_key or len(reason) > 500: raise ValueError("record_key/reason is invalid")
    staging = Path(staging_dir); manifest = _load_manifest(staging)
    previous = manifest["records"].get(record_key, {})
    manifest["records"][record_key] = {
        **previous, "status": status, "reason": reason,
        "stateChangedAt": (at or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    _atomic_write(_manifest_path(staging), serialize(manifest).encode("utf-8"))


def export_verified_record(record: Mapping[str, Any], staging_dir: PathLike = DEFAULT_STAGING_DIR,
                           *, max_age_days: int = 30, now: datetime | None = None,
                           registry_path: Path | None = None) -> Path:
    """Revalidate, atomically version, and promote a verified record to LKG."""
    from .verification import VerificationError, validate_verified_record
    staging = Path(staging_dir); key = record_filename(record)
    try:
        validate_verified_record(record, registry_path=registry_path)
        retrieved = [datetime.fromisoformat(str(item["retrievedAt"]).replace("Z", "+00:00"))
                     for item in record["evidence"]]
        clock = now or datetime.now(timezone.utc)
        if max_age_days < 0: raise ValueError("max_age_days must be non-negative")
    except (VerificationError, KeyError, TypeError, ValueError) as exc:
        mark_ingestion_state(key, "blocked", str(exc)[:500], staging_dir=staging, at=now)
        raise ProvenanceError(f"verified export blocked: {exc}") from exc
    if not retrieved or any((clock - value.astimezone(timezone.utc)).days > max_age_days for value in retrieved):
        mark_ingestion_state(key, "stale", "canonical evidence exceeded freshness limit",
                             staging_dir=staging, at=clock)
        raise ProvenanceError("verified evidence is stale; LKG retained")

    payload = serialize(record).encode("utf-8")
    version = hashlib.sha256(payload).hexdigest()
    version_path = staging / "versions" / key.removesuffix(".json") / f"{version}.json"
    lkg_path = staging / "lkg" / key
    current_path = staging / key
    _atomic_write(version_path, payload, replace=False)
    _atomic_write(lkg_path, payload)
    _atomic_write(current_path, payload)
    manifest = _load_manifest(staging)
    manifest["records"][key] = {
        "status": "fresh", "currentVersion": version, "lkgVersion": version,
        "currentPath": str(current_path.relative_to(staging)).replace("\\", "/"),
        "lkgPath": str(lkg_path.relative_to(staging)).replace("\\", "/"),
        "versionPath": str(version_path.relative_to(staging)).replace("\\", "/"),
        "publishedAt": (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    _atomic_write(_manifest_path(staging), serialize(manifest).encode("utf-8"))
    return current_path


def export_official_records(records: Sequence[Any], *, pipeline_version: str,
                            staging_dir: PathLike = DEFAULT_STAGING_DIR,
                            checked_at: str | datetime | None = None,
                            registry_path: Path | None = None,
                            max_age_days: int = 30) -> Path:
    """Production boundary: raw records -> conflict check -> verification -> atomic LKG."""
    from .verification import build_verified_record
    verified = build_verified_record(records, pipeline_version=pipeline_version,
                                     checked_at=checked_at, registry_path=registry_path)
    return export_verified_record(verified, staging_dir, max_age_days=max_age_days,
                                  registry_path=registry_path,
                                  now=checked_at if isinstance(checked_at, datetime) else None)



V2_MANIFEST_SCHEMA = "pharmasimple.fact-manifest"
V2_MANIFEST_VERSION = "2.0.0"


def _v2_manifest_path(root: Path) -> Path:
    return root / "fact-manifest.json"


def _load_v2_manifest(root: Path) -> dict[str, Any]:
    path = _v2_manifest_path(root)
    if not path.exists():
        return {
            "schema": V2_MANIFEST_SCHEMA,
            "schemaVersion": V2_MANIFEST_VERSION,
            "facts": {},
            "subjects": {},
        }
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProvenanceError("v2 fact manifest is unreadable") from exc
    if (value.get("schema") != V2_MANIFEST_SCHEMA or
            value.get("schemaVersion") != V2_MANIFEST_VERSION or
            not isinstance(value.get("facts"), dict) or
            not isinstance(value.get("subjects", {}), dict)):
        raise ProvenanceError("v2 fact manifest schema is invalid")
    value.setdefault("subjects", {})
    return value


def export_canonical_v2_bundle(bundle: Mapping[str, Any], records: Sequence[Any],
                               staging_dir: PathLike = DEFAULT_STAGING_DIR,
                               *, published_at: datetime | None = None,
                               promote: bool = True) -> Path:
    """Persist an audit bundle; promote only complete, independently sourced facts."""
    from .evidence_v2 import canonical_hash, validate_canonical_bundle

    documents, excerpts, facts = validate_canonical_bundle(bundle)
    incomplete = bool(bundle.get("incomplete"))
    if promote and incomplete:
        raise ProvenanceError("incomplete v2 bundle cannot be promoted")
    if not promote and not incomplete:
        raise ProvenanceError("complete v2 bundle must use the promotion path")

    subject_id = documents[0].activeIngredient.strip().casefold()
    if any(item.activeIngredient.strip().casefold() != subject_id for item in documents):
        raise ProvenanceError("v2 bundle mixes active ingredients")
    lineage_ids = sorted({item.lineageId for item in documents})
    if promote and len(lineage_ids) < 2:
        raise ProvenanceError("v2 promotion requires at least two independent document lineages")

    root = Path(staging_dir) / "v2"
    slug = _slugify(subject_id) or hashlib.sha256(subject_id.encode("utf-8")).hexdigest()[:16]
    bundle_hash = canonical_hash(bundle).removeprefix("sha256:")
    destination = root if promote else root / "quarantine" / slug / bundle_hash
    raw_objects: dict[str, bytes] = {}
    for record in records:
        raw = getattr(record, "_raw_body", None)
        if isinstance(raw, bytes):
            raw_objects[f"sha256:{hashlib.sha256(raw).hexdigest()}"] = raw
        container = getattr(record, "_container_body", None)
        if isinstance(container, bytes) and container:
            raw_objects[f"sha256:{hashlib.sha256(container).hexdigest()}"] = container

    required_hashes = {document.rawSha256 for document in documents}
    required_hashes.update(
        step.inputSha256 for document in documents for step in document.transformations
    )
    missing = required_hashes - set(raw_objects)
    if missing:
        raise ProvenanceError(f"v2 evidence object bytes are missing: {sorted(missing)}")
    for digest in sorted(required_hashes):
        object_path = destination / "evidence" / "objects" / f"{digest.removeprefix('sha256:')}.bin"
        _atomic_write(object_path, raw_objects[digest], replace=False)
    for document in documents:
        path = destination / "evidence" / "documents" / f"{document.evidenceId}.json"
        _atomic_write(path, serialize(document.as_dict()).encode("utf-8"), replace=False)
    for excerpt in excerpts:
        path = destination / "evidence" / "excerpts" / f"{excerpt.excerptId}.json"
        _atomic_write(path, serialize(excerpt.as_dict()).encode("utf-8"), replace=False)

    payload = serialize(bundle).encode("utf-8")
    if not promote:
        for fact in facts:
            path = destination / "facts" / f"{fact.factId}.json"
            _atomic_write(path, serialize(fact.as_dict()).encode("utf-8"), replace=False)
        quarantine_path = destination / "bundle.json"
        _atomic_write(quarantine_path, payload, replace=False)
        return quarantine_path

    version_path = root / "bundles" / "versions" / slug / f"{bundle_hash}.json"
    current_bundle_path = root / "bundles" / "current" / f"{slug}.json"
    _atomic_write(version_path, payload, replace=False)
    _atomic_write(current_bundle_path, payload)

    manifest = _load_v2_manifest(root)
    clock = (published_at or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    active_fact_ids = sorted(fact.factId for fact in facts)
    previous_subject = manifest["subjects"].get(subject_id, {})
    for retired_id in set(previous_subject.get("activeFactIds", [])) - set(active_fact_ids):
        previous = manifest["facts"].get(retired_id, {})
        current_path_value = previous.get("currentPath")
        if isinstance(current_path_value, str):
            expected_current_path = f"facts/current/{retired_id}.json"
            if current_path_value != expected_current_path:
                raise ProvenanceError(f"unsafe current fact path for retirement: {retired_id}")
            (root / expected_current_path).unlink(missing_ok=True)
        manifest["facts"][retired_id] = {
            **previous,
            "status": "retired",
            "active": False,
            "stateChangedAt": clock,
        }

    for fact in facts:
        fact_payload = serialize(fact.as_dict()).encode("utf-8")
        version = fact.resolutionHash.removeprefix("sha256:")
        fact_version_path = root / "facts" / "versions" / fact.factId / f"{version}.json"
        _atomic_write(fact_version_path, fact_payload, replace=False)
        previous = manifest["facts"].get(fact.factId, {})
        state = {
            **previous,
            "status": fact.status,
            "active": True,
            "subjectId": subject_id,
            "bundleHash": bundle_hash,
            "currentVersion": version,
            "versionPath": str(fact_version_path.relative_to(root)).replace("\\", "/"),
            "stateChangedAt": clock,
        }
        if fact.status == "verified":
            current_fact_path = root / "facts" / "current" / f"{fact.factId}.json"
            lkg_path = root / "facts" / "lkg" / f"{fact.factId}.json"
            _atomic_write(current_fact_path, fact_payload)
            _atomic_write(lkg_path, fact_payload)
            state.update({
                "lkgVersion": version,
                "currentPath": str(current_fact_path.relative_to(root)).replace("\\", "/"),
                "lkgPath": str(lkg_path.relative_to(root)).replace("\\", "/"),
            })
        else:
            (root / "facts" / "current" / f"{fact.factId}.json").unlink(missing_ok=True)
            state.pop("currentPath", None)
        manifest["facts"][fact.factId] = state

    manifest["subjects"][subject_id] = {
        "status": "complete",
        "activeFactIds": active_fact_ids,
        "verifiedFactIds": sorted(fact.factId for fact in facts if fact.status == "verified"),
        "lineageIds": lineage_ids,
        "bundleHash": bundle_hash,
        "currentBundlePath": str(current_bundle_path.relative_to(root)).replace("\\", "/"),
        "publishedAt": clock,
    }
    _atomic_write(_v2_manifest_path(root), serialize(manifest).encode("utf-8"))
    return current_bundle_path
