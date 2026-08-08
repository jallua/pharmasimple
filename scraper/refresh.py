"""Refresh configured drug records from applicable official sources.

The CLI is intentionally fail-closed: a planned record is promoted only when at
least two configured official adapters reconcile and verify successfully. Any
failure keeps the previous LKG and makes the process exit non-zero.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Mapping

SCRAPER_ROOT = Path(__file__).resolve().parent
if str(SCRAPER_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRAPER_ROOT))

from pharma_scraper.pipeline import ingest_official  # noqa: E402
from pharma_scraper.sources import (  # noqa: E402
    DailyMedSPLSource,
    EMAMedicineSource,
    NMPAOfficialPageSource,
    OpenFDADrugLabelSource,
)

SOURCE_FACTORIES = {
    "fda": OpenFDADrugLabelSource,
    "dailymed": DailyMedSPLSource,
    "ema": EMAMedicineSource,
    "nmpa": NMPAOfficialPageSource,
}


def _atomic_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    handle = tempfile.NamedTemporaryFile(mode="wb", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False)
    temporary = Path(handle.name)
    try:
        with handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def _load_plan(path: Path, *, today: date | None = None) -> list[dict[str, Any]]:
    clock_date = today or datetime.now(timezone.utc).date()
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot load source plan: {path}") from exc
    if document.get("schemaVersion") != 1 or not isinstance(document.get("entries"), list):
        raise ValueError("source plan must use schemaVersion 1 with an entries array")
    entries: list[dict[str, Any]] = []
    for index, raw in enumerate(document["entries"]):
        if not isinstance(raw, dict):
            raise ValueError(f"source plan entry {index} is not an object")
        slug = str(raw.get("slug") or "").strip()
        generic_name = str(raw.get("genericName") or "").strip()
        sources = raw.get("sources")
        if not slug or not generic_name or not isinstance(sources, dict):
            raise ValueError(f"source plan entry {index} lacks slug/genericName/sources")
        if raw.get("minimumIndependentLineages") != 2:
            raise ValueError(f"source plan entry {slug} must require two independent lineages")
        override = raw.get("sourceOverride")
        if override is not None:
            if not isinstance(override, dict) or not isinstance(override.get("reviewAfter"), str):
                raise ValueError(f"source plan entry {slug} has an invalid source override")
            try:
                review_after = date.fromisoformat(override["reviewAfter"])
            except ValueError as exc:
                raise ValueError(f"source plan entry {slug} has an invalid override review date") from exc
            if review_after <= clock_date:
                raise ValueError(
                    f"source plan entry {slug} override expired on {review_after.isoformat()}"
                )
            blocked = override.get("blockAutomation", False)
            if not isinstance(blocked, bool) or (blocked and raw.get("enabled", True)):
                raise ValueError(f"source plan entry {slug} violates its automation block")
        unknown = set(sources) - set(SOURCE_FACTORIES)
        if unknown:
            raise ValueError(f"source plan entry {slug} has unknown sources: {sorted(unknown)}")
        entries.append({**raw, "slug": slug, "genericName": generic_name, "sources": sources})
    return entries


def _configured_sources(entry: Mapping[str, Any]) -> tuple[list[object], dict[str, str]]:
    adapters: list[object] = []
    citations: dict[str, str] = {}
    for source_name, configured in entry["sources"].items():
        if configured in (False, None, ""):
            continue
        if source_name in {"ema", "nmpa"} and not isinstance(configured, str):
            raise ValueError(f"{entry['slug']}: {source_name} requires an explicit official detail URL")
        if isinstance(configured, str):
            if not configured.startswith("https://"):
                raise ValueError(f"{entry['slug']}: {source_name} URL must use HTTPS")
            citations[source_name] = configured
        adapters.append(SOURCE_FACTORIES[source_name]())
    if len(adapters) < 2:
        raise ValueError(f"{entry['slug']}: at least two applicable official sources are required")
    return adapters, citations


def run(*, mode: str, plan_path: Path, staging_dir: Path, registry_path: Path,
        report_path: Path, slugs: set[str] | None = None) -> int:
    entries = [entry for entry in _load_plan(plan_path) if entry.get("enabled", True)]
    if slugs:
        entries = [entry for entry in entries if entry["slug"] in slugs]
        missing = slugs - {entry["slug"] for entry in entries}
        if missing:
            raise ValueError(f"requested slugs are not enabled in the source plan: {sorted(missing)}")
    if mode == "incremental":
        entries = [entry for entry in entries if entry.get("cadence", "weekly") != "monthly"]
    report: dict[str, Any] = {
        "schemaVersion": 1,
        "mode": mode,
        "startedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "planned": len(entries),
        "succeeded": [],
        "failed": [],
    }
    for entry in entries:
        try:
            adapters, citation_urls = _configured_sources(entry)
            path = ingest_official(
                entry["genericName"],
                citation_urls=citation_urls,
                sources=adapters,
                staging_dir=staging_dir,
                registry_path=registry_path,
            )
            report["succeeded"].append({"slug": entry["slug"], "path": str(path)})
        except Exception as exc:  # fail-closed boundary; details are persisted for audit
            failure = {
                "slug": entry["slug"],
                "errorType": type(exc).__name__,
                "error": str(exc)[:500],
            }
            source_failures = getattr(exc, "failures", None)
            if source_failures is not None:
                failure["sourceFailures"] = source_failures
            partial_path = getattr(exc, "path", None)
            if partial_path is not None:
                failure["partialPath"] = str(partial_path)
            report["failed"].append(failure)
    report["finishedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    report["status"] = "ok" if entries and not report["failed"] else "blocked"
    _atomic_json(report_path, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "ok" else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("incremental", "full"), required=True)
    parser.add_argument("--plan", type=Path, default=SCRAPER_ROOT / "source-plan.json")
    parser.add_argument("--staging-dir", type=Path, default=SCRAPER_ROOT / "data" / "staging")
    parser.add_argument("--registry", type=Path, default=SCRAPER_ROOT.parent / "src" / "data" / "official-sources.json")
    parser.add_argument("--report", type=Path, default=SCRAPER_ROOT / "data" / "refresh-report.json")
    parser.add_argument("--slug", action="append", dest="slugs", help="refresh only an enabled slug; repeatable")
    args = parser.parse_args()
    return run(mode=args.mode, plan_path=args.plan, staging_dir=args.staging_dir,
               registry_path=args.registry, report_path=args.report,
               slugs=set(args.slugs or []))


if __name__ == "__main__":
    raise SystemExit(main())
