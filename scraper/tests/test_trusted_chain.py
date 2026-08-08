from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from pharma_scraper.evidence import CrossSourceConflictError, EvidenceError, evidence_for_record, reconcile_official_records
from pharma_scraper.export import export_verified_record
from pharma_scraper.normalize import ProvenanceError
from pharma_scraper.pipeline import ingest_official
from pharma_scraper.sources.base import (
    HTTPResponse, ResponseTooLargeError, RobotsDeniedError, SafeHTTPClient,
    SecurityError, record_from_response,
)
from pharma_scraper.sources.dailymed import DailyMedSPLSource
from pharma_scraper.sources.ema import EMAMedicineSource
from pharma_scraper.sources.fda import OpenFDADrugLabelSource
from pharma_scraper.sources.nmpa import NMPAOfficialPageSource
from pharma_scraper.verification import build_verified_record

NOW = datetime(2026, 8, 7, 12, 0, tzinfo=timezone.utc)
SET_ID = "11111111-2222-3333-4444-555555555555"


def response(body: bytes, url: str, content_type: str) -> HTTPResponse:
    return HTTPResponse(body, url, 200, content_type, NOW.isoformat().replace("+00:00", "Z"), hashlib.sha256(body).hexdigest())


def source_record(source: str, url: str, *, generic: str = "Examplemab"):
    raw = f"{source}:{generic}".encode()
    return record_from_response(
        response=response(raw, url, "application/json"), source_name=source,
        parser_version="parser-v1", document_id=f"doc-{source}", document_version="7",
        generic_name=generic, indications=("Condition A",),
    )


def registry(path: Path) -> Path:
    path.write_text(json.dumps({
        "version": "test-v1",
        "sources": [
            {"id": "us-fda", "authoritative": True, "independenceGroup": "fda", "allowedHosts": ["fda.gov"]},
            {"id": "us-dailymed", "authoritative": True, "independenceGroup": "dm", "allowedHosts": ["dailymed.nlm.nih.gov"]},
            {"id": "eu-ema", "authoritative": True, "independenceGroup": "ema", "allowedHosts": ["ema.europa.eu"]},
            {"id": "cn-nmpa", "authoritative": True, "independenceGroup": "nmpa", "allowedHosts": ["nmpa.gov.cn"]},
        ],
    }), encoding="utf-8")
    return path


def test_canonical_evidence_recomputes_raw_sha_and_binds_claim():
    record = source_record("fda-openfda-drug-label", "https://api.fda.gov/drug/label.json")
    items = evidence_for_record(record)
    assert items[0].schemaVersion == "1.0.0"
    assert all(item.rawSha256 == f"sha256:{hashlib.sha256(record._raw_body).hexdigest()}" for item in items)
    with pytest.raises(EvidenceError, match="does not match"):
        items[0].validated(raw=b"tampered")


def test_cross_source_conflict_blocks_instead_of_selecting_winner():
    fda = source_record("fda-openfda-drug-label", "https://api.fda.gov/drug/label.json")
    dm = source_record("dailymed-spl-v2", "https://dailymed.nlm.nih.gov/dailymed/x", generic="Othermab")
    with pytest.raises(CrossSourceConflictError):
        reconcile_official_records([fda, dm])


def test_verified_export_versions_and_retains_lkg_when_stale(tmp_path):
    fda = source_record("fda-openfda-drug-label", "https://api.fda.gov/drug/label.json")
    dm = source_record("dailymed-spl-v2", "https://dailymed.nlm.nih.gov/dailymed/x")
    reg = registry(tmp_path / "registry.json")
    verified = build_verified_record([fda, dm], pipeline_version="test-pipeline-v1",
                                     checked_at=NOW, registry_path=reg)
    current = export_verified_record(verified, tmp_path / "out", now=NOW,
                                     registry_path=reg, max_age_days=30)
    original = current.read_bytes()
    manifest = json.loads((tmp_path / "out" / "version-manifest.json").read_text())
    state = manifest["records"][current.name]
    assert state["status"] == "fresh"
    assert (tmp_path / "out" / state["lkgPath"]).read_bytes() == original
    assert (tmp_path / "out" / state["versionPath"]).read_bytes() == original

    with pytest.raises(ProvenanceError, match="stale"):
        export_verified_record(verified, tmp_path / "out", now=NOW + timedelta(days=31),
                               registry_path=reg, max_age_days=30)
    assert current.read_bytes() == original
    manifest = json.loads((tmp_path / "out" / "version-manifest.json").read_text())
    assert manifest["records"][current.name]["status"] == "stale"


