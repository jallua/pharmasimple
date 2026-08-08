"""PharmaSimple fail-closed official-source ingestion package."""
from __future__ import annotations

from .compliance import RateLimiter, RobotsChecker, host_key, robots_url_for
from .evidence import (
    CanonicalEvidence, CrossSourceConflictError, EvidenceError,
    reconcile_official_records, validate_evidence_bundle,
)
from .export import (
    export_official_records, export_record, export_records, export_verified_record,
    mark_ingestion_state, record_filename, serialize,
)
from .fetch import Fetcher, FetchResult, scrapling_get
from .normalize import ProvenanceError, normalize_record
from .pipeline import ingest_official, stage_urls
from .sources.example_source import ExampleDrugSource, ParsedRecord
from .verification import (
    VerificationError, build_verified_record, evidence_hash, load_source_registry,
    validate_verified_record, verify_record,
)

__all__ = [
    "CanonicalEvidence", "CrossSourceConflictError", "EvidenceError",
    "RateLimiter", "RobotsChecker", "host_key", "robots_url_for",
    "Fetcher", "FetchResult", "scrapling_get", "ExampleDrugSource", "ParsedRecord",
    "normalize_record", "ProvenanceError", "export_record", "export_records",
    "export_verified_record", "export_official_records", "mark_ingestion_state",
    "record_filename", "serialize", "stage_urls", "ingest_official",
    "VerificationError", "load_source_registry", "verify_record",
    "validate_verified_record", "build_verified_record", "evidence_hash",
    "reconcile_official_records", "validate_evidence_bundle",
]
