from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest
import refresh


def _write_plan(path: Path, entries: list[dict]) -> None:
    normalized = [{"minimumIndependentLineages": 2, **entry} for entry in entries]
    path.write_text(json.dumps({"schemaVersion": 1, "entries": normalized}), encoding="utf-8")


def test_refresh_fails_closed_when_no_records_are_planned(tmp_path: Path) -> None:
    plan = tmp_path / "plan.json"
    report = tmp_path / "report.json"
    _write_plan(plan, [])
    result = refresh.run(
        mode="full", plan_path=plan, staging_dir=tmp_path / "staging",
        registry_path=tmp_path / "registry.json", report_path=report,
    )
    assert result == 1
    assert json.loads(report.read_text(encoding="utf-8"))["status"] == "blocked"


def test_refresh_requires_two_applicable_sources(tmp_path: Path) -> None:
    plan = tmp_path / "plan.json"
    report = tmp_path / "report.json"
    _write_plan(plan, [{
        "slug": "example", "genericName": "example", "enabled": True,
        "sources": {"fda": True},
    }])
    result = refresh.run(
        mode="full", plan_path=plan, staging_dir=tmp_path / "staging",
        registry_path=tmp_path / "registry.json", report_path=report,
    )
    payload = json.loads(report.read_text(encoding="utf-8"))
    assert result == 1
    assert payload["failed"][0]["errorType"] == "ValueError"


def test_refresh_reports_success_only_after_verified_ingestion(tmp_path: Path, monkeypatch) -> None:
    plan = tmp_path / "plan.json"
    report = tmp_path / "report.json"
    output = tmp_path / "staging" / "example.json"
    _write_plan(plan, [{
        "slug": "example", "genericName": "example", "enabled": True,
        "sources": {"fda": True, "dailymed": True},
    }])

    def fake_ingest(*args, **kwargs):
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text("{}", encoding="utf-8")
        return output

    monkeypatch.setattr(refresh, "ingest_official", fake_ingest)
    result = refresh.run(
        mode="full", plan_path=plan, staging_dir=tmp_path / "staging",
        registry_path=tmp_path / "registry.json", report_path=report,
    )
    payload = json.loads(report.read_text(encoding="utf-8"))
    assert result == 0
    assert payload["status"] == "ok"
    assert payload["succeeded"][0]["slug"] == "example"



def test_refresh_rejects_unknown_or_disabled_slug(tmp_path: Path) -> None:
    plan = tmp_path / "plan.json"
    _write_plan(plan, [{
        "slug": "disabled", "genericName": "disabled", "enabled": False,
        "sources": {"fda": True, "dailymed": True},
    }])
    try:
        refresh.run(
            mode="full", plan_path=plan, staging_dir=tmp_path / "staging",
            registry_path=tmp_path / "registry.json", report_path=tmp_path / "report.json",
            slugs={"disabled"},
        )
    except ValueError as exc:
        assert "not enabled" in str(exc)
    else:
        raise AssertionError("disabled slug must fail closed")



def test_refresh_serializes_structured_source_failures(tmp_path: Path, monkeypatch) -> None:
    plan = tmp_path / "plan.json"
    report = tmp_path / "report.json"
    _write_plan(plan, [{
        "slug": "example", "genericName": "example", "enabled": True,
        "sources": {"fda": True, "dailymed": True},
    }])

    class StructuredFailure(RuntimeError):
        def __init__(self) -> None:
            super().__init__("all sources failed")
            self.failures = [{
                "source": "fda-openfda-drug-label", "status": "failed",
                "errorType": "ValueError", "error": "deterministic failure",
            }]

    def fake_ingest(*args, **kwargs):
        raise StructuredFailure()

    monkeypatch.setattr(refresh, "ingest_official", fake_ingest)
    result = refresh.run(
        mode="full", plan_path=plan, staging_dir=tmp_path / "staging",
        registry_path=tmp_path / "registry.json", report_path=report,
    )
    payload = json.loads(report.read_text(encoding="utf-8"))
    assert result == 1
    assert payload["failed"][0]["sourceFailures"][0]["source"] == "fda-openfda-drug-label"


def test_source_override_expires_on_review_date_in_utc(tmp_path: Path) -> None:
    plan = tmp_path / "plan.json"
    _write_plan(plan, [{
        "slug": "example", "genericName": "example", "enabled": True,
        "sources": {"fda": True, "dailymed": True},
        "sourceOverride": {"reason": "temporary official-source substitution", "reviewAfter": "2026-09-07"},
    }])
    assert refresh._load_plan(plan, today=date(2026, 9, 6))[0]["slug"] == "example"
    for clock_date in (date(2026, 9, 7), date(2026, 9, 8)):
        with pytest.raises(ValueError, match="override expired"):
            refresh._load_plan(plan, today=clock_date)



def test_source_plan_cannot_enable_a_curated_automation_block(tmp_path: Path) -> None:
    plan = tmp_path / "plan.json"
    _write_plan(plan, [{
        "slug": "example", "genericName": "example", "enabled": True,
        "sources": {"fda": True, "dailymed": True},
        "sourceOverride": {
            "reason": "same official document lineage through two channels",
            "reviewAfter": "2026-09-07",
            "blockAutomation": True,
        },
    }])
    with pytest.raises(ValueError, match="violates its automation block"):
        refresh._load_plan(plan, today=date(2026, 9, 6))
