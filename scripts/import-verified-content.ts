import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import {
  assertionEvidenceMatches,
  atomicFactHash,
  atomicFactId,
  atomicFactRevisionMatches,
  canonicalHash,
  canonicalJson,
  evidenceDocumentId,
  factBundleHash,
  factResolutionMatchesAssertions,
  importedFactHash,
  type AtomicFact,
  type EvidenceDocumentSummary,
} from '../src/lib/trusted-content.ts';
import { resolveRegisteredSource } from '../src/lib/source-registry.ts';

const ROOT = join(import.meta.dirname, '..');
const V2_ROOT = join(ROOT, 'scraper', 'data', 'staging', 'v2');
const FACT_MANIFEST_PATH = join(V2_ROOT, 'fact-manifest.json');
const EVIDENCE_DIR = join(V2_ROOT, 'evidence', 'documents');
const FACTS_DIR = join(ROOT, 'src', 'content', 'facts');
const DRUGS_DIR = join(ROOT, 'src', 'content', 'drugs');
const REPORT_PATH = join(ROOT, 'src', 'data', 'verified-import-report.json');
const FACT_ID_RE = /^fact-[a-f0-9]{64}$/;
const EVIDENCE_ID_RE = /^evidence-[a-f0-9]{64}$/;
const SHA_RE = /^sha256:[a-f0-9]{64}$/;

interface DrugRecord {
  slug: string;
  genericNameEn: string;
  data: Record<string, any>;
}

type EvidenceDocument = EvidenceDocumentSummary;

interface CandidateRef {
  drugSlug: string;
  contentPath: string | null;
  factId: string;
  resolutionHash: string;
  predicate: string;
  relation: 'supports' | 'contextualizes';
  reason: string;
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, content, 'utf8');
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function loadDrugs(): Map<string, DrugRecord> {
  const result = new Map<string, DrugRecord>();
  if (!existsSync(DRUGS_DIR)) return result;
  for (const file of readdirSync(DRUGS_DIR).filter((name) => name.endsWith('.md')).sort()) {
    const parsed = matter(readFileSync(join(DRUGS_DIR, file), 'utf8'));
    const genericNameEn = String(parsed.data.genericNameEn ?? '').trim().toLocaleLowerCase();
    if (!genericNameEn) continue;
    result.set(genericNameEn, {
      slug: String(parsed.data.slug),
      genericNameEn,
      data: parsed.data as Record<string, any>,
    });
  }
  return result;
}

function loadEvidence(requiredIds: Iterable<string>): Map<string, EvidenceDocument> {
  const result = new Map<string, EvidenceDocument>();
  if (!existsSync(EVIDENCE_DIR)) {
    if ([...requiredIds].length) throw new Error('evidence document directory is missing');
    return result;
  }
  for (const evidenceId of [...new Set(requiredIds)].sort()) {
    if (!EVIDENCE_ID_RE.test(evidenceId)) throw new Error(`${evidenceId}: invalid required evidenceId`);
    const file = `${evidenceId}.json`;
    const full = join(EVIDENCE_DIR, file);
    if (!existsSync(full)) throw new Error(`${file}: required evidence document is missing`);
    const document = JSON.parse(readFileSync(full, 'utf8')) as EvidenceDocument;
    if (!EVIDENCE_ID_RE.test(String(document.evidenceId ?? ''))) throw new Error(`${file}: invalid evidenceId`);
    if (evidenceDocumentId(document) !== document.evidenceId) {
      throw new Error(`${file}: evidenceId does not match immutable document metadata`);
    }
    if (resolveRegisteredSource({ sourceId: document.sourceId, url: document.sourceUrl })?.authoritative !== true) {
      throw new Error(`${file}: evidence sourceId/URL is not a registered authoritative source`);
    }
    if (!String(document.sourceUrl ?? '').startsWith('https://')) throw new Error(`${file}: sourceUrl is not HTTPS`);
    if (!SHA_RE.test(String(document.rawSha256 ?? ''))) throw new Error(`${file}: invalid rawSha256`);
    const expectedPath = `evidence/objects/${document.rawSha256.slice('sha256:'.length)}.bin`;
    if (document.rawObjectPath !== expectedPath) throw new Error(`${file}: rawObjectPath is not content-addressed`);
    const objectPath = join(V2_ROOT, ...expectedPath.split('/'));
    if (!existsSync(objectPath)) throw new Error(`${file}: immutable raw object is missing`);
    const actualRawHash = `sha256:${createHash('sha256').update(readFileSync(objectPath)).digest('hex')}`;
    if (actualRawHash !== document.rawSha256) throw new Error(`${file}: immutable raw object hash mismatch`);
    result.set(document.evidenceId, document);
  }
  return result;
}

