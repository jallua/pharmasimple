"""Canonical evidence v2: immutable documents, excerpts, and scoped atomic facts."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import urlsplit

from .evidence import EvidenceError, SOURCE_IDS, raw_sha256

SCHEMA_ID = "pharmasimple.canonical-evidence-v2"
SCHEMA_VERSION = "2.0.0"
SHA256_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")
ID_PATTERN = re.compile(r"^(?:evidence|excerpt|fact)-[a-f0-9]{64}$")
SET_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
MAX_EXCERPT_LENGTH = 50_000
SOURCE_SCOPE = {
    "fda-openfda-drug-label": ("US", "label"),
    "dailymed-spl-v2": ("US", "label"),
    "ema-medicine-epar": ("EU", "regulatory-product"),
    "nmpa-official-page": ("CN", "regulatory-product"),
}
PREDICATE_POLICIES = {
    "identity.genericName": "exact",
    "product.brandName": "exact",
    "product.authorizationHolder": "exact",
    "pharmacology.class": "set-union",
    "pharmacology.targetHint": "set-union",
    "product.approvedIndication": "exact",
}
PREDICATE_MIN_LINEAGES = {
    "identity.genericName": 2,
    "pharmacology.class": 2,
    "pharmacology.targetHint": 2,
    "product.brandName": 1,
    "product.authorizationHolder": 1,
    "product.approvedIndication": 1,
}


class PredicatePolicyError(EvidenceError):
    """A predicate has no policy or violates its configured policy."""


class SourceRegistryError(EvidenceError):
    """A v2 evidence document is not bound to an authoritative registered source."""


def canonical_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise EvidenceError("value must be JSON-serializable") from exc


def canonical_hash(value: Any) -> str:
    return raw_sha256(canonical_json(value).encode("utf-8"))


def _required_text(value: Any, name: str, *, maximum: int = 500) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise EvidenceError(f"{name} is invalid")
    return value.strip()


def _sha(value: Any, name: str) -> str:
    text = _required_text(value, name, maximum=71)
    if not SHA256_PATTERN.fullmatch(text):
        raise EvidenceError(f"{name} is not a SHA-256 identifier")
    return text


def _iso_utc(value: Any, name: str) -> str:
    from datetime import datetime, timezone
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise EvidenceError(f"{name} must be ISO-8601") from exc
    if parsed.tzinfo is None:
        raise EvidenceError(f"{name} must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _mapping_fields(cls: type, value: Mapping[str, Any]) -> dict[str, Any]:
    names = set(cls.__dataclass_fields__)
    unknown = set(value) - names
    if unknown:
        raise EvidenceError(f"unknown {cls.__name__} fields: {', '.join(sorted(unknown))}")
    return dict(value)


def _id(prefix: str, value: Any) -> str:
    return f"{prefix}-{hashlib.sha256(canonical_json(value).encode('utf-8')).hexdigest()}"


def canonical_lineage_id(source_id: str, document_id: str) -> str:
    """Derive lineage from a registered source identity and canonical document ID."""
    source = _required_text(source_id, "document.sourceId")
    if source not in set(SOURCE_IDS.values()):
        raise EvidenceError(f"unregistered official sourceId: {source!r}")
    normalized = _required_text(document_id, "document.documentId").casefold()
    if source in {"us-fda", "us-dailymed"} and SET_ID_PATTERN.fullmatch(normalized):
        return f"spl-set:{normalized}"
    return f"{source}:{normalized}"


@dataclass(frozen=True, order=True)
class FactScope:
    jurisdiction: str
    subjectType: str
    subjectId: str
    productId: str | None = None

    def validated(self) -> "FactScope":
        if self.jurisdiction not in {"GLOBAL", "US", "EU", "CN"}:
            raise EvidenceError("scope.jurisdiction is invalid")
        if self.subjectType not in {"active-ingredient", "medicinal-product"}:
            raise EvidenceError("scope.subjectType is invalid")
        _required_text(self.subjectId, "scope.subjectId", maximum=300)
        if self.productId is not None:
            _required_text(self.productId, "scope.productId", maximum=500)
        if self.subjectType == "medicinal-product" and not self.productId:
            raise EvidenceError("medicinal-product scope requires productId")
        return self

    def as_dict(self) -> dict[str, Any]:
        self.validated()
        output: dict[str, Any] = {
            "jurisdiction": self.jurisdiction,
            "subjectType": self.subjectType,
            "subjectId": self.subjectId,
        }
        if self.productId is not None:
            output["productId"] = self.productId
        return output

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "FactScope":
        try:
            return cls(**_mapping_fields(cls, value)).validated()
        except TypeError as exc:
            raise EvidenceError("FactScope fields are incomplete") from exc


@dataclass(frozen=True)
class TransformationStep:
    operation: str
    toolVersion: str
    inputSha256: str
    outputSha256: str
    locator: str

    def validated(self) -> "TransformationStep":
        _required_text(self.operation, "transformation.operation", maximum=80)
        _required_text(self.toolVersion, "transformation.toolVersion", maximum=128)
        _sha(self.inputSha256, "transformation.inputSha256")
        _sha(self.outputSha256, "transformation.outputSha256")
        _required_text(self.locator, "transformation.locator", maximum=500)
        return self

    def as_dict(self) -> dict[str, str]:
        self.validated()
        return {
            "operation": self.operation,
            "toolVersion": self.toolVersion,
            "inputSha256": self.inputSha256,
            "outputSha256": self.outputSha256,
            "locator": self.locator,
        }

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "TransformationStep":
        try:
            return cls(**_mapping_fields(cls, value)).validated()
        except TypeError as exc:
            raise EvidenceError("TransformationStep fields are incomplete") from exc


@dataclass(frozen=True)
class EvidenceDocument:
    sourceId: str
    sourceUrl: str
    documentId: str
    documentVersion: str
    lineageId: str
    jurisdiction: str
    activeIngredient: str
    productId: str
    documentType: str
    retrievedAt: str
    mediaType: str
    rawSha256: str
    rawObjectPath: str
    transformations: tuple[TransformationStep, ...] = field(default_factory=tuple)

    @property
    def evidenceId(self) -> str:
        return _id("evidence", {
            "sourceId": self.sourceId,
            "sourceUrl": self.sourceUrl,
            "documentId": self.documentId,
            "documentVersion": self.documentVersion,
            "lineageId": self.lineageId,
            "jurisdiction": self.jurisdiction,
            "activeIngredient": self.activeIngredient,
            "productId": self.productId,
            "documentType": self.documentType,
            "retrievedAt": _iso_utc(self.retrievedAt, "document.retrievedAt"),
            "mediaType": self.mediaType,
            "rawSha256": self.rawSha256,
            "rawObjectPath": self.rawObjectPath,
            "transformations": [step.as_dict() for step in self.transformations],
        })

    def validated(self) -> "EvidenceDocument":
        for name in ("sourceId", "documentId", "documentVersion", "lineageId",
                     "activeIngredient", "productId", "documentType", "mediaType"):
            _required_text(getattr(self, name), f"document.{name}")
        if self.lineageId != canonical_lineage_id(self.sourceId, self.documentId):
            raise EvidenceError("document.lineageId is not canonical for sourceId/documentId")
        if self.jurisdiction not in {"US", "EU", "CN"}:
            raise EvidenceError("document.jurisdiction is invalid")
        parsed = urlsplit(self.sourceUrl)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise EvidenceError("document.sourceUrl must use clean HTTPS")
        _iso_utc(self.retrievedAt, "document.retrievedAt")
        _sha(self.rawSha256, "document.rawSha256")
        expected_path = f"evidence/objects/{self.rawSha256.removeprefix('sha256:')}.bin"
        if self.rawObjectPath != expected_path:
            raise EvidenceError("document.rawObjectPath is not content-addressed")
        for step in self.transformations:
            step.validated()
        if self.transformations and self.transformations[-1].outputSha256 != self.rawSha256:
            raise EvidenceError("document transformation does not produce rawSha256")
        return self

    def as_dict(self) -> dict[str, Any]:
        self.validated()
        return {
            "evidenceId": self.evidenceId,
            "sourceId": self.sourceId,
            "sourceUrl": self.sourceUrl,
            "documentId": self.documentId,
            "documentVersion": self.documentVersion,
            "lineageId": self.lineageId,
            "jurisdiction": self.jurisdiction,
            "activeIngredient": self.activeIngredient,
            "productId": self.productId,
            "documentType": self.documentType,
            "retrievedAt": _iso_utc(self.retrievedAt, "document.retrievedAt"),
            "mediaType": self.mediaType,
            "rawSha256": self.rawSha256,
            "rawObjectPath": self.rawObjectPath,
            "transformations": [step.as_dict() for step in self.transformations],
        }

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "EvidenceDocument":
        fields = dict(value)
        supplied_id = fields.pop("evidenceId", None)
        transformations = fields.get("transformations", [])
        if not isinstance(transformations, list):
            raise EvidenceError("document.transformations must be an array")
        fields["transformations"] = tuple(
            TransformationStep.from_mapping(item) for item in transformations
            if isinstance(item, Mapping)
        )
        if len(fields["transformations"]) != len(transformations):
            raise EvidenceError("document transformations must be objects")
        try:
            document = cls(**_mapping_fields(cls, fields)).validated()
        except TypeError as exc:
            raise EvidenceError("EvidenceDocument fields are incomplete") from exc
        if supplied_id != document.evidenceId:
            raise EvidenceError("evidenceId does not match immutable document metadata")
        return document


@dataclass(frozen=True)
class EvidenceExcerpt:
    evidenceId: str
    locator: str
    text: str
    purpose: str

    @property
    def excerptId(self) -> str:
        return _id("excerpt", self.payload())

    def payload(self) -> dict[str, str]:
        return {
            "evidenceId": self.evidenceId,
            "locator": self.locator,
            "text": self.text,
            "purpose": self.purpose,
        }

    def validated(self) -> "EvidenceExcerpt":
        if not ID_PATTERN.fullmatch(self.evidenceId) or not self.evidenceId.startswith("evidence-"):
            raise EvidenceError("excerpt.evidenceId is invalid")
        _required_text(self.locator, "excerpt.locator")
        _required_text(self.purpose, "excerpt.purpose", maximum=80)
        if not isinstance(self.text, str) or not self.text.strip() or len(self.text) > MAX_EXCERPT_LENGTH:
            raise EvidenceError("excerpt.text is invalid or exceeds its safety limit")
        return self

    def as_dict(self) -> dict[str, str]:
        self.validated()
        return {"excerptId": self.excerptId, **self.payload()}

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "EvidenceExcerpt":
        fields = dict(value)
        supplied_id = fields.pop("excerptId", None)
        try:
            excerpt = cls(**_mapping_fields(cls, fields)).validated()
        except TypeError as exc:
            raise EvidenceError("EvidenceExcerpt fields are incomplete") from exc
        if supplied_id != excerpt.excerptId:
            raise EvidenceError("excerptId does not match immutable excerpt content")
        return excerpt


@dataclass(frozen=True)
class FactAssertion:
    factKey: str
    predicate: str
    value: Any
    scope: FactScope
    sourceId: str
    lineageId: str
    evidenceId: str
    excerptId: str | None = None

    def validated(self) -> "FactAssertion":
        _required_text(self.factKey, "assertion.factKey")
        if self.predicate not in PREDICATE_POLICIES:
            raise PredicatePolicyError(f"no policy for predicate: {self.predicate}")
        canonical_json(self.value)
        if self.value in (None, "", [], {}):
            raise EvidenceError("assertion.value is empty")
        self.scope.validated()
        _required_text(self.sourceId, "assertion.sourceId")
        _required_text(self.lineageId, "assertion.lineageId")
        if not ID_PATTERN.fullmatch(self.evidenceId) or not self.evidenceId.startswith("evidence-"):
            raise EvidenceError("assertion.evidenceId is invalid")
        if self.excerptId is not None and (
                not ID_PATTERN.fullmatch(self.excerptId) or not self.excerptId.startswith("excerpt-")):
            raise EvidenceError("assertion.excerptId is invalid")
        return self

    def as_dict(self) -> dict[str, Any]:
        self.validated()
        output = {
            "factKey": self.factKey,
            "predicate": self.predicate,
            "value": self.value,
            "scope": self.scope.as_dict(),
            "sourceId": self.sourceId,
            "lineageId": self.lineageId,
            "evidenceId": self.evidenceId,
        }
        if self.excerptId is not None:
            output["excerptId"] = self.excerptId
        return output

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "FactAssertion":
        fields = _mapping_fields(cls, value)
        if not isinstance(fields.get("scope"), Mapping):
            raise EvidenceError("assertion.scope must be an object")
        fields["scope"] = FactScope.from_mapping(fields["scope"])
        try:
            return cls(**fields).validated()
        except TypeError as exc:
            raise EvidenceError("FactAssertion fields are incomplete") from exc


@dataclass(frozen=True)
class AtomicFact:
    factKey: str
    predicate: str
    value: Any
    scope: FactScope
    status: str
    assertions: tuple[FactAssertion, ...]

    @property
    def factId(self) -> str:
        return _id("fact", {"factKey": self.factKey, "scope": self.scope.as_dict()})

    @property
    def resolutionHash(self) -> str:
        return canonical_hash(self.payload())

    def payload(self) -> dict[str, Any]:
        return {
            "factId": self.factId,
            "factKey": self.factKey,
            "predicate": self.predicate,
            "value": self.value,
            "scope": self.scope.as_dict(),
            "status": self.status,
            "assertions": [item.as_dict() for item in self.assertions],
        }

    def validated(self) -> "AtomicFact":
        _required_text(self.factKey, "fact.factKey")
        policy = PREDICATE_POLICIES.get(self.predicate)
        if policy is None:
            raise PredicatePolicyError(f"no policy for predicate: {self.predicate}")
        self.scope.validated()
        if self.status not in {"verified", "conflicted", "blocked", "stale"}:
            raise EvidenceError("fact.status is invalid")
        if not self.assertions:
            raise EvidenceError("fact.assertions must not be empty")
        distinct: dict[str, Any] = {}
        for assertion in self.assertions:
            assertion.validated()
            if (assertion.factKey, assertion.predicate, assertion.scope) != (
                    self.factKey, self.predicate, self.scope):
                raise EvidenceError("fact assertion is detached from its fact")
            distinct[canonical_json(assertion.value)] = assertion.value
        lineage_count = len({item.lineageId for item in self.assertions})
        supported = lineage_count >= PREDICATE_MIN_LINEAGES[self.predicate]
        if policy == "exact":
            if len(distinct) == 1:
                expected_status = "verified" if supported else "blocked"
                if self.status != expected_status or canonical_json(self.value) not in distinct:
                    raise PredicatePolicyError("resolved exact fact is inconsistent")
            else:
                expected = [distinct[key] for key in sorted(distinct)]
                if self.status != "conflicted" or canonical_json(self.value) != canonical_json(expected):
                    raise PredicatePolicyError("conflicted exact fact is inconsistent")
        elif policy == "set-union":
            expected = [distinct[key] for key in sorted(distinct)]
            expected_status = "verified" if supported else "blocked"
            if self.status != expected_status or canonical_json(self.value) != canonical_json(expected):
                raise PredicatePolicyError("set-union fact is inconsistent")
        return self

    def as_dict(self) -> dict[str, Any]:
        self.validated()
        return {"schemaVersion": 2, **self.payload(), "resolutionHash": self.resolutionHash}

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "AtomicFact":
        fields = dict(value)
        schema_version = fields.pop("schemaVersion", None)
        supplied_id = fields.pop("factId", None)
        supplied_hash = fields.pop("resolutionHash", None)
        if schema_version != 2:
            raise EvidenceError("AtomicFact schemaVersion must be 2")
        if not isinstance(fields.get("scope"), Mapping) or not isinstance(fields.get("assertions"), list):
            raise EvidenceError("fact scope/assertions are invalid")
        fields["scope"] = FactScope.from_mapping(fields["scope"])
        assertions = fields["assertions"]
        fields["assertions"] = tuple(
            FactAssertion.from_mapping(item) for item in assertions if isinstance(item, Mapping)
        )
        if len(fields["assertions"]) != len(assertions):
            raise EvidenceError("fact assertions must be objects")
        try:
            fact = cls(**_mapping_fields(cls, fields)).validated()
        except TypeError as exc:
            raise EvidenceError("AtomicFact fields are incomplete") from exc
        if supplied_id != fact.factId or supplied_hash != fact.resolutionHash:
            raise EvidenceError("fact identity/hash does not match canonical fact content")
        return fact


def lineage_id(source_name: str, document_id: str) -> str:
    source_id = SOURCE_IDS.get(source_name)
    if not source_id:
        raise EvidenceError(f"unregistered official adapter: {source_name!r}")
    return canonical_lineage_id(source_id, document_id)


def document_for_record(record: Any) -> EvidenceDocument:
    source_name = str(record.sourceName)
    source_id = SOURCE_IDS.get(source_name)
    if not source_id or source_name not in SOURCE_SCOPE:
        raise EvidenceError(f"unregistered official adapter: {source_name!r}")
    raw = getattr(record, "_raw_body", None)
    if not isinstance(raw, bytes):
        raise EvidenceError("official source record has no immutable document bytes")
    digest = raw_sha256(raw)
    if digest != str(record.rawResponseSha256):
        raise EvidenceError("official source record hash does not match document bytes")
    jurisdiction, document_type = SOURCE_SCOPE[source_name]
    transformations: tuple[TransformationStep, ...] = ()
    container = getattr(record, "_container_body", b"")
    if container:
        if not isinstance(container, bytes):
            raise EvidenceError("source container bytes are invalid")
        transformations = (TransformationStep(
            operation=str(getattr(record, "_transform_operation", "")),
            toolVersion=str(getattr(record, "_transform_tool_version", "")),
            inputSha256=raw_sha256(container),
            outputSha256=digest,
            locator=str(getattr(record, "_transform_locator", "")),
        ).validated(),)
    return EvidenceDocument(
        sourceId=source_id,
        sourceUrl=record.finalUrl,
        documentId=record.documentId,
        documentVersion=record.documentVersion,
        lineageId=lineage_id(source_name, record.documentId),
        jurisdiction=jurisdiction,
        activeIngredient=record.genericName,
        productId=record.documentId,
        documentType=document_type,
        retrievedAt=record.retrievedAt,
        mediaType=record.httpContentType,
        rawSha256=digest,
        rawObjectPath=f"evidence/objects/{digest.removeprefix('sha256:')}.bin",
        transformations=transformations,
    ).validated()


def validate_registered_sources(documents: Iterable[EvidenceDocument], registry: Mapping[str, Any]) -> None:
    sources = registry.get("sources")
    if not isinstance(sources, list):
        raise SourceRegistryError("official source registry has no sources")
    indexed = {str(item.get("id")): item for item in sources if isinstance(item, Mapping)}
    for document in documents:
        source = indexed.get(document.sourceId)
        if not source or source.get("authoritative") is not True:
            raise SourceRegistryError(f"unknown/non-authoritative sourceId: {document.sourceId}")
        host = (urlsplit(document.sourceUrl).hostname or "").lower().removeprefix("www.")
        allowed = [str(item).lower().removeprefix("www.") for item in source.get("allowedHosts", [])]
        if not any(host == base or host.endswith(f".{base}") for base in allowed):
            raise SourceRegistryError(f"sourceId {document.sourceId} does not allow host {host}")


def _scope(document: EvidenceDocument, *, product_level: bool) -> FactScope:
    if product_level:
        return FactScope(document.jurisdiction, "medicinal-product",
                         document.activeIngredient.casefold(), document.productId)
    return FactScope("GLOBAL", "active-ingredient", document.activeIngredient.casefold())


def _assertion(document: EvidenceDocument, *, fact_key: str, predicate: str,
               value: Any, product_level: bool, excerpt_id: str | None = None) -> FactAssertion:
    return FactAssertion(
        factKey=fact_key,
        predicate=predicate,
        value=value,
        scope=_scope(document, product_level=product_level),
        sourceId=document.sourceId,
        lineageId=document.lineageId,
        evidenceId=document.evidenceId,
        excerptId=excerpt_id,
    ).validated()


def reconcile_atomic_facts(assertions: Iterable[FactAssertion]) -> tuple[AtomicFact, ...]:
    grouped: dict[tuple[str, FactScope], list[FactAssertion]] = {}
    for assertion in assertions:
        assertion.validated()
        grouped.setdefault((assertion.factKey, assertion.scope), []).append(assertion)
    facts: list[AtomicFact] = []
    for (fact_key, scope), items in sorted(grouped.items(), key=lambda pair: (pair[0][0], pair[0][1])):
        predicates = {item.predicate for item in items}
        if len(predicates) != 1:
            raise PredicatePolicyError(f"multiple predicates for fact key/scope: {fact_key}")
        predicate = next(iter(predicates))
        policy = PREDICATE_POLICIES[predicate]
        supported = len({item.lineageId for item in items}) >= PREDICATE_MIN_LINEAGES[predicate]
        distinct = {canonical_json(item.value): item.value for item in items}
        if policy == "exact" and len(distinct) > 1:
            status = "conflicted"
            value: Any = [distinct[key] for key in sorted(distinct)]
        elif policy == "exact":
            status = "verified" if supported else "blocked"
            value = next(iter(distinct.values()))
        else:
            status = "verified" if supported else "blocked"
            value = [distinct[key] for key in sorted(distinct)]
        facts.append(AtomicFact(fact_key, predicate, value, scope, status, tuple(items)).validated())
    return tuple(facts)


def bundle_from_records(records: Sequence[Any], *, source_attempts: Sequence[Mapping[str, Any]] = ()) -> dict[str, Any]:
    if not records:
        raise EvidenceError("at least one successful official source is required")
    documents = tuple(document_for_record(record) for record in records)
    assertions: list[FactAssertion] = []
    excerpts: list[EvidenceExcerpt] = []
    for record, document in zip(records, documents):
        generic_key = f"drug:{record.genericName.casefold()}"
        assertions.append(_assertion(document, fact_key=f"{generic_key}:generic-name",
                                     predicate="identity.genericName", value=record.genericName,
                                     product_level=False))
        if record.brandName:
            assertions.append(_assertion(document, fact_key=f"{generic_key}:brand-name",
                                         predicate="product.brandName", value=record.brandName,
                                         product_level=True))
        if record.company:
            assertions.append(_assertion(document, fact_key=f"{generic_key}:authorization-holder",
                                         predicate="product.authorizationHolder", value=record.company,
                                         product_level=True))
        if record.drugClass:
            assertions.append(_assertion(document, fact_key=f"{generic_key}:drug-class",
                                         predicate="pharmacology.class", value=record.drugClass,
                                         product_level=False))
        for value in record.targetHints:
            assertions.append(_assertion(document, fact_key=f"{generic_key}:target-hints",
                                         predicate="pharmacology.targetHint", value=value,
                                         product_level=False))
        for value in record.indications:
            condition_key = hashlib.sha256(value.casefold().encode("utf-8")).hexdigest()[:16]
            assertions.append(_assertion(document,
                fact_key=f"{generic_key}:approved-indication:{condition_key}",
                predicate="product.approvedIndication", value={"label": value},
                product_level=True))
        for index, text in enumerate(getattr(record, "_indication_excerpts", ())):
            excerpts.append(EvidenceExcerpt(
                document.evidenceId,
                f"indications-and-usage[{index}]",
                text,
                "indication-context-unstructured",
            ).validated())
    attempts = [dict(item) for item in source_attempts]
    for item in attempts:
        if item.get("status") not in {"succeeded", "failed"}:
            raise EvidenceError("source audit status is invalid")
    output = {
        "schema": SCHEMA_ID,
        "schemaVersion": SCHEMA_VERSION,
        "documents": [item.as_dict() for item in sorted(documents, key=lambda item: item.evidenceId)],
        "excerpts": [item.as_dict() for item in sorted(excerpts, key=lambda item: item.excerptId)],
        "facts": [item.as_dict() for item in reconcile_atomic_facts(assertions)],
        "sourceAudit": attempts,
        "incomplete": any(item.get("status") == "failed" for item in attempts),
    }
    validate_canonical_bundle(output)
    return output


def validate_canonical_bundle(bundle: Mapping[str, Any]) -> tuple[tuple[EvidenceDocument, ...], tuple[EvidenceExcerpt, ...], tuple[AtomicFact, ...]]:
    allowed = {"schema", "schemaVersion", "documents", "excerpts", "facts", "sourceAudit", "incomplete"}
    unknown = set(bundle) - allowed
    if unknown:
        raise EvidenceError(f"unknown v2 bundle fields: {', '.join(sorted(unknown))}")
    if bundle.get("schema") != SCHEMA_ID or bundle.get("schemaVersion") != SCHEMA_VERSION:
        raise EvidenceError("unsupported canonical evidence v2 schema/version")
    raw_documents = bundle.get("documents")
    raw_excerpts = bundle.get("excerpts")
    raw_facts = bundle.get("facts")
    if not isinstance(raw_documents, list) or not raw_documents:
        raise EvidenceError("v2 bundle has no evidence documents")
    if not isinstance(raw_excerpts, list) or not isinstance(raw_facts, list):
        raise EvidenceError("v2 excerpts/facts must be arrays")
    documents = tuple(EvidenceDocument.from_mapping(item) for item in raw_documents if isinstance(item, Mapping))
    excerpts = tuple(EvidenceExcerpt.from_mapping(item) for item in raw_excerpts if isinstance(item, Mapping))
    facts = tuple(AtomicFact.from_mapping(item) for item in raw_facts if isinstance(item, Mapping))
    if len(documents) != len(raw_documents) or len(excerpts) != len(raw_excerpts) or len(facts) != len(raw_facts):
        raise EvidenceError("v2 bundle entries must be objects")
    documents_by_id = {item.evidenceId: item for item in documents}
    evidence_ids = set(documents_by_id)
    subjects = {item.activeIngredient.strip().casefold() for item in documents}
    if len(subjects) != 1:
        raise EvidenceError("v2 bundle mixes active ingredients")
    excerpt_ids = {item.excerptId for item in excerpts}
    if len(evidence_ids) != len(documents) or len(excerpt_ids) != len(excerpts):
        raise EvidenceError("v2 evidence/excerpt identities must be unique")
    for excerpt in excerpts:
        if excerpt.evidenceId not in evidence_ids:
            raise EvidenceError("excerpt references an unknown evidence document")
    for fact in facts:
        for assertion in fact.assertions:
            document = documents_by_id.get(assertion.evidenceId)
            if document is None:
                raise EvidenceError("fact assertion references an unknown evidence document")
            if assertion.sourceId != document.sourceId or assertion.lineageId != document.lineageId:
                raise EvidenceError("fact assertion source or lineage is detached from its evidence document")
            if assertion.scope.subjectId.strip().casefold() != document.activeIngredient.strip().casefold():
                raise EvidenceError("fact assertion subject is detached from its evidence document")
            if (assertion.scope.jurisdiction != "GLOBAL" and
                    assertion.scope.jurisdiction != document.jurisdiction):
                raise EvidenceError("fact assertion jurisdiction is detached from its evidence document")
            if assertion.scope.subjectType == "medicinal-product":
                if (assertion.scope.jurisdiction != document.jurisdiction or
                        assertion.scope.productId != document.productId):
                    raise EvidenceError("product fact assertion is detached from its evidence document")
            elif assertion.scope.productId is not None:
                raise EvidenceError("active-ingredient fact assertion must not claim a product ID")
            if assertion.excerptId is not None and assertion.excerptId not in excerpt_ids:
                raise EvidenceError("fact assertion references an unknown excerpt")
    audit = bundle.get("sourceAudit", [])
    if not isinstance(audit, list) or not all(isinstance(item, Mapping) for item in audit):
        raise EvidenceError("sourceAudit must be an array of objects")
    failed = any(item.get("status") == "failed" for item in audit)
    if bundle.get("incomplete") is not failed:
        raise EvidenceError("incomplete flag does not match source audit")
    return documents, excerpts, facts
