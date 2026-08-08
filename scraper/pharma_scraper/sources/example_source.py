"""Example source parser: turn fetched HTML into short factual fields.

Given already-fetched HTML (no network here), :class:`ExampleDrugSource`
extracts a handful of *factual* fields - generic name, brand name, company,
drug class, indications and target hints - using CSS selectors (Scrapling's
``::text`` pseudo-element, backed by lxml/cssselect). It deliberately selects
only short factual nodes; images and long marketing prose in the page are never
selected, so they cannot leak into staging. The source URL is carried along for
provenance.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

from scrapling import Selector

logger = logging.getLogger(__name__)

_WHITESPACE = re.compile(r"\s+")


def _clean(text: str) -> str:
    """Collapse runs of whitespace and strip the ends."""
    return _WHITESPACE.sub(" ", text).strip()


def _texts(sel: Selector, css: str) -> List[str]:
    """Return cleaned, non-empty text values for every node matching ``css``."""
    values: List[str] = []
    for node in sel.css(css):
        value = _clean(str(node))
        if value:
            values.append(value)
    return values


def _first(sel: Selector, css: str) -> Optional[str]:
    """Return the first cleaned text value matching ``css`` (or ``None``)."""
    values = _texts(sel, css)
    return values[0] if values else None


@dataclass
class ParsedRecord:
    """Raw factual fields extracted from a page, plus its source URL."""

    genericName: Optional[str] = None
    brandName: Optional[str] = None
    company: Optional[str] = None
    drugClass: Optional[str] = None
    indications: List[str] = field(default_factory=list)
    targetHints: List[str] = field(default_factory=list)
    sourceUrl: Optional[str] = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "genericName": self.genericName,
            "brandName": self.brandName,
            "company": self.company,
            "drugClass": self.drugClass,
            "indications": list(self.indications),
            "targetHints": list(self.targetHints),
            "sourceUrl": self.sourceUrl,
        }


class ExampleDrugSource:
    """Parse a drug fact page laid out with the selectors below.

    The selectors are intentionally specific to *short* factual nodes. There is
    no selector for ``<img>`` or free prose, which is how the parser upholds the
    copyright red-line at the extraction stage.
    """

    name = "example"

    def parse(self, html: Union[str, Selector], *, source_url: str) -> ParsedRecord:
        sel = html if isinstance(html, Selector) else Selector(str(html))
        record = ParsedRecord(
            genericName=_first(sel, "h1.drug-generic::text"),
            brandName=_first(sel, ".drug-brand::text"),
            company=_first(sel, '[data-field="company"]::text'),
            drugClass=_first(sel, '[data-field="drug-class"]::text'),
            indications=_texts(sel, "ul.indications > li::text"),
            targetHints=_texts(sel, '[data-field="target"]::text'),
            sourceUrl=source_url,
        )
        logger.debug("parsed %r from %s", record.genericName, source_url)
        return record
