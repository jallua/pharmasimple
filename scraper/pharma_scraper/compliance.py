"""Compliance helpers that keep the crawler polite and law-abiding.

Everything here happens *before* a network request is made:

* :class:`RobotsChecker` fetches and parses ``robots.txt`` for a host and
  answers :meth:`RobotsChecker.allow` for a given URL. The actual HTTP fetch is
  injected as a callable, so the checker is unit-tested fully offline with a
  fake ``robots.txt`` body.
* :class:`RateLimiter` enforces a configurable minimum delay between requests to
  the same host and remembers the last-request time per host. Its clock and
  sleep functions are injectable, so a fake clock drives deterministic tests
  without real waiting.

When a URL is disallowed the pipeline skips it and logs the reason (wired in
``fetch.py`` / ``pipeline.py``).
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, Optional
from urllib.parse import urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

logger = logging.getLogger(__name__)

# A callable that, given a robots.txt URL, returns its text body (or ``None`` if
# the file is missing / unreachable). Injecting this keeps compliance testable.
RobotsFetch = Callable[[str], Optional[str]]


def host_key(url: str) -> str:
    """Return a ``scheme://netloc`` key identifying the host of ``url``."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def robots_url_for(url: str) -> str:
    """Return the canonical ``robots.txt`` URL for the host of ``url``."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, "/robots.txt", "", ""))


class RobotsChecker:
    """Fetch, cache and consult ``robots.txt`` for crawl permission.

    Parameters
    ----------
    fetch_text:
        Callable returning the ``robots.txt`` body for a URL, or ``None`` when
        the file is missing/unreachable. Injected so tests never hit the network.
    user_agent:
        The crawler's user-agent used when matching ``robots.txt`` rules.
    allow_on_missing:
        What to answer when there is no ``robots.txt`` (the common convention is
        to allow crawling; set ``False`` to be conservative instead).
    """

    def __init__(
        self,
        fetch_text: RobotsFetch,
        *,
        user_agent: str = "PharmaSimpleBot",
        allow_on_missing: bool = True,
    ) -> None:
        self._fetch_text = fetch_text
        self._user_agent = user_agent
        self._allow_on_missing = allow_on_missing
        # host -> parsed rules, or ``None`` when no robots.txt is available.
        self._cache: Dict[str, Optional[RobotFileParser]] = {}

    def _parser_for(self, url: str) -> Optional[RobotFileParser]:
        key = host_key(url)
        if key not in self._cache:
            body: Optional[str]
            try:
                body = self._fetch_text(robots_url_for(url))
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("failed to fetch robots.txt for %s: %r", key, exc)
                body = None
            if body is None:
                self._cache[key] = None
            else:
                parser = RobotFileParser()
                parser.parse(body.splitlines())
                self._cache[key] = parser
        return self._cache[key]

    def allow(self, url: str) -> bool:
        """Return ``True`` if ``url`` may be crawled per its ``robots.txt``."""
        parser = self._parser_for(url)
        if parser is None:
            return self._allow_on_missing
        return bool(parser.can_fetch(self._user_agent, url))


@dataclass
class RateLimiter:
    """Enforce a minimum spacing between requests to the same host.

    The clock and sleep callables are injectable. In tests a fake clock whose
    ``sleep`` advances its own time makes the spacing assertions deterministic
    and instant (no real waiting).
    """

    min_delay: float = 1.0
    clock: Callable[[], float] = time.monotonic
    sleep: Callable[[float], None] = time.sleep
    _last: Dict[str, float] = field(default_factory=dict, init=False, repr=False)

    def wait(self, url: str) -> float:
        """Block (via ``sleep``) until this host may be hit again.

        Returns the number of seconds actually slept (``0.0`` when no wait was
        needed), which makes the behaviour easy to assert in tests.
        """
        key = host_key(url)
        now = self.clock()
        last = self._last.get(key)
        slept = 0.0
        if last is not None:
            remaining = self.min_delay - (now - last)
            if remaining > 0:
                self.sleep(remaining)
                slept = remaining
                now = self.clock()
        self._last[key] = now
        return slept
