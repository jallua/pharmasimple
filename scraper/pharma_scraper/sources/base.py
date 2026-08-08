"""Shared fail-closed contract and production HTTPS client for official sources."""
from __future__ import annotations

import email.utils
import hashlib
import json
import re
import time
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Mapping, Optional, Sequence
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

from ..compliance import RateLimiter

MAX_FACT_LENGTH = 300


class SourceAdapterError(RuntimeError): pass
class SecurityError(SourceAdapterError): pass
class NetworkError(SourceAdapterError): pass
class HTTPStatusError(SourceAdapterError): pass
class ResponseTooLargeError(SourceAdapterError): pass
class ContentTypeError(SourceAdapterError): pass
class ParseError(SourceAdapterError): pass
class SchemaChangedError(ParseError): pass
class DrugNameMismatchError(ParseError): pass
class AmbiguousResultError(ParseError): pass
class MissingDocumentIdError(ParseError): pass
class FieldConflictError(ParseError): pass
class RobotsDeniedError(SecurityError): pass


@dataclass(frozen=True)
class HTTPResponse:
    body: bytes
    final_url: str
    status: int
    content_type: str
    retrieved_at: str
    sha256: str

    def recomputed_sha256(self) -> str:
        return hashlib.sha256(self.body).hexdigest()


@dataclass(frozen=True)
class OfficialSourceRecord:
    """Bounded facts plus canonical provenance; raw bytes remain private/in-memory."""
    genericName: str
    sourceName: str
    finalUrl: str
    httpContentType: str
    retrievedAt: str
    rawResponseSha256: str
    documentId: str
    documentVersion: str
    parserVersion: str
    brandName: Optional[str] = None
    company: Optional[str] = None
    drugClass: Optional[str] = None
    indications: tuple[str, ...] = field(default_factory=tuple)
    targetHints: tuple[str, ...] = field(default_factory=tuple)
    _indication_excerpts: tuple[str, ...] = field(default_factory=tuple, repr=False, compare=False)
    _raw_body: bytes = field(default=b"", repr=False, compare=False)
    _container_body: bytes = field(default=b"", repr=False, compare=False)
    _transform_operation: str = field(default="", repr=False, compare=False)
    _transform_tool_version: str = field(default="", repr=False, compare=False)
    _transform_locator: str = field(default="", repr=False, compare=False)

    @property
    def sourceUrl(self) -> str: return self.finalUrl
    @property
    def contentType(self) -> str: return self.httpContentType
    @property
    def sha256(self) -> str: return self.rawResponseSha256

    def claims(self) -> dict[str, Any]:
        values = {
            "/company": self.company, "/genericName": self.genericName,
            "/brandName": self.brandName, "/drugClass": self.drugClass,
            "/indications": list(self.indications), "/targetHints": list(self.targetHints),
        }
        return {path: value for path, value in values.items() if value not in (None, "", [], {})}

    def as_dict(self) -> dict[str, Any]:
        return {
            "genericName": self.genericName, "brandName": self.brandName,
            "company": self.company, "drugClass": self.drugClass,
            "indications": list(self.indications), "targetHints": list(self.targetHints),
            "sourceName": self.sourceName, "sourceUrl": self.finalUrl,
            "finalUrl": self.finalUrl, "httpContentType": self.httpContentType,
            "retrievedAt": self.retrievedAt,
            "rawResponseSha256": self.rawResponseSha256,
            "documentId": self.documentId, "documentVersion": self.documentVersion,
            "parserVersion": self.parserVersion,
        }


