import { createHash } from 'node:crypto';

export const VERIFICATION_STATUSES = ['verified', 'conflicted', 'stale', 'blocked'] as const;
export const FACT_RELATIONS = ['supports', 'contextualizes', 'derived-from'] as const;
export const FACT_REF_REVIEW_STATUSES = ['pending', 'reviewed', 'stale'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface FactScope {
  jurisdiction: 'GLOBAL' | 'US' | 'EU' | 'CN';
  subjectType: 'active-ingredient' | 'medicinal-product';
  subjectId: string;
  productId?: string;
}

export interface AtomicFactAssertion {
  factKey: string;
  predicate: string;
  value: unknown;
  scope: FactScope;
  sourceId: string;
  lineageId: string;
  evidenceId: string;
  excerptId?: string;
}

export interface EvidenceDocumentSummary {
  evidenceId: string;
  sourceId: string;
  sourceUrl: string;
  documentId: string;
  documentVersion: string;
  lineageId: string;
  jurisdiction: 'US' | 'EU' | 'CN';
  activeIngredient: string;
  productId: string;
  documentType: 'label' | 'regulatory-product';
  retrievedAt: string;
  mediaType: string;
  rawSha256: string;
  rawObjectPath: string;
  transformations: Array<{
    operation: string;
    toolVersion: string;
    inputSha256: string;
    outputSha256: string;
    locator: string;
  }>;
}

export interface AtomicFact {
  schemaVersion: 2;
  factId: string;
  factKey: string;
  predicate: string;
  value: unknown;
  scope: FactScope;
  status: VerificationStatus;
  assertions: AtomicFactAssertion[];
  resolutionHash: string;
  /** Added by the site importer; not part of the Python resolutionHash. */
  evidenceDocuments?: EvidenceDocumentSummary[];
  importHash?: string;
}

function normalizedIdentity(value: string): string {
  return value.trim().toLocaleLowerCase();
}

const SPL_SET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SPL_SOURCE_IDS = new Set(['us-fda', 'us-dailymed']);

/** Derive document lineage from registered source identity and canonical document ID. */
export function evidenceLineageId(
  document: Pick<EvidenceDocumentSummary, 'sourceId' | 'documentId'>,
): string | undefined {
  const sourceId = String(document.sourceId ?? '').trim();
  const documentId = String(document.documentId ?? '').trim().toLocaleLowerCase();
  if (!sourceId || !documentId) return undefined;
  if (SPL_SOURCE_IDS.has(sourceId) && SPL_SET_ID.test(documentId)) return `spl-set:${documentId}`;
  return `${sourceId}:${documentId}`;
}

function canonicalEntityId(prefix: 'evidence' | 'fact', payload: unknown): string {
  return `${prefix}-${canonicalHash(payload).slice('sha256:'.length)}`;
}

/** Recompute Python EvidenceDocument.evidenceId from immutable metadata. */
export function evidenceDocumentId(document: EvidenceDocumentSummary): string | undefined {
  if (evidenceLineageId(document) !== document.lineageId) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(document.retrievedAt)) {
    return undefined;
  }
  return canonicalEntityId('evidence', {
    sourceId: document.sourceId,
    sourceUrl: document.sourceUrl,
    documentId: document.documentId,
    documentVersion: document.documentVersion,
    lineageId: document.lineageId,
    jurisdiction: document.jurisdiction,
    activeIngredient: document.activeIngredient,
    productId: document.productId,
    documentType: document.documentType,
    retrievedAt: document.retrievedAt,
    mediaType: document.mediaType,
    rawSha256: document.rawSha256,
    rawObjectPath: document.rawObjectPath,
    transformations: document.transformations,
  });
}

/** Recompute Python AtomicFact.factId from factKey + scope. */
export function atomicFactId(fact: Pick<AtomicFact, 'factKey' | 'scope'>): string {
  return canonicalEntityId('fact', { factKey: fact.factKey, scope: fact.scope });
}

/** Prove that an assertion's scope and lineage resolve to this exact evidence document. */
export function assertionEvidenceMatches(
  assertion: AtomicFactAssertion,
  document: EvidenceDocumentSummary,
): boolean {
  if (
    evidenceLineageId(document) !== document.lineageId ||
    assertion.evidenceId !== document.evidenceId ||
    assertion.sourceId !== document.sourceId ||
    assertion.lineageId !== document.lineageId ||
    normalizedIdentity(assertion.scope.subjectId) !== normalizedIdentity(document.activeIngredient)
  ) {
    return false;
  }
  if (assertion.scope.jurisdiction !== 'GLOBAL' &&
      assertion.scope.jurisdiction !== document.jurisdiction) {
    return false;
  }
  if (assertion.scope.subjectType === 'medicinal-product') {
    return assertion.scope.jurisdiction === document.jurisdiction &&
      assertion.scope.productId === document.productId;
  }
  return assertion.scope.productId === undefined;
}

