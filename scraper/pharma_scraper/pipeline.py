"""Offline staging and production official-source ingestion pipelines."""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable, List, Mapping, Optional, Sequence, Union

from .evidence_v2 import bundle_from_records, validate_canonical_bundle, validate_registered_sources
from .export import DEFAULT_STAGING_DIR, export_canonical_v2_bundle, export_record, mark_ingestion_state
from .fetch import Fetcher
from .normalize import normalize_record
from .sources import DailyMedSPLSource, EMAMedicineSource, NMPAOfficialPageSource, OpenFDADrugLabelSource
from .sources.example_source import ExampleDrugSource
from .verification import load_source_registry

logger = logging.getLogger(__name__)
PathLike = Union[str, Path]
PRODUCTION_PIPELINE_VERSION = "official-ingestion-v2"


class AllSourcesFailed(RuntimeError):
    """Every configured source failed before a v2 bundle could be exported."""

    def __init__(self, failures: list[dict[str, str]]) -> None:
        self.failures = failures
        details = "; ".join(
            f"{item['source']}: {item['errorType']}: {item['error']}" for item in failures
        ) or "no official source records"
        super().__init__(f"all configured official sources failed ({details})")


class PartialSourceFailure(RuntimeError):
    """Some configured sources failed after an incomplete audit bundle was quarantined."""

    def __init__(self, path: Path, failures: list[dict[str, str]]) -> None:
        self.path = path
        self.failures = failures
        super().__init__(f"{len(failures)} configured source(s) failed; partial evidence saved at {path}")


def stage_urls(urls: Iterable[str], *, fetcher: Fetcher,
               source: Optional[ExampleDrugSource] = None,
               staging_dir: PathLike = DEFAULT_STAGING_DIR,
               retrieved_date: Union[str, date, datetime, None] = None) -> List[Path]:
    """Legacy untrusted/offline staging; never promotes data to verified LKG."""
    source = source or ExampleDrugSource()
    written: List[Path] = []
    for url in urls:
        result = fetcher.fetch(url)
        if result is None:
            logger.info("skipped %s (no result / disallowed)", url)
            continue
        parsed = source.parse(result.selector(), source_url=result.url)
        record = normalize_record(parsed, source_url=result.url, retrieved_date=retrieved_date)
        written.append(export_record(record, staging_dir))
    return written


def _fetch_adapter(adapter: object, name: str, citation_urls: Mapping[str, str]):
    source_name = getattr(adapter, "name", "")
    if source_name == EMAMedicineSource.name:
        return adapter.fetch(name, citation_url=citation_urls.get("ema", ""))
    if source_name == NMPAOfficialPageSource.name:
        return adapter.fetch(name, citation_url=citation_urls.get("nmpa", ""))
    if source_name == DailyMedSPLSource.name:
        return adapter.fetch(name, citation_url=citation_urls.get("dailymed") or None)
    if source_name == OpenFDADrugLabelSource.name:
        return adapter.fetch(name)
    raise TypeError(f"unsupported production source adapter: {type(adapter).__name__}")


def ingest_official(generic_name: str, *, citation_urls: Mapping[str, str],
                    staging_dir: PathLike = DEFAULT_STAGING_DIR,
                    pipeline_version: str = PRODUCTION_PIPELINE_VERSION,
                    sources: Sequence[object] | None = None,
                    registry_path: Path | None = None,
                    max_age_days: int = 30) -> Path:
    """Collect source documents independently and publish scoped v2 facts.

    A source failure is audited without discarding records from successful sources.
    The incomplete bundle is quarantined, then :class:`PartialSourceFailure`
    keeps the scheduled refresh non-zero. No fact LKG or site copy is promoted.
    """
    name = generic_name.strip()
    if not name:
        raise ValueError("generic_name is required")
    if not isinstance(pipeline_version, str) or not pipeline_version.strip():
        raise ValueError("pipeline_version is required")
    if max_age_days < 0:
        raise ValueError("max_age_days must be non-negative")
    adapters = list(sources or (
        OpenFDADrugLabelSource(), DailyMedSPLSource(),
        EMAMedicineSource(), NMPAOfficialPageSource(),
    ))
    records: list[object] = []
    attempts: list[dict[str, str]] = []
    failures: list[dict[str, str]] = []
    for adapter in adapters:
        source_name = str(getattr(adapter, "name", "") or type(adapter).__name__)
        try:
            records.append(_fetch_adapter(adapter, name, citation_urls))
            attempts.append({"source": source_name, "status": "succeeded"})
        except Exception as exc:
            failure = {
                "source": source_name,
                "status": "failed",
                "errorType": type(exc).__name__,
                "error": str(exc)[:500],
            }
            attempts.append(failure)
            failures.append(failure)

    state_key = f"{re.sub(r'[^a-z0-9]+', '-', name.casefold()).strip('-') or 'drug'}-official.json"
    if not records:
        error = AllSourcesFailed(failures)
        mark_ingestion_state(state_key, "blocked", str(error)[:2_000], staging_dir=staging_dir)
        raise error

    bundle = bundle_from_records(records, source_attempts=attempts)
    documents, _, _ = validate_canonical_bundle(bundle)
    registry = load_source_registry(registry_path)
    validate_registered_sources(documents, registry)
    now = datetime.now(timezone.utc)
    for document in documents:
        retrieved = datetime.fromisoformat(document.retrievedAt.replace("Z", "+00:00"))
        if (now - retrieved.astimezone(timezone.utc)).days > max_age_days:
            mark_ingestion_state(state_key, "stale", "v2 evidence exceeded freshness limit", staging_dir=staging_dir)
            raise RuntimeError("official evidence is stale; fact LKG retained")

    path = export_canonical_v2_bundle(bundle, records, staging_dir, promote=not failures)
    if failures:
        raise PartialSourceFailure(path, failures)
    return path
