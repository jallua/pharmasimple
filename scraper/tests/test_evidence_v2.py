from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from pharma_scraper.evidence_v2 import (
    EvidenceError, bundle_from_records, canonical_hash, document_for_record,
    validate_canonical_bundle,
)
from pharma_scraper.export import export_canonical_v2_bundle
from pharma_scraper.normalize import ProvenanceError
from pharma_scraper.pipeline import PartialSourceFailure, ingest_official
from pharma_scraper.sources.base import (
    DrugNameMismatchError, HTTPResponse, record_from_response,
    require_active_moiety_match,
)

NOW = datetime.now(timezone.utc).replace(microsecond=0)
SET_ID = "11111111-2222-3333-4444-555555555555"


def response(body: bytes, url: str, content_type: str = "application/json") -> HTTPResponse:
    return HTTPResponse(
        body=body,
        final_url=url,
        status=200,
        content_type=content_type,
        retrieved_at=NOW.isoformat().replace("+00:00", "Z"),
        sha256=hashlib.sha256(body).hexdigest(),
    )


def record(source: str, url: str, *, document_id: str = SET_ID,
           generic: str = "Examplemab", brand: str | None = "Example",
           indication: str = "Condition A"):
    raw = json.dumps({"source": source, "generic": generic}).encode()
    return record_from_response(
        response=response(raw, url),
        source_name=source,
        parser_version="parser-v2",
        document_id=document_id,
        document_version="20260808",
        generic_name=generic,
        brand_name=brand,
        indications=(indication,),
    )


def registry(path: Path) -> Path:
    path.write_text(json.dumps({
        "version": "test-v2",
        "sources": [
            {"id": "us-fda", "authoritative": True, "allowedHosts": ["fda.gov"]},
            {"id": "us-dailymed", "authoritative": True, "allowedHosts": ["dailymed.nlm.nih.gov"]},
            {"id": "eu-ema", "authoritative": True, "allowedHosts": ["ema.europa.eu"]},
        ],
    }), encoding="utf-8")
    return path


def test_long_indication_is_excerpt_not_atomic_fact() -> None:
    item = record(
        "fda-openfda-drug-label",
        "https://api.fda.gov/drug/label.json",
        indication="A" * 301,
    )
    assert item.indications == ()
    assert item._indication_excerpts == ("A" * 301,)
    bundle = bundle_from_records([item], source_attempts=[
        {"source": item.sourceName, "status": "succeeded"},
    ])
    assert len(bundle["excerpts"]) == 1
    assert all(fact["predicate"] != "product.approvedIndication" for fact in bundle["facts"])


def test_same_spl_set_id_is_one_lineage_and_cannot_be_promoted(tmp_path: Path) -> None:
    fda = record("fda-openfda-drug-label", "https://api.fda.gov/drug/label.json", brand="Brand A")
    daily = record("dailymed-spl-v2", "https://dailymed.nlm.nih.gov/dailymed/x", brand="Brand B")
    bundle = bundle_from_records([fda, daily])
    assert {doc["lineageId"] for doc in bundle["documents"]} == {f"spl-set:{SET_ID}"}
    brand = next(fact for fact in bundle["facts"] if fact["predicate"] == "product.brandName")
    generic = next(fact for fact in bundle["facts"] if fact["predicate"] == "identity.genericName")
    assert brand["status"] == "conflicted"
    assert generic["status"] == "blocked"
    with pytest.raises(ProvenanceError, match="independent document lineages"):
        export_canonical_v2_bundle(bundle, [fda, daily], tmp_path)


def test_regional_product_indications_coexist_without_cross_region_conflict() -> None:
    us = record("fda-openfda-drug-label", "https://api.fda.gov/drug/label.json", indication="US condition")
    eu = record(
        "ema-medicine-epar",
        "https://www.ema.europa.eu/en/medicines/example",
        document_id="ema:example-1",
        indication="EU condition",
    )
    facts = bundle_from_records([us, eu])["facts"]
    generic = next(fact for fact in facts if fact["predicate"] == "identity.genericName")
    assert generic["status"] == "verified"
    assert len({item["lineageId"] for item in generic["assertions"]}) == 2
    indications = [fact for fact in facts if fact["predicate"] == "product.approvedIndication"]
    assert len(indications) == 2
    assert {fact["scope"]["jurisdiction"] for fact in indications} == {"US", "EU"}
    assert all(fact["status"] == "verified" for fact in indications)


