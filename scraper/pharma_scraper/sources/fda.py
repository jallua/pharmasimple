"""FDA adapter for the official openFDA drug-label JSON endpoint."""
from __future__ import annotations

import re
from typing import Any, Iterable, Mapping
from urllib.parse import urlencode

from .base import (
    AmbiguousResultError, DrugNameMismatchError, HTTPResponse,
    MissingDocumentIdError, SafeHTTPClient, SchemaChangedError,
    clean_fact, short_list, parse_json, record_from_response,
    require_active_moiety_match, require_name_match, unique_scalar,
)

_OPENFDA_HOST = "api.fda.gov"
_ENDPOINT = f"https://{_OPENFDA_HOST}/drug/label.json"
_SET_ID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_ENGLISH_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .,'()\-/+]*$")


def _array(obj: Mapping[str, Any], key: str) -> list[Any]:
    value = obj.get(key, [])
    if value is None:
        return []
    if not isinstance(value, list):
        raise SchemaChangedError(f"openFDA {key} is not an array")
    return value


class OpenFDADrugLabelSource:
    """Resolve one unambiguous current label by English generic name."""

    name = "fda-openfda-drug-label"
    parser_version = "openfda-label-v1"

    def __init__(self, client: SafeHTTPClient | None = None) -> None:
        # openFDA is a documented public API whose robots.txt endpoint returns 404.
        # The exception is explicit to this exact API host; URL allowlisting,
        # rate limiting, retries and response bounds remain enforced.
        self.client = client or SafeHTTPClient(
            {_OPENFDA_HOST},
            allow_missing_robots=True,
            max_response_bytes=8_000_000,
        )

    def fetch(self, generic_name: str):
        generic_name = generic_name.strip()
        if not _ENGLISH_NAME.fullmatch(generic_name):
            raise ValueError("openFDA queries require an English generic name")
        # Token search is required because many labels contain a salt/form suffix;
        # _matches() still performs the strict canonical-name check locally.
        query = f'openfda.generic_name:"{generic_name}"'
        url = f"{_ENDPOINT}?{urlencode({'search': query, 'sort': 'effective_time:desc', 'limit': 3})}"
        return self.parse_response(self.client.get(url, accept="application/json"), generic_name)

    def parse_response(self, response: HTTPResponse, requested_name: str):
        payload = parse_json(response)
        results = payload.get("results")
        if not isinstance(results, list):
            raise SchemaChangedError("openFDA response has no results array")
        matches = [item for item in results if self._matches(item, requested_name)]
        if not matches:
            require_name_match(requested_name, self._all_names(results))
            raise SchemaChangedError("openFDA matching result was not an object")
        # openFDA can return historical labels for the same exact generic name.
        # Select only a unique newest effective_time; equal newest versions remain
        # ambiguous and therefore blocked.
        versions = [(str(item.get("effective_time") or ""), item) for item in matches
                    if isinstance(item, Mapping)]
        newest = max((version for version, _ in versions), default="")
        winners = [item for version, item in versions if version == newest]
        if not newest or len(winners) != 1:
            raise AmbiguousResultError("openFDA has no unique newest matching label")
        return self._record(response, winners[0], requested_name)

    @staticmethod
    def _openfda(item: Any) -> Mapping[str, Any]:
        if not isinstance(item, Mapping) or not isinstance(item.get("openfda"), Mapping):
            raise SchemaChangedError("openFDA result lacks an openfda object")
        return item["openfda"]

    def _matches(self, item: Any, requested_name: str) -> bool:
        try:
            names = _array(self._openfda(item), "generic_name")
            require_active_moiety_match(requested_name, names)
            return True
        except (DrugNameMismatchError, SchemaChangedError):
            return False

    def _all_names(self, results: Iterable[Any]) -> Iterable[Any]:
        for item in results:
            for name in _array(self._openfda(item), "generic_name"):
                yield name

    def _record(self, response: HTTPResponse, item: Any, requested_name: str):
        if not isinstance(item, Mapping):
            raise SchemaChangedError("openFDA result is not an object")
        facts = self._openfda(item)
        if not self._matches(item, requested_name):
            raise DrugNameMismatchError("openFDA document does not match requested active ingredient")
        generic = requested_name.strip()
        set_id = item.get("set_id")
        if not isinstance(set_id, str) or not _SET_ID.fullmatch(set_id):
            raise MissingDocumentIdError("openFDA label lacks a stable SPL set_id")
        brands = _array(facts, "brand_name")
        companies = _array(facts, "manufacturer_name")
        classes = short_list(_array(facts, "pharm_class_epc") +
                             _array(facts, "pharm_class_moa") +
                             _array(facts, "pharm_class_cs"), field_name="pharmacologic class")
        drug_class = classes[0] if len(classes) == 1 else None
        indications = _array(item, "indications_and_usage")
        effective_time = item.get("effective_time")
        if not isinstance(effective_time, str) or not re.fullmatch(r"\d{8}", effective_time):
            raise SchemaChangedError("openFDA label lacks a valid effective_time version")
        return record_from_response(
            response=response, source_name=self.name, parser_version=self.parser_version,
            document_id=set_id.lower(), document_version=effective_time,
            generic_name=generic,
            brand_name=unique_scalar(brands, field_name="brandName"),
            company=unique_scalar(companies, field_name="company"),
            drug_class=drug_class, indications=indications, target_hints=classes,
        )


FDAOpenFDASource = OpenFDADrugLabelSource
FDASource = OpenFDADrugLabelSource
