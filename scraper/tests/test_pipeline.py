"""Offline end-to-end pipeline test: fetch -> parse -> normalize -> export."""
import json
from pathlib import Path

from pharma_scraper.compliance import RobotsChecker
from pharma_scraper.fetch import Fetcher, FetchResult
from pharma_scraper.pipeline import stage_urls

FIXTURE = Path(__file__).parent / "fixtures" / "example_drug.html"


def robots_disallow_private(url):
    return "User-agent: *\nDisallow: /private/\n"


def test_pipeline_stages_allowed_and_skips_disallowed(tmp_path):
    html = FIXTURE.read_text(encoding="utf-8")

    def fake_fetch(url):
        return FetchResult(url=url, status=200, html=html)

    fetcher = Fetcher(fake_fetch, robots=RobotsChecker(robots_disallow_private))
    urls = [
        "https://acme.example/drugs/zanubrutinib",
        "https://acme.example/private/secret-drug",  # disallowed -> skipped
    ]

    written = stage_urls(urls, fetcher=fetcher, staging_dir=tmp_path, retrieved_date="2026-02-03")

    assert len(written) == 1  # the disallowed URL was skipped
    data = json.loads(written[0].read_text(encoding="utf-8"))
    assert data["genericName"] == "Zanubrutinib"
    assert data["company"] == "BeiGene"
    assert data["sourceUrl"] == "https://acme.example/drugs/zanubrutinib"
    assert data["retrievedDate"] == "2026-02-03"
    # provenance present, copyrighted asset absent
    assert "copyrighted-hero.png" not in json.dumps(data, ensure_ascii=False)