def test_zip_to_xml_transformation_and_raw_objects_are_persisted(tmp_path: Path) -> None:
    container = response(b"PK\x03\x04container", "https://dailymed.nlm.nih.gov/dailymed/getFile.cfm", "application/zip")
    xml = response(b"<document/>", container.final_url, "application/xml")
    item = record_from_response(
        response=xml,
        source_name="dailymed-spl-v2",
        parser_version="dailymed-spl-xml-v2",
        document_id=SET_ID,
        document_version="9",
        generic_name="Examplemab",
        indications=("Condition A",),
        container_response=container,
        transform_operation="zip-entry",
        transform_locator="label.xml",
    )
    document = document_for_record(item)
    assert document.transformations[0].inputSha256.endswith(hashlib.sha256(container.body).hexdigest())
    corroborating = record(
        "ema-medicine-epar",
        "https://www.ema.europa.eu/en/medicines/example",
        document_id="ema:example-1",
        generic="Examplemab",
    )
    bundle = bundle_from_records([item, corroborating])
    output = export_canonical_v2_bundle(bundle, [item, corroborating], tmp_path)
    assert output.exists()
    assert (tmp_path / "v2" / document.rawObjectPath).read_bytes() == xml.body
    container_path = tmp_path / "v2" / "evidence" / "objects" / f"{hashlib.sha256(container.body).hexdigest()}.bin"
    assert container_path.read_bytes() == container.body
    manifest = json.loads((tmp_path / "v2" / "fact-manifest.json").read_text(encoding="utf-8"))
    assert manifest["facts"]
    assert all(state["active"] for state in manifest["facts"].values())
    assert manifest["subjects"]["examplemab"]["status"] == "complete"


def test_successful_refresh_retires_facts_missing_from_new_active_set(tmp_path: Path) -> None:
    first_records = [
        record("fda-openfda-drug-label", "https://api.fda.gov/drug/label.json", brand="Old Brand"),
        record(
            "ema-medicine-epar",
            "https://www.ema.europa.eu/en/medicines/example",
            document_id="ema:example-1",
            brand="Old Brand",
        ),
    ]
    first_bundle = bundle_from_records(first_records)
    export_canonical_v2_bundle(first_bundle, first_records, tmp_path)
    retired_ids = {
        fact["factId"] for fact in first_bundle["facts"]
        if fact["predicate"] == "product.brandName"
    }
    assert retired_ids

    second_records = [replace(item, brandName=None) for item in first_records]
    second_bundle = bundle_from_records(second_records)
    export_canonical_v2_bundle(second_bundle, second_records, tmp_path)
    manifest = json.loads((tmp_path / "v2" / "fact-manifest.json").read_text(encoding="utf-8"))
    active_ids = set(manifest["subjects"]["examplemab"]["activeFactIds"])
    assert retired_ids.isdisjoint(active_ids)
    for fact_id in retired_ids:
        state = manifest["facts"][fact_id]
        assert state["status"] == "retired"
        assert state["active"] is False
        assert not (tmp_path / "v2" / "facts" / "current" / f"{fact_id}.json").exists()
        assert (tmp_path / "v2" / state["lkgPath"]).exists()


def test_retirement_rejects_manifest_path_traversal(tmp_path: Path) -> None:
    records = [
        record("fda-openfda-drug-label", "https://api.fda.gov/drug/label.json", brand="Old Brand"),
        record(
            "ema-medicine-epar",
            "https://www.ema.europa.eu/en/medicines/example",
            document_id="ema:example-1",
            brand="Old Brand",
        ),
    ]
    bundle = bundle_from_records(records)
    export_canonical_v2_bundle(bundle, records, tmp_path)
    brand_id = next(
        fact["factId"] for fact in bundle["facts"]
        if fact["predicate"] == "product.brandName"
    )
    manifest_path = tmp_path / "v2" / "fact-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["facts"][brand_id]["currentPath"] = "../outside.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    sentinel = tmp_path / "outside.json"
    sentinel.write_text("keep", encoding="utf-8")

    replacement = [replace(item, brandName=None) for item in records]
    with pytest.raises(ProvenanceError, match="unsafe current fact path"):
        export_canonical_v2_bundle(bundle_from_records(replacement), replacement, tmp_path)
    assert sentinel.read_text(encoding="utf-8") == "keep"


