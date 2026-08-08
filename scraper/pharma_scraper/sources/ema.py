"""EMA official medicine/EPAR HTML or JSON citation adapter."""
from __future__ import annotations

import re
from typing import Any, Iterable, Mapping

from urllib.parse import urlsplit

from lxml import etree, html

from .base import (
    ContentTypeError, HTTPResponse, MissingDocumentIdError, SafeHTTPClient,
    SchemaChangedError, clean_fact, media_type, parse_json, record_from_response,
    require_name_match, short_list, unique_scalar,
)

_HOSTS = {"www.ema.europa.eu", "ema.europa.eu"}
_EMA_NUMBER = re.compile(r"\b(?:EMEA/H/C/\d{4,}|EU/\d/\d{2}/\d{3,4})\b", re.I)


def _deep_values(value: Any, keys: set[str]) -> Iterable[Any]:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if key.casefold() in keys:
                if isinstance(child, list):
                    yield from child
                elif isinstance(child, Mapping):
                    for name_key in ("name", "label", "value", "id"):
                        if name_key in child:
                            yield child[name_key]
                else:
                    yield child
            yield from _deep_values(child, keys)
    elif isinstance(value, list):
        for child in value:
            yield from _deep_values(child, keys)


def _texts(root: Any, class_fragment: str) -> list[str]:
    fields = root.xpath(
        f"//*[contains(concat(' ', normalize-space(@class), ' '), ' {class_fragment} ')]")
    output: list[str] = []
    for field in fields:
        items = field.xpath(
            ".//*[contains(concat(' ', normalize-space(@class), ' '), ' field__item ')]")
        for node in items or [field]:
            text = " ".join(node.itertext()).strip()
            text = re.sub(r"\s+", " ", text)
            text = re.sub(r"^[^:：]{1,60}[:：]\s*", "", text)
            if text and len(text) <= 300:
                output.append(text)
    return output


class EMAMedicineSource:
    """Fetch a caller-supplied official EMA medicine/EPAR citation URL."""

    name = "ema-medicine-epar"
    parser_version = "ema-medicine-epar-v1"

    def __init__(self, client: SafeHTTPClient | None = None) -> None:
        self.client = client or SafeHTTPClient(_HOSTS)

    def fetch(self, drug_name: str, *, citation_url: str):
        if not citation_url:
            raise ValueError("EMA requires an official medicine/EPAR citation URL")
        parsed = urlsplit(citation_url)
        if parsed.scheme.lower() != "https" or (parsed.hostname or "").lower() not in _HOSTS or not parsed.path.strip("/"):
            from .base import SecurityError
            raise SecurityError("EMA citation must be an official HTTPS detail URL")
        response = self.client.get(citation_url,
            accept="application/json, text/html;q=0.9, application/xhtml+xml;q=0.8")
        return self.parse_response(response, drug_name)

    def parse_response(self, response: HTTPResponse, requested_name: str):
        kind = media_type(response)
        if kind in {"application/json", "text/json"}:
            return self._parse_json(response, requested_name)
        if kind in {"text/html", "application/xhtml+xml"}:
            return self._parse_html(response, requested_name)
        raise ContentTypeError(f"unsupported EMA content type: {response.content_type!r}")

    def _parse_json(self, response: HTTPResponse, requested: str):
        payload = parse_json(response)
        active = list(_deep_values(payload, {"active_substance", "activesubstance",
                                            "active_substances", "substance_name"}))
        products = list(_deep_values(payload, {"medicine_name", "medicinename",
                                              "product_name", "productname", "title"}))
        generic = require_name_match(requested, active + products)
        if active:
            generic = unique_scalar(active, field_name="genericName", required=True) or generic
        identifiers = list(_deep_values(payload, {"epar_id", "eparid", "ema_product_number",
                                                   "product_number", "document_id", "uuid"}))
        document_id = unique_scalar(identifiers, field_name="documentId")
        if not document_id:
            raise MissingDocumentIdError("EMA JSON has no stable EPAR/document identifier")
        companies = list(_deep_values(payload, {"marketing_authorisation_holder",
                                                 "marketingauthorizationholder", "ma_holder"}))
        areas = list(_deep_values(payload, {"therapeutic_area", "therapeuticarea"}))
        indications = list(_deep_values(payload, {"therapeutic_indication", "therapeuticindication", "indication"}))
        brands = products if active else []
        return record_from_response(
            response=response, source_name=self.name, parser_version=self.parser_version,
            document_id=f"ema:{document_id}", generic_name=generic,
            brand_name=unique_scalar(brands, field_name="brandName"),
            company=unique_scalar(companies, field_name="company"),
            indications=short_list(indications, field_name="indications"),
            target_hints=short_list(areas, field_name="therapeutic area"),
        )

    def _parse_html(self, response: HTTPResponse, requested: str):
        try:
            root = html.fromstring(response.body)
        except (ValueError, TypeError, etree.ParserError) as exc:
            raise SchemaChangedError("EMA HTML could not be decoded or parsed") from exc
        h1 = [re.sub(r"\s+", " ", t).strip() for t in root.xpath("//h1//text()")]
        h1 = [t for t in h1 if t]
        active = (_texts(root, "field--name-field-medicine-active-substance") or
                  _texts(root, "field--name-field-active-substance"))
        generic = require_name_match(requested, active + h1)
        if active:
            generic = unique_scalar(active, field_name="genericName", required=True) or generic
        page_text = " ".join(root.itertext())
        identifiers = list(dict.fromkeys(m.upper() for m in _EMA_NUMBER.findall(page_text)))
        node_ids = root.xpath("//*[@data-history-node-id]/@data-history-node-id")
        if identifiers:
            document_id = unique_scalar(identifiers, field_name="documentId", required=True)
        elif len(set(node_ids)) == 1 and str(node_ids[0]).isdigit():
            document_id = f"node-{node_ids[0]}"
        else:
            raise MissingDocumentIdError("EMA page has no stable EPAR or node identifier")

        companies = (_texts(root, "field--name-field-medicine-ma-holder") or
                     _texts(root, "field--name-field-marketing-authorisation-holder"))
        areas = (_texts(root, "field--name-field-medicine-therapeutic-area") or
                 _texts(root, "field--name-field-therapeutic-area"))
        indications = (_texts(root, "field--name-field-therapeutic-indication") or
                       _texts(root, "field--name-field-medicine-therapeutic-indication"))
        brand = unique_scalar(h1, field_name="brandName") if active else None
        return record_from_response(
            response=response, source_name=self.name, parser_version=self.parser_version,
            document_id=f"ema:{document_id}", generic_name=generic, brand_name=brand,
            company=unique_scalar(companies, field_name="company"),
            indications=short_list(indications, field_name="indications"),
            target_hints=short_list(areas, field_name="therapeutic area"),
        )


EMASource = EMAMedicineSource
