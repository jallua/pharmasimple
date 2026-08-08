"""Canonical evidence schema and fail-closed cross-source reconciliation."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Sequence

SCHEMA_ID = "pharmasimple.canonical-evidence"
SCHEMA_VERSION = "1.0.0"
PARSER_VERSION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA256_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")
CLAIM_PATHS = (
    "/company", "/genericName", "/brandName", "/drugClass",
    "/indications", "/targetHints",
)
SOURCE_IDS = {
    "fda-openfda-drug-label": "us-fda",
    "dailymed-spl-v2": "us-dailymed",
    "ema-medicine-epar": "eu-ema",
    "nmpa-official-page": "cn-nmpa",
}


class EvidenceError(ValueError):
    """Canonical evidence is missing, malformed, or detached from its claim."""


class CrossSourceConflictError(EvidenceError):
    """Official sources assert different values for the same canonical claim."""


def raw_sha256(raw: bytes) -> str:
    if not isinstance(raw, bytes):
        raise TypeError("raw evidence must be bytes")
    return f"sha256:{hashlib.sha256(raw).hexdigest()}"


def _iso_utc(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise EvidenceError("retrievedAt must be ISO-8601") from exc
    if parsed.tzinfo is None:
        raise EvidenceError("retrievedAt must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _canonical_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise EvidenceError("claimValue must be JSON-serializable") from exc


def value_at_path(record: Mapping[str, Any], path: str) -> Any:
    if path not in CLAIM_PATHS:
        raise EvidenceError(f"unsupported canonical claim path: {path!r}")
    key = path[1:]
    if key not in record:
        raise EvidenceError(f"claim path is absent from record: {path!r}")
    return record[key]


@dataclass(frozen=True)
class CanonicalEvidence:
    claimPath: str
    claimValue: Any
    sourceId: str
    sourceUrl: str
    documentId: str
    documentVersion: str
    retrievedAt: str
    parserVersion: str
    rawSha256: str
    schema: str = SCHEMA_ID
    schemaVersion: str = SCHEMA_VERSION

    @classmethod
    def from_raw(cls, *, raw: bytes, **fields: Any) -> "CanonicalEvidence":
        return cls(rawSha256=raw_sha256(raw), **fields).validated(raw=raw)

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "CanonicalEvidence":
        names = {field.name for field in cls.__dataclass_fields__.values()}
        unknown = set(value) - names
        if unknown:
            raise EvidenceError(f"unknown evidence fields: {', '.join(sorted(unknown))}")
        try:
            return cls(**dict(value)).validated()
        except TypeError as exc:
            raise EvidenceError("canonical evidence fields are incomplete") from exc

    def validated(self, *, raw: bytes | None = None) -> "CanonicalEvidence":
        if self.schema != SCHEMA_ID or self.schemaVersion != SCHEMA_VERSION:
            raise EvidenceError("unsupported canonical evidence schema/version")
        if self.claimPath not in CLAIM_PATHS:
            raise EvidenceError(f"unsupported canonical claim path: {self.claimPath!r}")
        _canonical_json(self.claimValue)
        for name in ("sourceId", "sourceUrl", "documentId", "documentVersion"):
            if not isinstance(getattr(self, name), str) or not getattr(self, name).strip():
                raise EvidenceError(f"{name} is required")
        if not self.sourceUrl.startswith("https://"):
            raise EvidenceError("sourceUrl must use HTTPS")
        _iso_utc(self.retrievedAt)
        if not isinstance(self.parserVersion, str) or not PARSER_VERSION_PATTERN.fullmatch(self.parserVersion):
            raise EvidenceError("parserVersion is invalid")
        if not isinstance(self.rawSha256, str) or not SHA256_PATTERN.fullmatch(self.rawSha256):
            raise EvidenceError("rawSha256 is invalid")
        if raw is not None and raw_sha256(raw) != self.rawSha256:
            raise EvidenceError("rawSha256 does not match the raw response")
        return self

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema": self.schema, "schemaVersion": self.schemaVersion,
            "claimPath": self.claimPath, "claimValue": self.claimValue,
            "sourceId": self.sourceId, "sourceUrl": self.sourceUrl,
            "documentId": self.documentId, "documentVersion": self.documentVersion,
            "retrievedAt": _iso_utc(self.retrievedAt),
            "parserVersion": self.parserVersion, "rawSha256": self.rawSha256,
        }


def evidence_for_record(record: Any) -> list[CanonicalEvidence]:
    """Create claim evidence from an OfficialSourceRecord, recomputing raw SHA-256."""
    raw = getattr(record, "_raw_body", None)
    if not isinstance(raw, bytes):
        raise EvidenceError("official source record has no raw response for hash verification")
    source_id = SOURCE_IDS.get(str(record.sourceName))
    if not source_id:
        raise EvidenceError(f"unregistered official adapter: {record.sourceName!r}")
    claims = record.claims()
    return [CanonicalEvidence.from_raw(
        raw=raw, claimPath=path, claimValue=value, sourceId=source_id,
        sourceUrl=record.finalUrl, documentId=record.documentId,
        documentVersion=record.documentVersion, retrievedAt=record.retrievedAt,
        parserVersion=record.parserVersion,
    ) for path, value in claims.items()]


def reconcile_official_records(records: Sequence[Any], *, minimum_sources: int = 2) -> dict[str, Any]:
    """Reconcile independent records; disagreement blocks rather than selecting a winner."""
    if len(records) < minimum_sources:
        raise EvidenceError(f"at least {minimum_sources} official sources are required")
    source_ids = {SOURCE_IDS.get(str(record.sourceName)) for record in records}
    if None in source_ids or len(source_ids) < minimum_sources:
        raise EvidenceError("official evidence must come from independent registered sources")

    by_path: dict[str, list[tuple[Any, Any]]] = {}
    evidence: list[CanonicalEvidence] = []
    for record in records:
        evidence.extend(evidence_for_record(record))
        for path, value in record.claims().items():
            by_path.setdefault(path, []).append((record, value))

    output: dict[str, Any] = {}
    conflicts: list[dict[str, Any]] = []
    for path, assertions in sorted(by_path.items()):
        distinct: dict[str, Any] = {}
        for _, value in assertions:
            distinct[_canonical_json(value)] = value
        if len(distinct) > 1:
            conflicts.append({
                "claimPath": path,
                "assertions": [{"sourceId": SOURCE_IDS[r.sourceName], "value": v}
                               for r, v in assertions],
            })
        else:
            output[path[1:]] = next(iter(distinct.values()))
    if conflicts:
        raise CrossSourceConflictError(json.dumps(conflicts, ensure_ascii=False, sort_keys=True))

    output["evidence"] = [item.as_dict() for item in sorted(
        evidence, key=lambda e: (e.claimPath, e.sourceId, e.documentId, e.documentVersion))]
    first_source = sorted(evidence, key=lambda e: (e.sourceId, e.sourceUrl))[0]
    output["sourceUrl"] = first_source.sourceUrl
    output["retrievedDate"] = max(item.retrievedAt for item in evidence)[:10]
    return output


def validate_evidence_bundle(record: Mapping[str, Any], *, minimum_sources: int = 2) -> list[CanonicalEvidence]:
    values = record.get("evidence")
    if not isinstance(values, list) or not values:
        raise EvidenceError("record has no canonical evidence")
    parsed = [CanonicalEvidence.from_mapping(value) for value in values
              if isinstance(value, Mapping)]
    if len(parsed) != len(values):
        raise EvidenceError("evidence entries must be objects")
    sources = {item.sourceId for item in parsed}
    documents = {(item.sourceId, item.documentId, item.documentVersion) for item in parsed}
    if len(sources) < minimum_sources or len(documents) < minimum_sources:
        raise EvidenceError("evidence must contain independent official sources/documents")
    covered: set[str] = set()
    for item in parsed:
        actual = value_at_path(record, item.claimPath)
        if _canonical_json(actual) != _canonical_json(item.claimValue):
            raise EvidenceError(f"evidence claimValue does not match {item.claimPath}")
        covered.add(item.claimPath)
    expected = {path for path in CLAIM_PATHS if record.get(path[1:]) not in (None, "", [], {})}
    missing = expected - covered
    if missing:
        raise EvidenceError(f"missing evidence for: {', '.join(sorted(missing))}")
    return parsed
