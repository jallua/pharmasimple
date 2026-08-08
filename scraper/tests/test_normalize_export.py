"""Offline tests for normalization + idempotent export, incl. provenance (P12)."""
import json
from datetime import date
from pathlib import Path

import pytest

from pharma_scraper.export import export_record, record_filename, serialize
from pharma_scraper.normalize import MAX_TEXT_LEN, ProvenanceError, normalize_record


def base_parsed():
    return {
        "company": "BeiGene",
        "genericName": "Zanubrutinib",
        "brandName": "Brukinsa",
        "drugClass": "BTK inhibitor",
        "indications": ["MCL", "CLL", "MCL"],  # duplicate to exercise dedupe
        "targetHints": ["BTK"],
    }


def test_normalize_includes_provenance():
    record = normalize_record(base_parsed(), source_url="https://x.example/d", retrieved_date="2026-01-02")
    assert record["sourceUrl"] == "https://x.example/d"
    assert record["retrievedDate"] == "2026-01-02"
    assert record["indications"] == ["MCL", "CLL"]  # deduped, order preserved


def test_normalize_defaults_retrieved_date_to_valid_iso():
    record = normalize_record(base_parsed(), source_url="https://x.example/d")
    # Defaults to "today" (UTC); assert it is a valid ISO date either way.
    parsed = date.fromisoformat(record["retrievedDate"])
    assert isinstance(parsed, date)


def test_normalize_requires_source_url():
    with pytest.raises(ProvenanceError):
        normalize_record(base_parsed(), source_url="")
    with pytest.raises(ProvenanceError):
        normalize_record({"genericName": "X"})  # no source anywhere


def test_normalize_drops_unknown_and_image_keys():
    parsed = base_parsed()
    parsed["image"] = "https://x.example/logo.png"
    parsed["imageBytes"] = b"\x89PNG\r\n"
    parsed["rawHtml"] = "<html>lots of copyrighted markup</html>"
    record = normalize_record(parsed, source_url="https://x.example/d")
    assert "image" not in record
    assert "imageBytes" not in record
    assert "rawHtml" not in record
    assert set(record) == {
        "company", "genericName", "brandName", "drugClass",
        "indications", "targetHints", "sourceUrl", "retrievedDate",
    }


def test_normalize_rejects_binary_in_known_field():
    parsed = base_parsed()
    parsed["company"] = b"\x00\x01"
    with pytest.raises(TypeError):
        normalize_record(parsed, source_url="https://x.example/d")


def test_normalize_caps_long_text():
    parsed = base_parsed()
    parsed["drugClass"] = "x" * (MAX_TEXT_LEN + 500)
    record = normalize_record(parsed, source_url="https://x.example/d")
    assert len(record["drugClass"]) == MAX_TEXT_LEN


def test_export_writes_json_with_provenance(tmp_path):
    record = normalize_record(base_parsed(), source_url="https://x.example/d", retrieved_date="2026-01-02")
    path = export_record(record, staging_dir=tmp_path)
    assert path.exists()
    loaded = json.loads(path.read_text(encoding="utf-8"))
    assert loaded == record  # JSON round-trips
    assert loaded["sourceUrl"] and loaded["retrievedDate"]


def test_export_is_idempotent(tmp_path):
    record = normalize_record(base_parsed(), source_url="https://x.example/d", retrieved_date="2026-01-02")
    p1 = export_record(record, staging_dir=tmp_path)
    bytes1 = p1.read_bytes()
    p2 = export_record(record, staging_dir=tmp_path)
    bytes2 = p2.read_bytes()
    assert p1 == p2  # same deterministic filename
    assert bytes1 == bytes2  # identical bytes
    assert list(Path(tmp_path).glob("*.json")) == [p1]  # only one file


def test_export_key_order_is_stable_regardless_of_input_order():
    a = {"sourceUrl": "https://x/y", "retrievedDate": "2026-01-02", "company": "A", "genericName": "G"}
    b = {"genericName": "G", "company": "A", "retrievedDate": "2026-01-02", "sourceUrl": "https://x/y"}
    assert serialize(a) == serialize(b)
    assert record_filename(a) == record_filename(b)


def test_export_requires_provenance(tmp_path):
    with pytest.raises(ProvenanceError):
        export_record({"genericName": "X", "retrievedDate": "2026-01-02"}, staging_dir=tmp_path)
    with pytest.raises(ProvenanceError):
        export_record({"genericName": "X", "sourceUrl": "https://x/y"}, staging_dir=tmp_path)


def test_export_refuses_binary_values(tmp_path):
    record = normalize_record(base_parsed(), source_url="https://x.example/d", retrieved_date="2026-01-02")
    record["indications"] = record["indications"] + [b"\x00"]  # sneak in a binary
    with pytest.raises(TypeError):
        export_record(record, staging_dir=tmp_path)
