"""Thin, injectable wrapper around Scrapling's HTTP fetching.

The real network backend (Scrapling's ``Fetcher``) is imported *lazily* inside
:func:`scrapling_get`, because it pulls optional heavy extras (curl_cffi /
browser engines). Keeping that import out of module scope means importing this
module - and running the entire test-suite - never needs those extras and never
touches the network. Tests inject a fake ``fetch_fn`` that returns a
:class:`FetchResult` built from a local HTML fixture.

:class:`Fetcher` wires compliance (robots.txt) and politeness (rate-limiting)
around every request: a disallowed URL is skipped and the reason logged; an
allowed URL is spaced out per host before the backend fetch runs.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable, Optional

# NOTE: ``Selector`` is the pure-lxml HTML parser and is safe to import at
# module scope (unlike Scrapling's network Fetcher, which needs curl_cffi).
from scrapling import Selector

from .compliance import RateLimiter, RobotsChecker

logger = logging.getLogger(__name__)


@dataclass
class FetchResult:
    """Minimal, backend-agnostic result of fetching a page."""

    url: str
    status: int
    html: str

    def selector(self) -> Selector:
        """Return a Scrapling :class:`Selector` over the fetched HTML."""
        return Selector(self.html)


def scrapling_get(url: str, *, timeout: float = 30.0) -> FetchResult:
    """Fetch ``url`` with Scrapling (live path; not exercised by offline tests).

    The Scrapling HTTP fetcher is imported here, on first use, so that optional
    runtime dependencies are only required when real fetching actually happens.
    """
    from scrapling import Fetcher as _ScraplingFetcher  # lazy: heavy optional deps

    page = _ScraplingFetcher.get(url, timeout=timeout)
    html = getattr(page, "html_content", None) or getattr(page, "body", "") or ""
    status = int(getattr(page, "status", 200) or 200)
    return FetchResult(url=url, status=status, html=str(html))


# A callable that performs the actual fetch. Injected so tests supply a fake.
FetchFn = Callable[[str], FetchResult]


class Fetcher:
    """Fetch pages while honouring robots.txt and per-host rate limits.

    Parameters
    ----------
    fetch_fn:
        The backend fetch callable. Defaults to :func:`scrapling_get`; tests
        pass a fake returning a :class:`FetchResult` from a fixture.
    robots:
        Optional :class:`~pharma_scraper.compliance.RobotsChecker`. When a URL
        is disallowed, :meth:`fetch` skips it (returns ``None``) and logs why.
    rate_limiter:
        Optional :class:`~pharma_scraper.compliance.RateLimiter` applied before
        each allowed fetch.
    """

    def __init__(
        self,
        fetch_fn: FetchFn = scrapling_get,
        *,
        robots: Optional[RobotsChecker] = None,
        rate_limiter: Optional[RateLimiter] = None,
    ) -> None:
        self._fetch_fn = fetch_fn
        self._robots = robots
        self._rate_limiter = rate_limiter

    def fetch(self, url: str) -> Optional[FetchResult]:
        """Fetch ``url``; return ``None`` (and log) if robots.txt disallows it."""
        if self._robots is not None and not self._robots.allow(url):
            logger.info("skipping %s: disallowed by robots.txt", url)
            return None
        if self._rate_limiter is not None:
            self._rate_limiter.wait(url)
        return self._fetch_fn(url)