def test_partial_source_failure_quarantines_bundle_without_fact_lkg(tmp_path: Path) -> None:
    class Good:
        name = "fda-openfda-drug-label"

        def fetch(self, generic_name: str):
            return record(self.name, "https://api.fda.gov/drug/label.json", generic=generic_name)

    class Broken:
        name = "dailymed-spl-v2"

        def fetch(self, generic_name: str, **kwargs):
            raise RuntimeError("temporary source failure")

    with pytest.raises(PartialSourceFailure) as caught:
        ingest_official(
            "Examplemab",
            citation_urls={},
            sources=[Good(), Broken()],
            staging_dir=tmp_path / "staging",
            registry_path=registry(tmp_path / "registry.json"),
        )
    assert caught.value.path.exists()
    assert "quarantine" in caught.value.path.parts
    facts = list((tmp_path / "staging" / "v2" / "facts" / "lkg").glob("*.json"))
    assert facts == []
    assert not (tmp_path / "staging" / "v2" / "fact-manifest.json").exists()
    payload = json.loads(caught.value.path.read_text(encoding="utf-8"))
    assert payload["incomplete"] is True
    assert payload["sourceAudit"][1]["status"] == "failed"



def test_active_moiety_matching_allows_only_known_salt_or_hydrate_suffixes() -> None:
    assert require_active_moiety_match("imatinib", ["IMATINIB MESYLATE"]) == "imatinib"
    assert require_active_moiety_match("amlodipine", ["amlodipine besylate"]) == "amlodipine"
    assert require_active_moiety_match("lebrikizumab", ["lebrikizumab-lbkz"]) == "lebrikizumab"
    with pytest.raises(DrugNameMismatchError):
        require_active_moiety_match("imatinib", ["imatinib-abcd"])
    with pytest.raises(DrugNameMismatchError):
        require_active_moiety_match("imatinib", ["imatinib experimental compound"])
    with pytest.raises(DrugNameMismatchError):
        require_active_moiety_match("imatinib", ["imatinibfake"])


def test_retrieval_events_get_distinct_evidence_ids_while_reusing_raw_object() -> None:
    first = record("fda-openfda-drug-label", "https://api.fda.gov/drug/label.json")
    second = replace(
        first,
        retrievedAt=(NOW + timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
    )
    first_document = document_for_record(first)
    second_document = document_for_record(second)
    assert first_document.rawSha256 == second_document.rawSha256
    assert first_document.rawObjectPath == second_document.rawObjectPath
    assert first_document.evidenceId != second_document.evidenceId


def test_document_rejects_caller_supplied_forged_lineage() -> None:
    item = record("fda-openfda-drug-label", "https://api.fda.gov/drug/label.json")
    document = document_for_record(item)
    with pytest.raises(EvidenceError, match="lineageId is not canonical"):
        replace(document, lineageId="us-fda:forged-independent-copy").validated()


def test_bundle_rejects_hash_valid_assertion_detached_from_document_lineage() -> None:
    item = record("fda-openfda-drug-label", "https://api.fda.gov/drug/label.json")
    bundle = bundle_from_records([item])
    fact = bundle["facts"][0]
    fact["assertions"][0]["lineageId"] = "spl-set:forged-lineage"
    fact["resolutionHash"] = canonical_hash({
        key: fact[key]
        for key in (
            "factId", "factKey", "predicate", "value", "scope", "status", "assertions"
        )
    })

    with pytest.raises(EvidenceError, match="source or lineage"):
        validate_canonical_bundle(bundle)
