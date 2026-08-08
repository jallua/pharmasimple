"""Fail-closed adapter for supplied official NMPA detail/announcement pages."""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qs, urlsplit

from lxml import etree, html

from .base import (
    ContentTypeError, HTTPResponse, MissingDocumentIdError, SafeHTTPClient,
    SchemaChangedError, SecurityError, canonical_name, media_type, record_from_response,
    require_name_match, short_list, unique_scalar,
)

_HOSTS = {"www.nmpa.gov.cn", "nmpa.gov.cn", "english.nmpa.gov.cn"}
_PAGE_ID = re.compile(r"(?:^|/)(?:c_)?([A-Za-z0-9_-]{6,})\.(?:s?html?|HTML?)$")
_DYNAMIC_MARKERS = ("enable javascript", "请开启javascript", "请启用javascript", "系统繁忙", "访问验证")


def _url_document_id(url: str) -> str:
    parsed = urlsplit(url)
    match = _PAGE_ID.search(parsed.path)
    values: list[str] = [match.group(1)] if match else []
    query = {k.casefold(): v for k, v in parse_qs(parsed.query).items()}
    for key in ("dataid", "itemid", "articleid", "id"):
        values.extend(v for v in query.get(key, []) if re.fullmatch(r"[A-Za-z0-9_-]{6,}", v))
    distinct = {v.casefold(): v for v in values}
    if len(distinct) != 1:
        raise MissingDocumentIdError("NMPA URL has no unique stable page identifier")
    return next(iter(distinct.values()))


def _label_values(root: Any, labels: set[str]) -> list[str]:
    output: list[str] = []
    for row in root.xpath("//tr"):
        cells = [re.sub(r"\s+", " ", " ".join(c.itertext())).strip()
                 for c in row.xpath("./th|./td")]
        for index, cell in enumerate(cells[:-1]):
            normalized = cell.rstrip("：:").strip()
            if normalized in labels and cells[index + 1]:
                output.append(cells[index + 1])
    for term in root.xpath("//dt"):
        label = re.sub(r"\s+", " ", " ".join(term.itertext())).strip().rstrip("：:")
        if label in labels:
            values = term.xpath("following-sibling::dd[1]")
            if values:
                output.append(re.sub(r"\s+", " ", " ".join(values[0].itertext())).strip())
    return output


class NMPAOfficialPageSource:
    name = "nmpa-official-page"
    parser_version = "nmpa-official-html-v1"

    def __init__(self, client: SafeHTTPClient | None = None) -> None:
        self.client = client or SafeHTTPClient(_HOSTS)

    def fetch(self, drug_name: str, *, citation_url: str):
        if not citation_url:
            raise ValueError("NMPA requires a supplied official detail/announcement URL")
        parsed = urlsplit(citation_url)
        if parsed.scheme.lower() != "https" or (parsed.hostname or "").lower() not in _HOSTS:
            raise SecurityError("NMPA citation must be an official HTTPS URL")
        _url_document_id(citation_url)
        response = self.client.get(citation_url, accept="text/html, application/xhtml+xml;q=0.9")
        return self.parse_response(response, drug_name)

    def parse_response(self, response: HTTPResponse, requested_name: str):
        if media_type(response) not in {"text/html", "application/xhtml+xml"}:
            raise ContentTypeError("NMPA citation did not return an HTML page")
        document_id = _url_document_id(response.final_url)
        try:
            root = html.fromstring(response.body)
        except (ValueError, TypeError, etree.ParserError) as exc:
            raise SchemaChangedError("NMPA HTML could not be decoded or parsed") from exc
        visible = re.sub(r"\s+", " ", " ".join(root.xpath("//body//text()[not(ancestor::script) and not(ancestor::style)]"))).strip()
        lower = visible.casefold()
        has_fact_structure = bool(root.xpath("//h1|//table|//dl"))
        if (len(visible) < 20 or not has_fact_structure or
                any(marker in lower for marker in _DYNAMIC_MARKERS)):
            raise SchemaChangedError("NMPA page is dynamic, blocked, or lacks server-rendered facts")
        generic_values = _label_values(root, {"药品通用名称", "通用名称", "药品名称", "Generic name"})
        headings = [re.sub(r"\s+", " ", t).strip() for t in root.xpath("//h1//text()") if t.strip()]
        if generic_values:
            generic = require_name_match(requested_name, generic_values)
            generic = unique_scalar(generic_values, field_name="genericName", required=True) or generic
        else:
            exact_headings = [h for h in headings if canonical_name(h) == canonical_name(requested_name)]
            generic = require_name_match(requested_name, exact_headings)
        brands = _label_values(root, {"商品名", "商品名称", "Brand name"})
        companies = _label_values(root, {
            "上市许可持有人", "药品上市许可持有人", "生产企业", "生产单位",
            "Marketing authorisation holder", "Manufacturer",
        })
        indications = _label_values(root, {"适应症", "功能主治", "适用范围", "Indications"})
        return record_from_response(
            response=response, source_name=self.name, parser_version=self.parser_version,
            document_id=f"nmpa:{document_id}", generic_name=generic,
            brand_name=unique_scalar(brands, field_name="brandName"),
            company=unique_scalar(companies, field_name="company"),
            indications=short_list(indications, field_name="indications"),
        )


NMPASource = NMPAOfficialPageSource