interface ActiveFactSelection {
  file: string;
  path: string;
  expectedResolutionHash: string;
  bundleFact: AtomicFact;
}

interface ActiveSelection {
  factFiles: ActiveFactSelection[];
  evidenceIds: Set<string>;
}

function loadActiveSelection(): ActiveSelection {
  if (!existsSync(V2_ROOT)) return { factFiles: [], evidenceIds: new Set() };
  if (!existsSync(FACT_MANIFEST_PATH)) throw new Error('v2 fact manifest is missing');
  const manifest = JSON.parse(readFileSync(FACT_MANIFEST_PATH, 'utf8')) as Record<string, any>;
  if (manifest.schema !== 'pharmasimple.fact-manifest' || manifest.schemaVersion !== '2.0.0' ||
      !manifest.facts || typeof manifest.facts !== 'object') {
    throw new Error('v2 fact manifest schema is invalid');
  }
  if (manifest.subjects === undefined) {
    if (Object.values(manifest.facts as Record<string, any>).some((state) => state?.active === true)) {
      throw new Error('v2 fact manifest has active facts without subject ownership');
    }
    manifest.subjects = {};
  } else if (!manifest.subjects || typeof manifest.subjects !== 'object') {
    throw new Error('v2 fact manifest subjects are invalid');
  }
  const selected = new Map<string, ActiveFactSelection>();
  const evidenceIds = new Set<string>();
  const activeAcrossSubjects = new Set<string>();
  const resolvePath = (relativePath: unknown, expected: RegExp): string => {
    const value = String(relativePath ?? '').replaceAll('\\', '/');
    if (!expected.test(value) || value.split('/').includes('..')) {
      throw new Error(`unsafe or unexpected v2 manifest path: ${value}`);
    }
    return join(V2_ROOT, ...value.split('/'));
  };

  for (const [subjectId, subject] of Object.entries(manifest.subjects as Record<string, any>)) {
    if (!subject || subject.status !== 'complete' || !Array.isArray(subject.activeFactIds) ||
        !Array.isArray(subject.verifiedFactIds) || !Array.isArray(subject.lineageIds)) {
      throw new Error(`${subjectId}: subject manifest is incomplete`);
    }
    const lineageIds = [...new Set(subject.lineageIds.map(String))].sort();
    if (lineageIds.length < 2 || canonicalJson(lineageIds) !== canonicalJson([...subject.lineageIds].sort())) {
      throw new Error(`${subjectId}: fewer than two unique document lineages`);
    }
    const bundlePath = resolvePath(subject.currentBundlePath, /^bundles\/current\/[a-z0-9-]+\.json$/);
    if (!existsSync(bundlePath)) throw new Error(`${subjectId}: current canonical bundle is missing`);
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as Record<string, any>;
    if (bundle.schema !== 'pharmasimple.canonical-evidence-v2' || bundle.schemaVersion !== '2.0.0' ||
        bundle.incomplete !== false || !Array.isArray(bundle.documents) || !Array.isArray(bundle.facts)) {
      throw new Error(`${subjectId}: current canonical bundle is incomplete or invalid`);
    }
    const bundleHash = canonicalHash(bundle).slice('sha256:'.length);
    if (bundleHash !== subject.bundleHash) throw new Error(`${subjectId}: current bundle hash mismatch`);
    const bundleLineages = [...new Set(bundle.documents.map((item) => String(item.lineageId)))].sort();
    if (canonicalJson(bundleLineages) !== canonicalJson(lineageIds)) {
      throw new Error(`${subjectId}: manifest lineage set does not match current bundle`);
    }
    if (bundle.documents.some((item) => String(item.activeIngredient ?? '').trim().toLocaleLowerCase() !== subjectId)) {
      throw new Error(`${subjectId}: current bundle belongs to another active ingredient`);
    }
    for (const document of bundle.documents) evidenceIds.add(String(document.evidenceId ?? ''));
    const activeIds = bundle.facts.map((item) => String(item.factId)).sort();
    const manifestActiveIds = [...subject.activeFactIds].map(String).sort();
    if (canonicalJson(activeIds) !== canonicalJson(manifestActiveIds)) {
      throw new Error(`${subjectId}: active fact set does not match current bundle`);
    }
    const verifiedIds = bundle.facts
      .filter((item) => item.status === 'verified')
      .map((item) => String(item.factId))
      .sort();
    if (canonicalJson(verifiedIds) !== canonicalJson([...subject.verifiedFactIds].map(String).sort())) {
      throw new Error(`${subjectId}: verified fact set does not match current bundle`);
    }

    for (const factId of manifestActiveIds) activeAcrossSubjects.add(factId);
    for (const factId of verifiedIds) {
      const state = manifest.facts[factId];
      const bundleFact = bundle.facts.find((item) => item.factId === factId);
      const version = String(bundleFact?.resolutionHash ?? '').replace(/^sha256:/, '');
      if (!state || state.status !== 'verified' || state.active !== true || state.subjectId !== subjectId ||
          state.bundleHash !== bundleHash || state.currentVersion !== version || state.lkgVersion !== version) {
        throw new Error(`${factId}: manifest state is not the active verified bundle version`);
      }
      const expectedLkgPath = `facts/lkg/${factId}.json`;
      const expectedCurrentPath = `facts/current/${factId}.json`;
      const expectedVersionPath = `facts/versions/${factId}/${version}.json`;
      if (state.lkgPath !== expectedLkgPath || state.currentPath !== expectedCurrentPath ||
          state.versionPath !== expectedVersionPath) {
        throw new Error(`${factId}: manifest fact paths do not match the selected bundle version`);
      }
      const lkgPath = resolvePath(state.lkgPath, /^facts\/lkg\/fact-[a-f0-9]{64}\.json$/);
      const currentPath = resolvePath(state.currentPath, /^facts\/current\/fact-[a-f0-9]{64}\.json$/);
      const versionPath = resolvePath(
        state.versionPath,
        /^facts\/versions\/fact-[a-f0-9]{64}\/[a-f0-9]{64}\.json$/,
      );
      for (const [label, candidatePath] of [
        ['LKG', lkgPath],
        ['current', currentPath],
        ['version', versionPath],
      ] as const) {
        if (!existsSync(candidatePath)) throw new Error(`${factId}: active fact ${label} file is missing`);
        const persisted = JSON.parse(readFileSync(candidatePath, 'utf8')) as AtomicFact;
        if (!bundleFact || !atomicFactRevisionMatches(persisted, bundleFact as AtomicFact)) {
          throw new Error(`${factId}: ${label} fact does not match the current bundle revision`);
        }
      }
      selected.set(factId, {
        file: `${factId}.json`,
        path: lkgPath,
        expectedResolutionHash: String(bundleFact.resolutionHash),
        bundleFact: bundleFact as AtomicFact,
      });
    }
  }

  for (const [factId, state] of Object.entries(manifest.facts as Record<string, any>)) {
    if (state?.active === true && !activeAcrossSubjects.has(factId)) {
      throw new Error(`${factId}: active fact is not owned by a complete subject manifest`);
    }
  }
  return {
    factFiles: [...selected.values()].sort((left, right) => left.file.localeCompare(right.file)),
    evidenceIds,
  };
}