/** Prove that an assertion belongs to the fact that contains it. */
export function assertionFactMatches(assertion: AtomicFactAssertion, fact: AtomicFact): boolean {
  return assertion.factKey === fact.factKey &&
    assertion.predicate === fact.predicate &&
    canonicalJson(assertion.scope) === canonicalJson(fact.scope);
}

/** Re-run Python's predicate resolution policy over a fact's assertions. */
export function factResolutionMatchesAssertions(fact: AtomicFact): boolean {
  if (!fact.assertions.length || fact.assertions.some((item) => !assertionFactMatches(item, fact))) {
    return false;
  }
  const distinct = new Map(fact.assertions.map((item) => [canonicalJson(item.value), item.value]));
  const values = [...distinct.entries()].sort(([left], [right]) => canonicalStringCompare(left, right)).map(([, value]) => value);
  const minimumLineages: Record<string, number> = {
    'identity.genericName': 2,
    'pharmacology.class': 2,
    'pharmacology.targetHint': 2,
    'product.brandName': 1,
    'product.authorizationHolder': 1,
    'product.approvedIndication': 1,
  };
  const required = minimumLineages[fact.predicate];
  if (!required) return false;
  const supported = new Set(fact.assertions.map((item) => item.lineageId)).size >= required;
  if (['identity.genericName', 'product.brandName', 'product.authorizationHolder',
    'product.approvedIndication'].includes(fact.predicate)) {
    return values.length === 1
      ? fact.status === (supported ? 'verified' : 'blocked') && canonicalJson(fact.value) === canonicalJson(values[0])
      : fact.status === 'conflicted' && canonicalJson(fact.value) === canonicalJson(values);
  }
  if (['pharmacology.class', 'pharmacology.targetHint'].includes(fact.predicate)) {
    return fact.status === (supported ? 'verified' : 'blocked') && canonicalJson(fact.value) === canonicalJson(values);
  }
  return false;
}

export interface FactRef {
  contentPath: string;
  factIds: string[];
  relation: (typeof FACT_RELATIONS)[number];
  boundFactHashes: Record<string, string>;
  copyHash: string;
  reviewStatus: (typeof FACT_REF_REVIEW_STATUSES)[number];
}

const TRUSTED_FACT_FIELDS = [
  'company',
  'genericName',
  'genericNameEn',
  'brandName',
  'drugClass',
  'summary',
  'indications',
  'target',
  'mechanism',
] as const;

/** JSON Pointer roots that may be bound to evidence or a reviewed fact reference. */
export const EVIDENCE_CLAIM_ROOTS = new Set<string>(TRUSTED_FACT_FIELDS);

function canonicalStringCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => canonicalStringCompare(left, right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

/** Deterministic JSON shared with the Python v2 canonicalizer. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function decodePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Resolve an RFC 6901 JSON Pointer, limited to factual drug fields. */
export function resolveEvidenceClaim(root: unknown, claimPath: string): unknown {
  if (!claimPath.startsWith('/') || claimPath === '/') return undefined;
  const tokens = claimPath.slice(1).split('/').map(decodePointerToken);
  if (!EVIDENCE_CLAIM_ROOTS.has(tokens[0])) return undefined;

  let current: unknown = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return undefined;
      current = current[Number(token)];
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

/** v1 compatibility only: exact official claim values must still match their old field. */
export function evidenceClaimMatches(root: unknown, claimPath: string, claimValue: unknown): boolean {
  const actual = resolveEvidenceClaim(root, claimPath);
  return actual !== undefined && canonicalJson(actual) === canonicalJson(claimValue);
}

/**
 * Canonical payload protected by the legacy LKG catalog. Do not alter this
 * algorithm until every legacy record has migrated to v2 factRefs.
 */
export function trustedFactPayload(
  data: Record<string, unknown>,
  markdownBody = '',
): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  for (const field of TRUSTED_FACT_FIELDS) facts[field] = data[field];
  facts.citations = Array.isArray(data.citations)
    ? data.citations.map((citation) => {
        const source = citation as Record<string, unknown>;
        return {
          id: source.id,
          sourceId: source.sourceId,
          title: source.title,
          publisher: source.publisher,
          url: source.url,
        };
      })
    : [];
  facts.markdownBody = markdownBody.trim().replace(/\r\n/g, '\n');
  return facts;
}

/** Fields covered by Python AtomicFact.resolutionHash; excludes only the hash itself. */
export function atomicFactPayload(fact: AtomicFact): Record<string, unknown> {
  return {
    factId: fact.factId,
    factKey: fact.factKey,
    predicate: fact.predicate,
    value: fact.value,
    scope: fact.scope,
    status: fact.status,
    assertions: fact.assertions,
  };
}

export function atomicFactHash(fact: AtomicFact): string {
  return canonicalHash(atomicFactPayload(fact));
}

/** Bind a persisted fact file to the exact canonical revision selected by its current bundle. */
export function atomicFactRevisionMatches(candidate: AtomicFact, expected: AtomicFact): boolean {
  return candidate.schemaVersion === 2 && expected.schemaVersion === 2 &&
    candidate.factId === expected.factId &&
    candidate.resolutionHash === expected.resolutionHash &&
    canonicalJson(atomicFactPayload(candidate)) === canonicalJson(atomicFactPayload(expected));
}

export function importedFactHash(fact: AtomicFact): string {
  const evidenceDocuments = [...(fact.evidenceDocuments ?? [])]
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  return canonicalHash({
    fact: atomicFactPayload(fact),
    resolutionHash: fact.resolutionHash,
    evidenceDocuments,
  });
}

/** Bind published wording without claiming that it is copied from a source. */
export function contentCopyHash(root: unknown, contentPath: string): string | undefined {
  const copy = resolveEvidenceClaim(root, contentPath);
  return copy === undefined ? undefined : canonicalHash(copy);
}

/** Bundle identity is derived only from facts actually referenced by the copy. */
export function factBundleHash(facts: Iterable<Pick<AtomicFact, 'factId' | 'resolutionHash'>>): string {
  const bindings = [...facts]
    .map(({ factId, resolutionHash }) => ({ factId, resolutionHash }))
    .sort((left, right) => left.factId.localeCompare(right.factId));
  return canonicalHash(bindings);
}

function indicationJurisdiction(root: unknown, contentPath: string): string | undefined {
  const match = /^\/indications\/(\d+)\/items\/\d+$/.exec(contentPath);
  if (!match || !root || typeof root !== 'object') return undefined;
  const groups = (root as Record<string, unknown>).indications;
  if (!Array.isArray(groups)) return undefined;
  const group = groups[Number(match[1])];
  if (!group || typeof group !== 'object') return undefined;
  const region = String((group as Record<string, unknown>).region ?? '').toLowerCase();
  const regulator = String((group as Record<string, unknown>).regulator ?? '').toLowerCase();
  if (region.includes('美国') || region === 'us' || regulator === 'fda') return 'US';
  if (region.includes('欧盟') || region === 'eu' || regulator === 'ema') return 'EU';
  if (region.includes('中国') || region === 'cn' || regulator === 'nmpa') return 'CN';
  return undefined;
}

function bindingPolicyErrors(fact: AtomicFact, ref: FactRef): string[] {
  const errors: string[] = [];
  const mechanismPath = /^\/mechanism\/(?:analogy|simple|advanced)$/.test(ref.contentPath);
  const requireBinding = (
    pathMatches: boolean,
    relation: FactRef['relation'],
    subjectType: FactScope['subjectType'],
  ): void => {
    if (!pathMatches) errors.push(`predicate ${fact.predicate} cannot bind ${ref.contentPath}`);
    if (ref.relation !== relation) errors.push(`predicate ${fact.predicate} requires relation ${relation}`);
    if (fact.scope.subjectType !== subjectType) {
      errors.push(`predicate ${fact.predicate} requires ${subjectType} scope`);
    }
  };

  switch (fact.predicate) {
    case 'identity.genericName':
      if (ref.contentPath === '/genericNameEn') {
        requireBinding(true, 'supports', 'active-ingredient');
      } else {
        requireBinding(ref.contentPath === '/genericName', 'derived-from', 'active-ingredient');
      }
      break;
    case 'product.brandName':
      requireBinding(ref.contentPath === '/brandName', 'supports', 'medicinal-product');
      break;
    case 'pharmacology.class':
      if (ref.contentPath === '/drugClass') {
        requireBinding(true, 'supports', 'active-ingredient');
      } else {
        requireBinding(ref.contentPath === '/summary' || mechanismPath, 'derived-from', 'active-ingredient');
      }
      break;
    case 'pharmacology.targetHint':
      if (ref.contentPath === '/target/name') {
        requireBinding(true, 'contextualizes', 'active-ingredient');
      } else {
        requireBinding(
          /^\/target\/(?:type|role)$/.test(ref.contentPath) || ref.contentPath === '/summary' || mechanismPath,
          'derived-from',
          'active-ingredient',
        );
      }
      break;
    case 'product.approvedIndication':
      if (/^\/indications\/\d+\/items\/\d+$/.test(ref.contentPath)) {
        requireBinding(true, 'supports', 'medicinal-product');
      } else {
        requireBinding(ref.contentPath === '/summary', 'derived-from', 'medicinal-product');
      }
      break;
    case 'product.authorizationHolder':
      requireBinding(ref.contentPath === '/company', 'contextualizes', 'medicinal-product');
      break;
    default:
      errors.push(`predicate ${fact.predicate} has no public binding policy`);
  }
  if (fact.scope.subjectType === 'medicinal-product' && !fact.scope.productId) {
    errors.push(`fact ${fact.factId} medicinal-product scope has no productId`);
  }
  if (fact.scope.subjectType === 'active-ingredient' && fact.scope.productId !== undefined) {
    errors.push(`fact ${fact.factId} active-ingredient scope must not carry productId`);
  }
  return errors;
}

/** Every public factual leaf that a page-level verified status claims is covered. */
export function requiredTrustedFactPaths(root: unknown): string[] {
  if (!root || typeof root !== 'object') return [];
  const data = root as Record<string, unknown>;
  const paths = ['/company', '/genericName'];
  for (const path of ['/genericNameEn', '/brandName', '/drugClass', '/summary'] as const) {
    if (resolveEvidenceClaim(root, path) !== undefined) paths.push(path);
  }
  if (Array.isArray(data.indications)) {
    data.indications.forEach((group, groupIndex) => {
      const items = group && typeof group === 'object'
        ? (group as Record<string, unknown>).items
        : undefined;
      if (Array.isArray(items)) {
        items.forEach((_, itemIndex) => paths.push(`/indications/${groupIndex}/items/${itemIndex}`));
      }
    });
  }
  for (const path of ['/target/name', '/target/type', '/target/role',
    '/mechanism/analogy', '/mechanism/simple', '/mechanism/advanced'] as const) {
    if (resolveEvidenceClaim(root, path) !== undefined) paths.push(path);
  }
  return [...new Set(paths)].sort();
}

/** Resolve and validate one reviewed copy-to-fact binding. */
export function validateFactRef(
  root: unknown,
  ref: FactRef,
  facts: ReadonlyMap<string, AtomicFact>,
  expectedSubjectId: string,
): string[] {
  const errors: string[] = [];
  const normalizedSubject = normalizedIdentity(expectedSubjectId);
  if (!normalizedSubject) errors.push('verified v2 drug has no canonical active-ingredient identity');
  if (ref.reviewStatus !== 'reviewed') errors.push('factRef must be reviewed');
  if (new Set(ref.factIds).size !== ref.factIds.length) errors.push('factRef contains duplicate factIds');
  const copyHash = contentCopyHash(root, ref.contentPath);
  if (!copyHash) errors.push('factRef contentPath does not resolve');
  else if (copyHash !== ref.copyHash) errors.push('factRef copyHash does not match current copy');

  const boundIds = Object.keys(ref.boundFactHashes).sort();
  const referencedIds = [...ref.factIds].sort();
  if (canonicalJson(boundIds) !== canonicalJson(referencedIds)) {
    errors.push('factRef boundFactHashes must exactly cover factIds');
  }

  const expectedJurisdiction = indicationJurisdiction(root, ref.contentPath);
  for (const factId of ref.factIds) {
    const fact = facts.get(factId);
    if (!fact) {
      errors.push(`factRef references missing fact ${factId}`);
      continue;
    }
    if (atomicFactId(fact) !== fact.factId) {
      errors.push(`fact ${factId} factId is not canonical`);
    }
    if (atomicFactHash(fact) !== fact.resolutionHash) {
      errors.push(`fact ${factId} resolutionHash is invalid`);
    }
    if (normalizedIdentity(fact.scope.subjectId) !== normalizedSubject) {
      errors.push(`fact ${factId} belongs to another active ingredient`);
    }
    errors.push(...bindingPolicyErrors(fact, ref));
    if (fact.status !== 'verified') errors.push(`fact ${factId} is ${fact.status}`);
    if (ref.boundFactHashes[factId] !== fact.resolutionHash) {
      errors.push(`factRef binding for ${factId} is stale`);
    }
    if (expectedJurisdiction && fact.scope.jurisdiction !== expectedJurisdiction) {
      errors.push(`fact ${factId} jurisdiction does not match ${ref.contentPath}`);
    }
  }
  return errors;
}
