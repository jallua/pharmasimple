"""Offline tests for robots.txt compliance and per-host rate limiting."""
import logging

import pytest

from pharma_scraper.compliance import RateLimiter, RobotsChecker, host_key, robots_url_for

ROBOTS_DISALLOW = "User-agent: *\nDisallow: /private/\n"
ROBOTS_ALLOW_ALL = "User-agent: *\nDisallow:\n"


def make_robots_fetcher(body=None, by_url=None):
    """Build a fake robots.txt fetcher that records the URLs it was asked for."""
    calls = []

    def fetch_text(url):
        calls.append(url)
        if by_url is not None:
            return by_url.get(url, body)
        return body

    fetch_text.calls = calls
    return fetch_text


class FakeClock:
    """A deterministic clock whose ``sleep`` advances its own time."""

    def __init__(self):
        self.t = 0.0

    def time(self):
        return self.t

    def sleep(self, seconds):
        self.t += seconds


def test_host_key_and_robots_url():
    assert host_key("https://acme.example/a/b?x=1") == "https://acme.example"
    assert robots_url_for("https://acme.example/a/b") == "https://acme.example/robots.txt"


def test_allow_false_for_disallowed_path():
    checker = RobotsChecker(make_robots_fetcher(body=ROBOTS_DISALLOW))
    assert checker.allow("https://acme.example/private/secret") is False
    assert checker.allow("https://acme.example/public/ok") is True


def test_robots_fetched_once_per_host_then_cached():
    fetch = make_robots_fetcher(body=ROBOTS_DISALLOW)
    checker = RobotsChecker(fetch)
    checker.allow("https://acme.example/a")
    checker.allow("https://acme.example/b")
    assert fetch.calls == ["https://acme.example/robots.txt"]


def test_missing_robots_defaults_to_allow():
    checker = RobotsChecker(make_robots_fetcher(body=None), allow_on_missing=True)
    assert checker.allow("https://acme.example/anything") is True


def test_missing_robots_can_be_conservative():
    checker = RobotsChecker(make_robots_fetcher(body=None), allow_on_missing=False)
    assert checker.allow("https://acme.example/anything") is False


def test_rate_limiter_enforces_min_spacing_same_host():
    clock = FakeClock()
    limiter = RateLimiter(min_delay=2.0, clock=clock.time, sleep=clock.sleep)
    assert limiter.wait("https://acme.example/1") == 0.0  # first call: no wait
    slept = limiter.wait("https://acme.example/2")  # immediate second call
    assert slept == 2.0
    assert clock.t == 2.0


def test_rate_limiter_is_per_host():
    clock = FakeClock()
    limiter = RateLimiter(min_delay=5.0, clock=clock.time, sleep=clock.sleep)
    limiter.wait("https://a.example/x")
    assert limiter.wait("https://b.example/y") == 0.0  # different host: no wait


def test_rate_limiter_no_wait_when_enough_time_elapsed():
    clock = FakeClock()
    limiter = RateLimiter(min_delay=1.0, clock=clock.time, sleep=clock.sleep)
    limiter.wait("https://a.example/x")
    clock.t += 5.0  # time passes on its own
    assert limiter.wait("https://a.example/y") == 0.0


def test_pipeline_skips_and_logs_disallowed_url(caplog):
    from pharma_scraper.fetch import Fetcher

    checker = RobotsChecker(make_robots_fetcher(body=ROBOTS_DISALLOW))

    def fake_fetch(url):  # pragma: no cover - must never be called
        raise AssertionError("disallowed URL must not be fetched")

    fetcher = Fetcher(fake_fetch, robots=checker)
    with caplog.at_level(logging.INFO):
        result = fetcher.fetch("https://acme.example/private/x")
    assert result is None
    assert any("disallowed" in record.getMessage() for record in caplog.records)