def test_export_revalidates_claim_value_and_blocks_tampering(tmp_path):
    fda = source_record("fda-openfda-drug-label", "https://api.fda.gov/drug/label.json")
    dm = source_record("dailymed-spl-v2", "https://dailymed.nlm.nih.gov/dailymed/x")
    reg = registry(tmp_path / "registry.json")
    verified = build_verified_record([fda, dm], pipeline_version="v1", checked_at=NOW, registry_path=reg)
    verified["genericName"] = "Tampered"
    with pytest.raises(ProvenanceError, match="blocked"):
        export_verified_record(verified, tmp_path / "out", now=NOW, registry_path=reg)


class FakeHeaders(dict):
    def get(self, key, default=None):
        return super().get(key, default)


class FakeHTTP:
    def __init__(self, body=b"{}", *, status=200, url="https://api.fda.gov/x",
                 content_type="application/json", headers=None):
        self.body = body; self.status = status; self.url = url
        self.headers = FakeHeaders(headers or {"Content-Type": content_type})
        self.closed = False
    def read(self, amount): return self.body[:amount]
    def geturl(self): return self.url
    def getcode(self): return self.status
    def close(self): self.closed = True


class SequenceOpener:
    def __init__(self, responses): self.responses = list(responses); self.calls = 0
    def open(self, request, timeout):
        self.calls += 1
        return self.responses.pop(0)


def allow_all(_): return "User-agent: *\nDisallow:\n"


def test_safe_client_enforces_https_exact_host_and_fail_closed_robots():
    client = SafeHTTPClient({"api.fda.gov"}, opener=SequenceOpener([]), robots_fetch=lambda _: None)
    with pytest.raises(SecurityError): client.get("http://api.fda.gov/x")
    with pytest.raises(SecurityError): client.get("https://evil-api.fda.gov/x")
    with pytest.raises(RobotsDeniedError): client.get("https://api.fda.gov/x")


def test_safe_client_retries_503_with_backoff_and_limits_response():
    sleeps = []
    opener = SequenceOpener([
        FakeHTTP(status=503, headers={"Content-Type": "text/plain", "Retry-After": "2"}),
        FakeHTTP(body=b"ok", content_type="text/plain"),
    ])
    client = SafeHTTPClient({"api.fda.gov"}, opener=opener, robots_fetch=allow_all,
                            min_host_delay=0, sleep=sleeps.append, max_retries=1)
    result = client.get("https://api.fda.gov/x")
    assert result.body == b"ok" and opener.calls == 2 and 2.0 in sleeps

    too_big = SafeHTTPClient({"api.fda.gov"}, opener=SequenceOpener([
        FakeHTTP(body=b"12345", content_type="text/plain")]), robots_fetch=allow_all,
        min_host_delay=0, max_response_bytes=4)
    with pytest.raises(ResponseTooLargeError): too_big.get("https://api.fda.gov/x")