function validateFact(value: unknown, evidence: ReadonlyMap<string, EvidenceDocument>): AtomicFact {
  if (!value || typeof value !== 'object') throw new Error('fact is not an object');
  const fact = value as AtomicFact;
  if (fact.schemaVersion !== 2) throw new Error('unsupported fact schemaVersion');
  if (!FACT_ID_RE.test(String(fact.factId ?? ''))) throw new Error('invalid factId');
  if (atomicFactId(fact) !== fact.factId) throw new Error('factId does not match factKey and scope');
  if (fact.status !== 'verified') throw new Error(`fact is ${fact.status}, not verified`);
  if (!SHA_RE.test(String(fact.resolutionHash ?? ''))) throw new Error('invalid resolutionHash');
  if (!Array.isArray(fact.assertions) || fact.assertions.length < 1) throw new Error('fact has no assertions');
  if (atomicFactHash(fact) !== fact.resolutionHash) throw new Error('fact resolutionHash mismatch');
  if (!factResolutionMatchesAssertions(fact)) throw new Error('fact does not resolve from its assertions');
  for (const assertion of fact.assertions) {
    const document = evidence.get(String(assertion.evidenceId ?? ''));
    if (!document || !assertionEvidenceMatches(assertion, document)) {
      throw new Error('fact assertion is detached from its evidence document scope or lineage');
    }
  }
  return fact;
}