class _HostCheckingRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self, validator: Any) -> None:
        super().__init__(); self._validator = validator
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str,
                         headers: Any, newurl: str) -> Any:
        self._validator(urljoin(req.full_url, newurl))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class SafeHTTPClient:
    """Production client: official HTTPS allowlist, robots, throttle, retries, limits."""
    RETRYABLE = frozenset({429, 503})

    def __init__(self, allowed_hosts: Iterable[str], *, timeout: float = 20.0,
                 max_response_bytes: int = 2_000_000, max_retries: int = 3,
                 backoff_base: float = 1.0, min_host_delay: float = 1.0,
                 opener: Any = None, robots_fetch: Callable[[str], Optional[str]] | None = None,
                 allow_missing_robots: bool = False, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.allowed_hosts = frozenset(h.lower().rstrip(".") for h in allowed_hosts)
        if not self.allowed_hosts:
            raise ValueError("allowed_hosts must not be empty")
        if timeout <= 0 or max_response_bytes <= 0 or max_retries < 0 or backoff_base < 0:
            raise ValueError("invalid HTTP safety limits")
        self.timeout, self.max_response_bytes = timeout, max_response_bytes
        self.max_retries, self.backoff_base = max_retries, backoff_base
        self._sleep = sleep
        self._opener = opener or urllib.request.build_opener(_HostCheckingRedirectHandler(self._validate_url))
        self._robots_fetch = robots_fetch or self._fetch_robots
        self._allow_missing_robots = allow_missing_robots
        self._robots: dict[str, Optional[RobotFileParser]] = {}
        self._rate = RateLimiter(min_delay=min_host_delay, clock=clock, sleep=sleep)

    def _validate_url(self, url: str) -> None:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme.lower() != "https":
            raise SecurityError("only HTTPS source URLs are allowed")
        if parsed.username or parsed.password or parsed.port not in (None, 443) or host not in self.allowed_hosts:
            raise SecurityError(f"URL host is not an allowed official host: {host or '<empty>'}")

    @staticmethod
    def _robots_url(url: str) -> str:
        parsed = urlsplit(url)
        return urlunsplit(("https", parsed.netloc, "/robots.txt", "", ""))

    def _bounded_read(self, response: Any, limit: int) -> bytes:
        raw_length = response.headers.get("Content-Length")
        if raw_length:
            try:
                if int(raw_length) > limit:
                    raise ResponseTooLargeError("response exceeds configured size limit")
            except ValueError as exc:
                raise SchemaChangedError("invalid Content-Length header") from exc
        body = response.read(limit + 1)
        if len(body) > limit:
            raise ResponseTooLargeError("response exceeds configured size limit")
        return body

    def _fetch_robots(self, url: str) -> Optional[str]:
        self._validate_url(url)
        self._rate.wait(url)
        request = urllib.request.Request(url, headers={"User-Agent": "PharmaSimple/1.0"}, method="GET")
        try:
            response = self._opener.open(request, timeout=self.timeout)
            try:
                self._validate_url(response.geturl())
                status = int(getattr(response, "status", response.getcode()))
                if status == 404:
                    return None
                if not 200 <= status < 300:
                    return None
                return self._bounded_read(response, min(self.max_response_bytes, 256_000)).decode("utf-8", "strict")
            finally:
                response.close()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            return None
        except (urllib.error.URLError, TimeoutError, OSError, UnicodeDecodeError):
            return None

    def _robots_allow(self, url: str) -> bool:
        key = self._robots_url(url)
        if key not in self._robots:
            body = self._robots_fetch(key)
            if body is None:
                self._robots[key] = None
            else:
                parser = RobotFileParser(); parser.parse(body.splitlines()); self._robots[key] = parser
        parser = self._robots[key]
        return self._allow_missing_robots if parser is None else bool(parser.can_fetch("PharmaSimple/1.0", url))

    def _retry_delay(self, headers: Any, attempt: int) -> float:
        value = headers.get("Retry-After") if headers is not None else None
        if value:
            try:
                return min(max(float(value), 0.0), 120.0)
            except ValueError:
                try:
                    target = email.utils.parsedate_to_datetime(value)
                    return min(max((target - datetime.now(timezone.utc)).total_seconds(), 0.0), 120.0)
                except (TypeError, ValueError):
                    pass
        return min(self.backoff_base * (2 ** attempt), 120.0)

    def get(self, url: str, *, accept: str = "application/json, text/html;q=0.9") -> HTTPResponse:
        self._validate_url(url)
        if not self._robots_allow(url):
            raise RobotsDeniedError("robots.txt unavailable or disallows this official URL")
        request = urllib.request.Request(url, headers={
            "Accept": accept, "User-Agent": "PharmaSimple/1.0 (official-source-ingestion)"
        }, method="GET")
        for attempt in range(self.max_retries + 1):
            self._rate.wait(url)
            try:
                response = self._opener.open(request, timeout=self.timeout)
            except urllib.error.HTTPError as exc:
                if exc.code in self.RETRYABLE and attempt < self.max_retries:
                    self._sleep(self._retry_delay(exc.headers, attempt)); continue
                raise HTTPStatusError(f"official source returned HTTP {exc.code}") from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                raise NetworkError("official source request failed") from exc
            try:
                final_url = response.geturl(); self._validate_url(final_url)
                status = int(getattr(response, "status", None) or response.getcode())
                if status in self.RETRYABLE and attempt < self.max_retries:
                    delay = self._retry_delay(response.headers, attempt)
                    response.close(); self._sleep(delay); continue
                if not 200 <= status < 300:
                    raise HTTPStatusError(f"official source returned HTTP {status}")
                content_type = (response.headers.get("Content-Type") or "").strip()
                if not content_type:
                    raise ContentTypeError("response has no Content-Type")
                body = self._bounded_read(response, self.max_response_bytes)
            finally:
                response.close()
            retrieved = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            digest = hashlib.sha256(body).hexdigest()
            return HTTPResponse(body, final_url, status, content_type, retrieved, digest)
        raise HTTPStatusError("retry budget exhausted")


def media_type(response: HTTPResponse) -> str:
    return response.content_type.partition(";")[0].strip().lower()


def parse_json(response: HTTPResponse) -> Mapping[str, Any]:
    if media_type(response) not in {"application/json", "application/fhir+json", "text/json"}:
        raise ContentTypeError(f"expected JSON, got {response.content_type!r}")
    try:
        value = json.loads(response.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SchemaChangedError("official JSON response could not be decoded") from exc
    if not isinstance(value, Mapping):
        raise SchemaChangedError("official JSON root is not an object")
    return value


def clean_fact(value: Any, *, field_name: str = "field") -> Optional[str]:
    if value is None: return None
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise SchemaChangedError(f"{field_name} is not scalar text")
    text = re.sub(r"\s+", " ", str(value)).strip()
    if not text: return None
    if len(text) > MAX_FACT_LENGTH:
        raise SchemaChangedError(f"{field_name} is not a short factual value")
    return text


def unique_scalar(values: Iterable[Any], *, field_name: str, required: bool = False) -> Optional[str]:
    cleaned = [clean_fact(v, field_name=field_name) for v in values]
    distinct = {v.casefold(): v for v in cleaned if v}
    if len(distinct) > 1: raise FieldConflictError(f"conflicting {field_name} values")
    value = next(iter(distinct.values()), None)
    if required and value is None: raise SchemaChangedError(f"missing required {field_name}")
    return value


def short_list(values: Iterable[Any], *, field_name: str, maximum: int = 20) -> tuple[str, ...]:
    output: list[str] = []; seen: set[str] = set()
    for value in values:
        text = clean_fact(value, field_name=field_name)
        if text and text.casefold() not in seen:
            seen.add(text.casefold()); output.append(text)
        if len(output) > maximum: raise SchemaChangedError(f"too many {field_name} values")
    return tuple(output)


def canonical_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(re.findall(r"[^\W_]+", normalized, flags=re.UNICODE))


def require_name_match(requested: str, candidates: Iterable[Any]) -> str:
    wanted = canonical_name(requested)
    if not wanted: raise DrugNameMismatchError("requested drug name is empty")
    valid = [clean_fact(v, field_name="genericName") for v in candidates]
    matches = [v for v in valid if v and canonical_name(v) == wanted]
    if not matches: raise DrugNameMismatchError("official document does not match requested drug name")
    return unique_scalar(matches, field_name="genericName", required=True) or ""


def record_from_response(*, response: HTTPResponse, source_name: str,
                         parser_version: str, document_id: str, generic_name: str,
                         document_version: str | None = None,
                         brand_name: Optional[str] = None, company: Optional[str] = None,
                         drug_class: Optional[str] = None, indications: Sequence[str] = (),
                         target_hints: Sequence[str] = (),
                         container_response: HTTPResponse | None = None,
                         transform_operation: str = "",
                         transform_locator: str = "") -> OfficialSourceRecord:
    document_id = clean_fact(document_id, field_name="documentId") or ""
    if not document_id: raise MissingDocumentIdError("official document has no stable document ID")
    recomputed = hashlib.sha256(response.body).hexdigest()
    if response.sha256.lower().removeprefix("sha256:") != recomputed:
        raise SecurityError("HTTP response SHA-256 does not match its raw body")
    version = clean_fact(document_version, field_name="documentVersion") if document_version else f"sha256:{recomputed}"
    short_indications: list[str] = []
    indication_excerpts: list[str] = []
    seen_short: set[str] = set()
    seen_excerpts: set[str] = set()
    total_indication_chars = 0
    for value in indications:
        if not isinstance(value, str):
            raise SchemaChangedError("indications must contain text")
        text = re.sub(r"\s+", " ", value).strip()
        if not text:
            continue
        total_indication_chars += len(text)
        if total_indication_chars > 500_000:
            raise SchemaChangedError("indication excerpts exceed the aggregate safety limit")
        folded = text.casefold()
        if len(text) <= MAX_FACT_LENGTH:
            if folded not in seen_short:
                seen_short.add(folded)
                short_indications.append(text)
        elif len(text) <= 50_000:
            if folded not in seen_excerpts:
                seen_excerpts.add(folded)
                indication_excerpts.append(text)
        else:
            raise SchemaChangedError("indication excerpt exceeds the safety limit")
        if len(short_indications) + len(indication_excerpts) > 64:
            raise SchemaChangedError("too many indications")
    container_body = container_response.body if container_response is not None else b""
    if container_response is not None:
        container_digest = hashlib.sha256(container_body).hexdigest()
        if container_response.sha256.lower().removeprefix("sha256:") != container_digest:
            raise SecurityError("container response SHA-256 does not match its raw body")
        if not transform_operation:
            raise SecurityError("derived evidence requires an explicit transformation operation")
    return OfficialSourceRecord(
        genericName=clean_fact(generic_name, field_name="genericName") or "",
        brandName=clean_fact(brand_name, field_name="brandName"), company=clean_fact(company, field_name="company"),
        drugClass=clean_fact(drug_class, field_name="drugClass"),
        indications=tuple(short_indications),
        targetHints=short_list(target_hints, field_name="targetHints"),
        sourceName=source_name, finalUrl=response.final_url, httpContentType=response.content_type,
        retrievedAt=response.retrieved_at, rawResponseSha256=f"sha256:{recomputed}",
        documentId=document_id, documentVersion=version or "", parserVersion=parser_version,
        _indication_excerpts=tuple(indication_excerpts), _raw_body=response.body,
        _container_body=container_body, _transform_operation=transform_operation,
        _transform_tool_version=parser_version if container_response is not None else "",
        _transform_locator=transform_locator,
    )



_ALLOWED_ACTIVE_MOIETY_SUFFIXES = frozenset({
    "acetate", "besylate", "calcium", "citrate", "fumarate", "hydrate",
    "hydrochloride", "maleate", "mesylate", "monohydrate", "phosphate",
    "potassium", "sodium", "succinate", "sulfate", "tartrate", "tosylate",
})


def require_active_moiety_match(requested: str, candidates: Iterable[Any]) -> str:
    """Accept an exact name or a deterministic salt/hydrate suffix only."""
    wanted = canonical_name(requested)
    if not wanted:
        raise DrugNameMismatchError("requested drug name is empty")
    wanted_tokens = wanted.split()
    matches: list[str] = []
    for value in candidates:
        text = clean_fact(value, field_name="genericName")
        if not text:
            continue
        actual_tokens = canonical_name(text).split()
        suffix = actual_tokens[len(wanted_tokens):]
        allowed_form_suffix = suffix and all(
            token in _ALLOWED_ACTIVE_MOIETY_SUFFIXES for token in suffix
        )
        allowed_biologic_suffix = (
            len(suffix) == 1
            and re.fullmatch(r"[a-z]{4}", suffix[0]) is not None
            and wanted_tokens[-1].endswith(("mab", "cept"))
        )
        if actual_tokens == wanted_tokens or (
                actual_tokens[:len(wanted_tokens)] == wanted_tokens
                and (allowed_form_suffix or allowed_biologic_suffix)):
            matches.append(text)
    if not matches:
        raise DrugNameMismatchError("official document does not match requested active ingredient")
    unique_scalar(matches, field_name="genericName", required=True)
    return requested.strip()