def test_fda_selects_unique_latest_label_and_extracts_indications():
    payload = {"results": [
        {"set_id": SET_ID, "effective_time": "20240101", "openfda": {"generic_name": ["Examplemab"]}, "indications_and_usage": ["Old indication"]},
        {"set_id": SET_ID, "effective_time": "20250101", "openfda": {"generic_name": ["Examplemab"], "brand_name": ["Example"]}, "indications_and_usage": ["Condition A"]},
        {"set_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "effective_time": "20250101", "openfda": {"generic_name": ["Examplemab and Hyaluronidase"]}, "indications_and_usage": ["Combination indication"]},
    ]}
    raw = json.dumps(payload).encode()
    record = OpenFDADrugLabelSource().parse_response(response(raw, "https://api.fda.gov/drug/label.json", "application/json"), "Examplemab")
    assert record.documentVersion == "20250101"
    assert record.indications == ("Condition A",)


def test_dailymed_parses_spl_xml_and_rejects_wrong_setid():
    xml = f'''<document xmlns="urn:hl7-org:v3">
      <setId root="{SET_ID}"/><versionNumber value="9"/>
      <author><assignedEntity><representedOrganization><name>Labeler Inc</name></representedOrganization></assignedEntity></author>
      <component><structuredBody><component><section><code code="34067-9"/><text>Condition A</text></section></component></structuredBody></component>
      <manufacturedProduct><manufacturedProduct><name>Example</name><asEntityWithGeneric><genericMedicine><name>Examplemab</name></genericMedicine></asEntityWithGeneric></manufacturedProduct></manufacturedProduct>
    </document>'''.encode()
    record = DailyMedSPLSource().parse_response(
        response(xml, f"https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{SET_ID}.xml", "application/xml"),
        "Examplemab", expected_setid=SET_ID,
    )
    assert record.documentId == SET_ID and record.documentVersion == "9"
    assert record.indications == ("Condition A",) and record.company == "Labeler Inc"


def test_indication_sections_have_bounded_count_and_aggregate_size():
    source_response = response(b"{}", "https://api.fda.gov/drug/label.json", "application/json")

    accepted = record_from_response(
        response=source_response, source_name="fda-openfda-drug-label",
        parser_version="test", document_id=SET_ID, document_version="1",
        generic_name="Examplemab", indications=tuple(
            f"Condition {index} " + "x" * 301 for index in range(22)
        ),
    )
    assert len(accepted._indication_excerpts) == 22

    with pytest.raises(RuntimeError, match="too many indications"):
        record_from_response(
            response=source_response, source_name="fda-openfda-drug-label",
            parser_version="test", document_id=SET_ID, document_version="1",
            generic_name="Examplemab", indications=tuple(
                f"Condition {index}" for index in range(65)
            ),
        )

    with pytest.raises(RuntimeError, match="aggregate safety limit"):
        record_from_response(
            response=source_response, source_name="fda-openfda-drug-label",
            parser_version="test", document_id=SET_ID, document_version="1",
            generic_name="Examplemab", indications=tuple(
                f"Condition {index} " + "x" * 49_000 for index in range(11)
            ),
        )


def test_ema_and_nmpa_strict_entry_rejects_before_client_call():
    class NeverClient:
        def get(self, *args, **kwargs): raise AssertionError("must not fetch")
    with pytest.raises(SecurityError):
        EMAMedicineSource(NeverClient()).fetch("x", citation_url="https://example.com/detail")
    with pytest.raises(SecurityError):
        NMPAOfficialPageSource(NeverClient()).fetch("x", citation_url="http://www.nmpa.gov.cn/a/abcdef.html")


def test_dailymed_parses_official_zip_download():
    xml = f'''<document xmlns="urn:hl7-org:v3">
      <setId root="{SET_ID}"/><versionNumber value="9"/>
      <author><assignedEntity><representedOrganization><name>Labeler Inc</name></representedOrganization></assignedEntity></author>
      <component><structuredBody><component><section><code code="34067-9"/><text>Condition A</text></section></component></structuredBody></component>
      <manufacturedProduct><manufacturedProduct><name>Example</name><asEntityWithGeneric><genericMedicine><name>Examplemab</name></genericMedicine></asEntityWithGeneric></manufacturedProduct></manufacturedProduct>
    </document>'''.encode()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("label.xml", xml)
        archive.writestr("image.jpg", b"not parsed")
    record = DailyMedSPLSource().parse_response(
        response(buffer.getvalue(), f"https://dailymed.nlm.nih.gov/dailymed/getFile.cfm?setid={SET_ID}&type=zip", "application/zip"),
        "Examplemab", expected_setid=SET_ID,
    )
    assert record.documentId == SET_ID and record.documentVersion == "9"
    assert record.indications == ("Condition A",)



def test_production_pipeline_wires_all_four_sources_offline(tmp_path):
    urls = {
        "fda-openfda-drug-label": "https://api.fda.gov/drug/label.json",
        "dailymed-spl-v2": "https://dailymed.nlm.nih.gov/dailymed/x",
        "ema-medicine-epar": "https://www.ema.europa.eu/en/medicines/x",
        "nmpa-official-page": "https://www.nmpa.gov.cn/a/abcdef.html",
    }

    class Stub:
        def __init__(self, name): self.name = name
        def fetch(self, generic_name, **kwargs):
            return source_record(self.name, urls[self.name], generic=generic_name)

    reg = registry(tmp_path / "registry.json")
    output = ingest_official(
        "Examplemab", citation_urls={"ema": urls["ema-medicine-epar"], "nmpa": urls["nmpa-official-page"]},
        staging_dir=tmp_path / "out", registry_path=reg, max_age_days=30,
        sources=[Stub(name) for name in urls],
    )
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["schemaVersion"] == "2.0.0"
    assert {item["sourceId"] for item in payload["documents"]} == {
        "us-fda", "us-dailymed", "eu-ema", "cn-nmpa",
    }
    assert payload["incomplete"] is False
    assert all(item["status"] == "succeeded" for item in payload["sourceAudit"])
    assert any(item["predicate"] == "identity.genericName" for item in payload["facts"])


def test_production_pipeline_preserves_every_source_failure(tmp_path):
    class BrokenSource:
        def __init__(self, name: str) -> None:
            self.name = name

        def fetch(self, generic_name, **kwargs):
            raise ValueError(f"{self.name} deterministic failure")

    sources = [
        BrokenSource("fda-openfda-drug-label"),
        BrokenSource("dailymed-spl-v2"),
    ]
    with pytest.raises(RuntimeError, match="all configured official sources failed") as raised:
        ingest_official(
            "Examplemab", citation_urls={}, staging_dir=tmp_path / "out",
            registry_path=tmp_path / "registry.json", sources=sources,
        )

    failures = raised.value.failures
    assert [item["source"] for item in failures] == [source.name for source in sources]
    assert all(item["errorType"] == "ValueError" for item in failures)
    manifest = json.loads((tmp_path / "out" / "version-manifest.json").read_text(encoding="utf-8"))
    reason = manifest["records"]["examplemab-official.json"]["reason"]
    assert all(source.name in reason for source in sources)