function jurisdictionMatches(region: unknown, regulator: unknown, jurisdiction: string): boolean {
  const text = `${String(region ?? '')} ${String(regulator ?? '')}`.toLowerCase();
  if (jurisdiction === 'US') return text.includes('美国') || text.includes('fda') || /\bus\b/.test(text);
  if (jurisdiction === 'EU') return text.includes('欧盟') || text.includes('ema') || /\beu\b/.test(text);
  if (jurisdiction === 'CN') return text.includes('中国') || text.includes('nmpa') || /\bcn\b/.test(text);
  return false;
}

function candidateFor(fact: AtomicFact, drug: DrugRecord): CandidateRef {
  let contentPath: string | null = null;
  let relation: CandidateRef['relation'] = 'supports';
  let reason = 'Requires editorial review; importer never edits public copy.';
  if (fact.predicate === 'identity.genericName') contentPath = '/genericNameEn';
  else if (fact.predicate === 'product.brandName') {
    const observed = String(fact.value ?? '').trim().toLocaleLowerCase();
    const published = String(drug.data.brandName ?? '').trim().toLocaleLowerCase();
    if (observed && published.includes(observed)) contentPath = '/brandName';
    else reason = 'Product-scoped brand does not match the published brand field; do not bind automatically.';
  } else if (fact.predicate === 'product.authorizationHolder') {
    contentPath = '/company';
    relation = 'contextualizes';
    reason = 'Regional product authorization holder only contextualizes the global company field; an editor must review the relationship before binding.';
  } else if (fact.predicate === 'pharmacology.class') contentPath = '/drugClass';
  else if (fact.predicate === 'pharmacology.targetHint') {
    contentPath = '/target/name';
    relation = 'contextualizes';
  } else if (fact.predicate === 'product.approvedIndication') {
    const label = String((fact.value as Record<string, unknown>)?.label ?? '');
    const groups = Array.isArray(drug.data.indications) ? drug.data.indications : [];
    outer: for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      if (!jurisdictionMatches(group?.region, group?.regulator, fact.scope.jurisdiction)) continue;
      const items = Array.isArray(group?.items) ? group.items : [];
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        if (String(items[itemIndex]).trim().toLocaleLowerCase() === label.trim().toLocaleLowerCase()) {
          contentPath = `/indications/${groupIndex}/items/${itemIndex}`;
          break outer;
        }
      }
    }
    if (!contentPath) reason = 'No exact region-scoped indication item; curate a structured fact before binding.';
  }
  return {
    drugSlug: drug.slug,
    contentPath,
    factId: fact.factId,
    resolutionHash: fact.resolutionHash,
    predicate: fact.predicate,
    relation,
    reason,
  };
}

