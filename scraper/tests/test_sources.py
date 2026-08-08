"""Offline tests for the example source parser (parses a local HTML fixture)."""
from pathlib import Path

import pytest

from pharma_scraper.sources.example_source import ExampleDrugSource

FIXTURE = Path(__file__).parent / "fixtures" / "example_drug.html"
SOURCE_URL = "https://acme.example/drugs/zanubrutinib"


@pytest.fixture
def html():
    return FIXTURE.read_text(encoding="utf-8")


def test_parse_extracts_factual_fields(html):
    record = ExampleDrugSource().parse(html, source_url=SOURCE_URL)
    assert record.genericName == "Zanubrutinib"
    assert record.brandName == "Brukinsa"
    assert record.company == "BeiGene"
    assert record.drugClass == "BTK inhibitor"
    assert record.indications == [
        "Mantle cell lymphoma (MCL)",
        "Chronic lymphocytic leukemia (CLL)",
        "Waldenstrom macroglobulinemia (WM)",
    ]
    assert any("BTK" in hint for hint in record.targetHints)
    assert record.sourceUrl == SOURCE_URL


def test_parser_ignores_images_and_long_prose(html):
    record = ExampleDrugSource().parse(html, source_url=SOURCE_URL)
    blob = repr(record.as_dict())
    # The copyrighted image URL and long marketing prose must not be captured.
    assert "copyrighted-hero.png" not in blob
    assert "marketing prose" not in blob
    for value in record.as_dict().values():
        assert not isinstance(value, (bytes, bytearray))


def test_parser_accepts_prebuilt_selector(html):
    from scrapling import Selector

    record = ExampleDrugSource().parse(Selector(html), source_url=SOURCE_URL)
    assert record.genericName == "Zanubrutinib"
