"""DailyMed v2 search plus canonical SPL XML detail adapter."""
from __future__ import annotations

import hashlib
import io
import re
import zipfile
from typing import Any, Mapping
from urllib.parse import parse_qs, quote, urlencode, urlsplit

from lxml import etree

from .base import (
    AmbiguousResultError, ContentTypeError, HTTPResponse, MissingDocumentIdError,
    SafeHTTPClient, SchemaChangedError, canonical_name, media_type, parse_json,
    record_from_response, require_active_moiety_match, require_name_match,
    short_list, unique_scalar,
)

_HOST = "dailymed.nlm.nih.gov"
_ROOT = f"https://{_HOST}/dailymed/services/v2/spls"
_SETID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _rows(payload: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    value = payload.get("data", payload.get("results"))
    if isinstance(value, Mapping):
        value = value.get("spls", value.get("items"))
    if not isinstance(value, list) or not all(isinstance(v, Mapping) for v in value):
        raise SchemaChangedError("DailyMed response has no recognized result array")
    return value


def _setid(row: Mapping[str, Any]) -> str:
    value = row.get("setid", row.get("setId", row.get("set_id")))
    if not isinstance(value, str) or not _SETID.fullmatch(value):
        raise MissingDocumentIdError("DailyMed SPL lacks a stable setid")
    return value.lower()


def _candidate_names(row: Mapping[str, Any]) -> list[Any]:
    values: list[Any] = []
    for key in ("generic_name", "genericName", "drug_name", "drugName", "title"):
        value = row.get(key)
        values.extend(value if isinstance(value, list) else [value] if value is not None else [])
    drug_names = row.get("drug_names", row.get("drugNames", []))
    if isinstance(drug_names, list):
        for value in drug_names:
            values.append(value.get("name") if isinstance(value, Mapping) else value)
    return values


def _xpath_texts(root: Any, expression: str) -> list[str]:
    values: list[str] = []
    for node in root.xpath(expression):
        text = node if isinstance(node, str) else " ".join(node.itertext())
        cleaned = re.sub(r"\s+", " ", text).strip()
        if cleaned:
            values.append(cleaned)
    return values


class DailyMedSPLSource:
    name = "dailymed-spl-v2"
    parser_version = "dailymed-spl-xml-v2"

    def __init__(self, client: SafeHTTPClient | None = None) -> None:
        self.client = client or SafeHTTPClient(
            {_HOST}, allow_missing_robots=True, max_response_bytes=10_000_000
        )

    def fetch(self, generic_name: str, *, citation_url: str | None = None):
        requested_setid = self.setid_from_citation(citation_url) if citation_url else None
        if requested_setid is None:
            params = urlencode({"drug_name": generic_name, "pagesize": 20})
            search = self.client.get(f"{_ROOT}.json?{params}", accept="application/json")
            requested_setid = self._choose(_rows(parse_json(search)), generic_name)
        detail_url = (
            f"https://{_HOST}/dailymed/getFile.cfm?"
            f"{urlencode({'setid': requested_setid, 'type': 'zip'})}"
        )
        detail = self.client.get(detail_url, accept="application/zip, application/octet-stream;q=0.9")
        return self.parse_response(detail, generic_name, expected_setid=requested_setid)

    @staticmethod
    def setid_from_citation(url: str) -> str:
        parsed = urlsplit(url)
        if parsed.scheme.lower() != "https" or (parsed.hostname or "").lower() != _HOST:
            from .base import SecurityError
            raise SecurityError("DailyMed citation URL is not an official HTTPS URL")
        query = {k.lower(): v for k, v in parse_qs(parsed.query).items()}
        candidates = query.get("setid", [])
        candidates += re.findall(r"[0-9a-fA-F-]{36}", parsed.path)
        valid = {v.lower() for v in candidates if _SETID.fullmatch(v)}
        if len(valid) != 1:
            raise MissingDocumentIdError("DailyMed citation URL has no unique setid")
        return valid.pop()

    @staticmethod
    def _score(row: Mapping[str, Any], requested: str) -> int:
        wanted = canonical_name(requested); scores: list[int] = []
        for value in _candidate_names(row):
            if not isinstance(value, str): continue
            actual = canonical_name(value)
            if actual == wanted: scores.append(3)
            elif actual.startswith(wanted + " "): scores.append(2)
            elif f" {wanted} " in f" {actual} ": scores.append(1)
        return max(scores, default=0)

    def _choose(self, rows: list[Mapping[str, Any]], requested: str) -> str:
        scored = [(self._score(row, requested), row) for row in rows]
        best = max((score for score, _ in scored), default=0)
        winners = [row for score, row in scored if score == best and score > 0]
        if len(winners) != 1:
            if len(winners) > 1:
                raise AmbiguousResultError("DailyMed search has multiple best matches")
            require_name_match(requested, [v for row in rows for v in _candidate_names(row)])
            raise SchemaChangedError("DailyMed search result could not be selected")
        return _setid(winners[0])

    def parse_response(self, response: HTTPResponse, requested_name: str,
                       *, expected_setid: str | None = None):
        kind = media_type(response)
        if kind in {"application/zip", "application/x-zip-compressed", "application/octet-stream"} or response.body.startswith(b"PK"):
            return self._parse_zip(response, requested_name, expected_setid=expected_setid)
        if kind in {"application/xml", "text/xml", "application/spl+xml"}:
            return self._parse_xml(response, requested_name, expected_setid=expected_setid)
        if kind in {"application/json", "text/json"}:
            return self._parse_legacy_json(response, requested_name, expected_setid=expected_setid)
        raise ContentTypeError(f"unsupported DailyMed content type: {response.content_type!r}")

    def _parse_zip(self, response: HTTPResponse, requested_name: str,
                   *, expected_setid: str | None):
        try:
            archive = zipfile.ZipFile(io.BytesIO(response.body))
            infos = [info for info in archive.infolist() if not info.is_dir() and info.filename.lower().endswith(".xml")]
            if len(infos) != 1:
                raise SchemaChangedError("DailyMed ZIP must contain exactly one SPL XML file")
            info = infos[0]
            normalized = info.filename.replace("\\", "/")
            if normalized.startswith("/") or "../" in f"/{normalized}":
                raise SchemaChangedError("DailyMed ZIP contains an unsafe XML path")
            if info.file_size <= 0 or info.file_size > 5_000_000:
                raise SchemaChangedError("DailyMed SPL XML exceeds the uncompressed size limit")
            xml = archive.read(info)
        except (zipfile.BadZipFile, RuntimeError, OSError) as exc:
            raise SchemaChangedError("DailyMed SPL ZIP could not be parsed safely") from exc
        extracted = HTTPResponse(
            body=xml,
            final_url=response.final_url,
            status=response.status,
            content_type="application/xml",
            retrieved_at=response.retrieved_at,
            sha256=hashlib.sha256(xml).hexdigest(),
        )
        return self._parse_xml(
            extracted,
            requested_name,
            expected_setid=expected_setid,
            container_response=response,
            transform_locator=normalized,
        )

    def _parse_xml(self, response: HTTPResponse, requested_name: str,
                   *, expected_setid: str | None,
                   container_response: HTTPResponse | None = None,
                   transform_locator: str = ""):
        try:
            parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False,
                                     recover=False, huge_tree=False)
            root = etree.fromstring(response.body, parser=parser)
        except (etree.XMLSyntaxError, ValueError) as exc:
            raise SchemaChangedError("DailyMed SPL XML could not be parsed safely") from exc
        setids = _xpath_texts(root, "/*[local-name()='document']/*[local-name()='setId']/@root")
        if len(setids) != 1 or not _SETID.fullmatch(setids[0]):
            raise MissingDocumentIdError("DailyMed SPL XML has no unique setId")
        document_id = setids[0].lower()
        if expected_setid and document_id != expected_setid.lower():
            raise MissingDocumentIdError("DailyMed SPL setId differs from requested setId")
        versions = _xpath_texts(root, "/*[local-name()='document']/*[local-name()='versionNumber']/@value")
        version = unique_scalar(versions, field_name="documentVersion", required=True)

        generics = _xpath_texts(root,
            "//*[local-name()='asEntityWithGeneric']/*[local-name()='genericMedicine']/*[local-name()='name']")
        generic = require_active_moiety_match(requested_name, generics)
        products = _xpath_texts(root,
            "//*[local-name()='manufacturedProduct']/*[local-name()='manufacturedProduct']/*[local-name()='name']")
        brands = [name for name in products if canonical_name(name) != canonical_name(generic)]
        companies = _xpath_texts(root,
            "//*[local-name()='author']//*[local-name()='representedOrganization']/*[local-name()='name']")
        classes = _xpath_texts(root,
            "//*[local-name()='pharmClass']/*[local-name()='name'] | //*[local-name()='pharmacologicClass']/*[local-name()='name']")
        indications = _xpath_texts(root,
            "//*[local-name()='section'][.//*[local-name()='code' and @code='34067-9']]//*[local-name()='text']")
        if not indications:
            raise SchemaChangedError("DailyMed SPL XML has no indications and usage section")
        class_values = short_list(classes, field_name="pharmacologic class")
        return record_from_response(
            response=response, source_name=self.name, parser_version=self.parser_version,
            document_id=document_id, document_version=version, generic_name=generic,
            brand_name=unique_scalar(brands, field_name="brandName"),
            company=unique_scalar(companies, field_name="company"),
            drug_class=class_values[0] if len(class_values) == 1 else None,
            indications=indications, target_hints=class_values,
            container_response=container_response,
            transform_operation="zip-entry" if container_response is not None else "",
            transform_locator=transform_locator,
        )

    def _parse_legacy_json(self, response: HTTPResponse, requested_name: str,
                           *, expected_setid: str | None):
        rows = _rows(parse_json(response))
        if len(rows) != 1:
            raise AmbiguousResultError("DailyMed SPL detail did not return exactly one record")
        row = rows[0]; document_id = _setid(row)
        if expected_setid and document_id != expected_setid.lower():
            raise MissingDocumentIdError("DailyMed detail setid differs from requested setid")
        names = _candidate_names(row)
        if self._score(row, requested_name) == 0: require_name_match(requested_name, names)
        generic_values = [row.get("generic_name"), row.get("genericName")]
        generic_values = [v for v in generic_values if v is not None]
        generic = require_active_moiety_match(requested_name, generic_values) if generic_values else requested_name.strip()
        brands = row.get("brand_names", row.get("brandNames", [])); brands = brands if isinstance(brands, list) else [brands]
        companies = [row.get(k) for k in ("labeler_name", "manufacturer_name", "company") if row.get(k) is not None]
        classes = row.get("pharmacologic_classes", row.get("drug_classes", [])); classes = classes if isinstance(classes, list) else [classes]
        indications = row.get("indications", row.get("indications_and_usage", [])); indications = indications if isinstance(indications, list) else [indications]
        version = row.get("version_number", row.get("versionNumber"))
        if version is None: raise SchemaChangedError("DailyMed detail has no document version")
        class_values = short_list(classes, field_name="pharmacologic class")
        return record_from_response(
            response=response, source_name=self.name, parser_version=self.parser_version,
            document_id=document_id, document_version=str(version), generic_name=generic,
            brand_name=unique_scalar(brands, field_name="brandName"), company=unique_scalar(companies, field_name="company"),
            drug_class=class_values[0] if len(class_values) == 1 else None,
            indications=indications, target_hints=class_values,
        )


DailyMedSource = DailyMedSPLSource