const apply = process.argv.includes('--apply');
const drugs = loadDrugs();
const blocked: Array<{ file: string; error: string }> = [];
const imported: AtomicFact[] = [];
const candidates: CandidateRef[] = [];
let matchedDrugs = 0;
let updatedFacts = 0;
let removedFacts = 0;
let selection: ActiveSelection = { factFiles: [], evidenceIds: new Set() };
try {
  selection = loadActiveSelection();
} catch (error) {
  blocked.push({
    file: 'fact-manifest.json',
    error: error instanceof Error ? error.message : String(error),
  });
}
const factFiles = selection.factFiles;
let evidence: Map<string, EvidenceDocument>;
try {
  evidence = loadEvidence(selection.evidenceIds);
} catch (error) {
  evidence = new Map();
  blocked.push({ file: 'evidence/documents', error: error instanceof Error ? error.message : String(error) });
}
for (const { file, path, expectedResolutionHash, bundleFact } of factFiles) {
  try {
    const sourceFact = validateFact(JSON.parse(readFileSync(path, 'utf8')), evidence);
    if (sourceFact.resolutionHash !== expectedResolutionHash ||
        !atomicFactRevisionMatches(sourceFact, bundleFact)) {
      throw new Error('active fact file is detached from the manifest/current bundle revision');
    }
    const evidenceDocuments = [...new Set(sourceFact.assertions.map((assertion) => assertion.evidenceId))]
      .map((id) => evidence.get(id))
      .filter((document): document is EvidenceDocument => document !== undefined)
      .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
    const fact: AtomicFact = { ...sourceFact, evidenceDocuments, importHash: '' };
    fact.importHash = importedFactHash(fact);
    const subjectId = String(fact.scope.subjectId ?? '').trim().toLocaleLowerCase();
    const drug = drugs.get(subjectId);
    if (!drug) throw new Error(`no drug matches active ingredient ${subjectId}`);
    matchedDrugs += 1;
    imported.push(fact);
    candidates.push(candidateFor(fact, drug));
    if (apply) {
      const path = join(FACTS_DIR, `${fact.factId}.json`);
      const payload = `${JSON.stringify(fact, null, 2)}\n`;
      if (!existsSync(path) || readFileSync(path, 'utf8') !== payload) {
        atomicWrite(path, payload);
        updatedFacts += 1;
      }
    }
  } catch (error) {
    blocked.push({ file, error: error instanceof Error ? error.message : String(error) });
  }
}

if (apply && blocked.length === 0) {
  mkdirSync(FACTS_DIR, { recursive: true });
  const activeFiles = new Set(imported.map((fact) => `${fact.factId}.json`));
  for (const file of readdirSync(FACTS_DIR).filter((name) => name.endsWith('.json'))) {
    if (!activeFiles.has(file)) {
      rmSync(join(FACTS_DIR, file), { force: true });
      removedFacts += 1;
    }
  }
}

const report = {
  schemaVersion: 2,
  candidates: factFiles.length,
  matchedDrugs,
  importableFacts: imported.length,
  updatedFacts,
  removedFacts,
  factBundleHash: factBundleHash(imported),
  candidateRefs: candidates,
  blocked,
  publicCopyFilesModified: 0,
};
if (apply) atomicWrite(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (blocked.length) process.exitCode = 1;
