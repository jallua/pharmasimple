"""Normalize parsed source data into a staging record.

The normalized record is aligned with the site's drug content model
(``site/src/content.config.ts``): ``company``, ``genericName``, optional
``brandName`` / ``drugClass``, ``indications`` (list) and ``targetHints``, plus
the provenance fields ``sourceUrl`` and ``retrievedDate``.

Two guarantees are enforced here (design correctness property **P12** and the
copyright red-line, requirement 11.4):

* Every record carries a non-empty ``sourceUrl`` and ``retrievedDate``.
* Only short, whitelisted *factual* text is copied through. Unknown keys the
  parser might have produced (images, raw HTML, long prose) are dropped,
  ``bytes`` values are rejected, and every text field is capped in length so a
  long verbatim (copyrighted) block can never be smuggled into staging.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Union

logger = logging.getLogger(__name__)

# Cap for any single factual text field. Real values (drug/company names, a drug
# class, an individual indication) are short; the cap exists purely to stop a
# buggy or hostile parser from persisting a long verbatim block.
MAX_TEXT_LEN = 300

# The only keys the pipeline is willing to persist. Anything else the parser
# produced (images, thumbnails, raw HTML, long descriptions) is discarded.
_STRING_FIELDS = ("company", "genericName", "brandName", "drugClass")
_LIST_FIELDS = ("indications", "targetHints")

_WHITESPACE = re.compile(r"\s+")


class ProvenanceError(ValueError):
    """Raised when a record is missing required provenance (property P12)."""


def _coerce_text(value: Any) -> str:
    """Clean ``value`` into a bounded single-line string; reject binaries."""
    if isinstance(value, (bytes, bytearray, memoryview)):
        raise TypeError("binary values are not allowed in staging records")
    text = _WHITESPACE.sub(" ", str(value)).strip()
    return text[:MAX_TEXT_LEN]


def _clean_optional(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = _coerce_text(value)
    return text or None


def _clean_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, (str, bytes, bytearray)):
        items = [value]
    else:
        items = list(value)
    out: List[str] = []
    seen = set()
    for item in items:
        if item is None:
            continue
        text = _coerce_text(item)
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def _as_mapping(parsed: Any) -> Mapping[str, Any]:
    if isinstance(parsed, Mapping):
        return parsed
    if hasattr(parsed, "as_dict"):
        return parsed.as_dict()
    if hasattr(parsed, "__dict__"):
        return vars(parsed)
    raise TypeError(f"cannot normalize object of type {type(parsed)!r}")


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _to_iso_date(value: Union[str, date, datetime, None]) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    try:
        # accept an ISO date or the date part of an ISO datetime
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError as exc:
        # Provenance dates drive freshness decisions; malformed input must stop.
        raise ProvenanceError("retrievedDate must be an ISO-8601 date") from exc


def normalize_record(
    parsed: Any,
    *,
    source_url: Optional[str] = None,
    retrieved_date: Union[str, date, datetime, None] = None,
) -> Dict[str, Any]:
    """Return a staging record aligned with the drug content model.

    ``parsed`` may be a mapping, a :class:`~pharma_scraper.sources.example_source.ParsedRecord`,
    or any object exposing ``as_dict``/``__dict__``. Only whitelisted factual
    fields are read; everything else is ignored.

    Raises
    ------
    ProvenanceError
        If no non-empty ``sourceUrl`` can be determined (property P12).
    TypeError
        If a whitelisted field carries binary data.
    """
    data = _as_mapping(parsed)

    src = source_url if source_url is not None else data.get("sourceUrl")
    src = _clean_optional(src)
    if not src:
        raise ProvenanceError("record is missing a non-empty sourceUrl")

    raw_date = retrieved_date if retrieved_date is not None else data.get("retrievedDate")
    retrieved_iso = _to_iso_date(raw_date) or _today_iso()

    record: Dict[str, Any] = {
        "company": _clean_optional(data.get("company")),
        "genericName": _clean_optional(data.get("genericName")),
        "brandName": _clean_optional(data.get("brandName")),
        "drugClass": _clean_optional(data.get("drugClass")),
        "indications": _clean_list(data.get("indications")),
        "targetHints": _clean_list(data.get("targetHints")),
        "sourceUrl": src,
        "retrievedDate": retrieved_iso,
    }
    return record
