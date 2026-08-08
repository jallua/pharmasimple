"""Fail-closed verification for canonical official-source evidence."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Mapping, Sequence
from urllib.parse import urlsplit

from .evidence import (
    CanonicalEvidence, EvidenceError, raw_sha256, reconcile_official_records,
    validate_evidence_bundle,
)

_DEFAULT_REGISTRY = Path(__file__).resolve().parents[2] / "src" / "data" / "official-sources.json"


class VerificationError(ValueError):
    """Raised when evidence is inconsistent, stale, unknown, or untrusted."""


def _registry_path() -> Path:
    configured = os.environ.get("PHARMA_SOURCE_REGISTRY")
    return Path(configured).resolve() if configured else _DEFAULT_REGISTRY


def load_source_registry(path: Path | None = None) -> Dict[str, Any]:
    registry_path = path or _registry_path()
    try:
        document = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise VerificationError(f"cannot load source registry: {registry_path}") from exc
    if not isinstance(document.get("version"), str) or not document["version"]:
        raise VerificationError("official source registry has no version")
    sources = document.get("sources")
    if not isinstance(sources, list) or not sources:
        raise VerificationError("official source registry has no sources")
    return document


def _host(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise VerificationError(f"official evidence requires a clean HTTPS URL: {url!r}")
    return parsed.hostname.lower().removeprefix("www.")


def _host_matches(host: str, allowed: str) -> bool:
    base = allowed.lower().removeprefix("www.")
    return host == base or host.endswith(f".{base}")


def _validate_sources(items: Sequence[CanonicalEvidence], registry: Mapping[str, Any]) -> None:
    indexed = {str(source.get("id")): source for source in registry["sources"]}
    for item in items:
        source = indexed.get(item.sourceId)
        if not source or source.get("authoritative") is not True:
            raise VerificationError(f"unknown/non-authoritative sourceId: {item.sourceId!r}")
        host = _host(item.sourceUrl)
        if not any(_host_matches(host, str(value)) for value in source.get("allowedHosts", [])):
            raise VerificationError(f"sourceId {item.sourceId!r} does not allow host {host!r}")


def _iso_datetime(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text: raise VerificationError(f"{field} is required")
    try: parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc: raise VerificationError(f"{field} must be ISO-8601") from exc
    if parsed.tzinfo is None: raise VerificationError(f"{field} must include timezone")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _bundle_hash(items: Sequence[CanonicalEvidence]) -> str:
    body = json.dumps([item.as_dict() for item in items], ensure_ascii=False,
                      sort_keys=True, separators=(",", ":")).encode("utf-8")
    return raw_sha256(body)


def verify_record(record: Mapping[str, Any], evidence: Sequence[Mapping[str, Any]] | None = None,
                  *, pipeline_version: str, checked_at: str | datetime | None = None,
                  registry_path: Path | None = None) -> Dict[str, Any]:
    """Validate claims and issue a verification stamp; never trust a supplied stamp."""
    if not isinstance(pipeline_version, str) or not pipeline_version.strip():
        raise VerificationError("pipeline_version is required")
    candidate = dict(record)
    if evidence is not None: candidate["evidence"] = list(evidence)
    try: items = validate_evidence_bundle(candidate)
    except EvidenceError as exc: raise VerificationError(str(exc)) from exc
    registry = load_source_registry(registry_path); _validate_sources(items, registry)
    now = checked_at or datetime.now(timezone.utc)
    if isinstance(now, date) and not isinstance(now, datetime):
        now = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    checked = now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if isinstance(now, datetime) else _iso_datetime(now, "checked_at")
    candidate["evidence"] = [item.as_dict() for item in items]
    checked_datetime = datetime.fromisoformat(checked.replace("Z", "+00:00"))
    candidate["verification"] = {
        "status": "verified", "checkedAt": checked,
        "nextCheckAt": (checked_datetime + timedelta(days=30)).isoformat().replace("+00:00", "Z"),
        "pipelineVersion": pipeline_version,
        "registryVersion": registry["version"],
        "evidenceBundleHash": _bundle_hash(items),
    }
    return candidate


def validate_verified_record(record: Mapping[str, Any], *, registry_path: Path | None = None) -> None:
    """Recompute every export-time invariant instead of trusting status fields."""
    verification = record.get("verification")
    if not isinstance(verification, Mapping) or verification.get("status") != "verified":
        raise VerificationError("automatic publication requires verified state")
    if not str(verification.get("pipelineVersion") or "").strip():
        raise VerificationError("verification has no pipeline version")
    _iso_datetime(verification.get("checkedAt"), "verification.checkedAt")
    try: items = validate_evidence_bundle(record)
    except EvidenceError as exc: raise VerificationError(str(exc)) from exc
    registry = load_source_registry(registry_path); _validate_sources(items, registry)
    if verification.get("registryVersion") != registry.get("version"):
        raise VerificationError("verification registry version is stale")
    if verification.get("evidenceBundleHash") != _bundle_hash(items):
        raise VerificationError("verification evidence bundle hash mismatch")


def build_verified_record(records: Sequence[Any], *, pipeline_version: str,
                          checked_at: str | datetime | None = None,
                          registry_path: Path | None = None) -> Dict[str, Any]:
    """Reconcile raw official records and verify their canonical evidence."""
    try: candidate = reconcile_official_records(records)
    except EvidenceError as exc: raise VerificationError(str(exc)) from exc
    return verify_record(candidate, pipeline_version=pipeline_version,
                         checked_at=checked_at, registry_path=registry_path)


def evidence_hash(body: bytes) -> str:
    return raw_sha256(body)
