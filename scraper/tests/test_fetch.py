"""Offline tests for the fetch wrapper (compliance + rate limiting + parsing)."""
from pharma_scraper.compliance import RateLimiter, RobotsChecker
from pharma_scraper.fetch import Fetcher, FetchResult


def allow_all(url):
    return "User-agent: *\nDisallow:\n"


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def time(self):
        return self.t

    def sleep(self, seconds):
        self.t += seconds


def test_fetch_allowed_url_returns_result_and_rate_limits():
    calls = []

    def fake_fetch(url):
        calls.append(url)
        return FetchResult(url=url, status=200, html="<h1 class='drug-generic'>X</h1>")

    clock = FakeClock()
    limiter = RateLimiter(min_delay=3.0, clock=clock.time, sleep=clock.sleep)
    fetcher = Fetcher(fake_fetch, robots=RobotsChecker(allow_all), rate_limiter=limiter)

    r1 = fetcher.fetch("https://acme.example/a")
    r2 = fetcher.fetch("https://acme.example/b")

    assert r1 is not None and r1.status == 200
    assert r2 is not None and r2.url == "https://acme.example/b"
    assert calls == ["https://acme.example/a", "https://acme.example/b"]
    assert clock.t == 3.0  # the second same-host call waited the min delay


def test_fetch_result_selector_parses_html():
    result = FetchResult(
        url="https://x.example/y",
        status=200,
        html="<h1 class='drug-generic'>Zanubrutinib</h1>",
    )
    selector = result.selector()
    assert "Zanubrutinib" in selector.get_all_text()
