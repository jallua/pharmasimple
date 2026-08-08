// site/scripts/validate-content.ts
//
// Build-time content validation gate (Task 3).
//
// Reads the Markdown entries under `src/content/companies` and
// `src/content/drugs`, parses their frontmatter, builds "entry-like" arrays,
// and enforces the cross-entry correctness properties from the design doc using
// the *pure* helpers in `src/lib/catalog.ts` (single source of truth):
//
//   P1            publish gate — no draft ever leaks into the published set/output
//   P4            referential integrity — every drug's company exists AND is published
//   P8-supporting the published set is well-formed (search index == published, no drafts)
//   P10           slug uniqueness within each collection
//   P2/P3/P5/P7   per-drug content invariants via `drugContentInvariants`
//                 (P7 validates the region-grouped `indications` shape; P5 media
//                 is optional but every present item still needs a non-empty alt)
//   P13/P14/P15   codified review checks (published drugs) via the same helper:
//                 P13 registered source identities (>=2 distinct documents and
//                 >=1 registry-approved official anchor),
//                 P14 scope red-line (no dosing/usage-advice text in summary +
//                 mechanism layers), P15 auto-review metadata (high confidence,
//                 within its recheck window). These make the "review" a
//                 deterministic build-time gate, not a human/AI judgement.
//
// On ANY violation it prints a clear, file/field-scoped message and exits with a
// non-zero status so `npm run build` (which runs this via the `prebuild` hook)
// fails fast. On success it prints a short summary and exits 0.
//
// Run directly with Node's native TypeScript support: `node scripts/validate-content.ts`.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import {
  buildSearchRecords,
  checkReferentialIntegrity,
  drugContentInvariants,
  findDuplicateSlugs,
  publishedOnly,
} from '../src/lib/catalog.ts';
import type { CompanyData, CompanyEntry, DrugData, DrugEntry } from '../src/lib/catalog.ts';
import {
  assertionEvidenceMatches,
  atomicFactHash,
  atomicFactId,
  canonicalHash,
  canonicalJson,
  evidenceDocumentId,
  factBundleHash,
  factResolutionMatchesAssertions,
  importedFactHash,
  requiredTrustedFactPaths,
  trustedFactPayload,
  validateFactRef,
  type AtomicFact,
} from '../src/lib/trusted-content.ts';
import { resolveRegisteredSource } from '../src/lib/source-registry.ts';
import { LEGACY_LKG_POLICY } from '../src/lib/trust-policy.ts';

// ---------------------------------------------------------------------------
// Locate the content directories relative to this script.
// ---------------------------------------------------------------------------

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const siteRoot = join(scriptDir, '..');
const companiesDir = join(siteRoot, 'src', 'content', 'companies');
const drugsDir = join(siteRoot, 'src', 'content', 'drugs');
const factsDir = join(siteRoot, 'src', 'content', 'facts');
const legacyManifestPath = join(siteRoot, 'src', 'data', 'legacy-lkg.json');
const coverageReportPath = join(siteRoot, 'src', 'data', 'trusted-content-coverage.json');
const verifiedProvenancePath = join(siteRoot, 'src', 'data', 'verified-provenance.json');

interface LegacyManifest {
  version: number;
  snapshotId: string;
  capturedAt: string;
  migrationDeadline: string;
  entries: Record<string, { contentDigest: string }>;
}

const sha256 = (value: string): string =>
  `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;

function readVerifiedProvenance(violations: string[]): ReadonlyMap<string, string> {
  if (!existsSync(verifiedProvenancePath)) return new Map();
  try {
    const provenance = JSON.parse(readFileSync(verifiedProvenancePath, 'utf8')) as Record<string, any>;
    if (provenance.schemaVersion !== 1 || !provenance.files || typeof provenance.files !== 'object') {
      throw new Error('invalid schema');
    }
    const files = new Map<string, string>();
    for (const [relativePath, expected] of Object.entries(provenance.files as Record<string, unknown>)) {
      if (!/^(?:scraper\/source-plan\.json|src\/(?:content\/facts\/fact-[a-f0-9]{64}\.json|data\/verified-import-report\.json))$/.test(relativePath) ||
          !/^sha256:[a-f0-9]{64}$/.test(String(expected))) {
        throw new Error(`invalid provenance entry ${relativePath}`);
      }
      const full = join(siteRoot, ...relativePath.split('/'));
      if (existsSync(full)) {
        const actual = `sha256:${createHash('sha256').update(readFileSync(full)).digest('hex')}`;
        if (actual !== expected) throw new Error(`digest mismatch for ${relativePath}`);
      }
      files.set(relativePath, String(expected));
    }
    return files;
  } catch (error) {
    violations.push(`[facts] verified provenance is invalid: ${error instanceof Error ? error.message : String(error)}.`);
    return new Map();
  }
}

/** An entry-like object plus the source file, so violations can point to it. */
interface FileEntry<T> {
  id: string;
  slug: string;
  file: string; // path relative to the site root, forward-slashed
  body: string;
  data: T;
}

// ---------------------------------------------------------------------------
// Read + parse frontmatter into entry-like arrays.
// ---------------------------------------------------------------------------

/** Recursively collect `*.md` files under `dir` (mirrors the glob loader pattern). */
function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listMarkdown(full));
    else if (st.isFile() && name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out.sort();
}

function listJson(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJson(full));
    else if (st.isFile() && name.toLowerCase().endsWith('.json')) out.push(full);
  }
  return out.sort();
}

function readFactIndex(violations: string[]): Map<string, AtomicFact> {
  const facts = new Map<string, AtomicFact>();
  for (const full of listJson(factsDir)) {
    const file = relative(siteRoot, full).split(sep).join('/');
    try {
      const fact = JSON.parse(readFileSync(full, 'utf8')) as AtomicFact;
      if (fact.schemaVersion !== 2 || !/^fact-[a-f0-9]{64}$/.test(String(fact.factId ?? ''))) {
        violations.push(`[facts] ${file}: invalid v2 fact identity.`);
        continue;
      }
      if (facts.has(fact.factId)) {
        violations.push(`[facts] ${file}: duplicate factId ${fact.factId}.`);
        continue;
      }
      if (atomicFactId(fact) !== fact.factId) {
        violations.push(`[facts] ${file}: factId does not match canonical factKey + scope identity.`);
      }
      if (atomicFactHash(fact) !== fact.resolutionHash) {
        violations.push(`[facts] ${file}: resolutionHash does not match canonical fact content.`);
      }
      if (!factResolutionMatchesAssertions(fact)) {
        violations.push(`[facts] ${file}: fact value/status does not resolve from its assertions.`);
      }
      const documents = new Map((fact.evidenceDocuments ?? []).map((document) => [document.evidenceId, document]));
      if (documents.size < 1 || fact.importHash !== importedFactHash(fact)) {
        violations.push(`[facts] ${file}: importHash or embedded evidence documents are invalid.`);
      }
      for (const document of documents.values()) {
        if (evidenceDocumentId(document) !== document.evidenceId) {
          violations.push(`[facts] ${file}: evidenceId does not match immutable document metadata.`);
        }
        if (resolveRegisteredSource({ sourceId: document.sourceId, url: document.sourceUrl })?.authoritative !== true) {
          violations.push(`[facts] ${file}: embedded evidence is not a registered authoritative source.`);
        }
      }
      for (const assertion of fact.assertions ?? []) {
        const document = documents.get(assertion.evidenceId);
        if (!document || !assertionEvidenceMatches(assertion, document)) {
          violations.push(`[facts] ${file}: assertion is detached from its embedded evidence document scope or lineage.`);
        }
      }
      facts.set(fact.factId, fact);
    } catch (error) {
      violations.push(`[facts] ${file}: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }
  return facts;
}

function readEntries<T>(dir: string): FileEntry<T>[] {
  return listMarkdown(dir).map((full) => {
    const raw = readFileSync(full, 'utf8');
    const parsed = matter(raw);
    const data = (parsed.data ?? {}) as Record<string, unknown> & { slug?: unknown };
    const relPath = relative(siteRoot, full).split(sep).join('/');
    const fileBase = (full.split(/[\\/]/).pop() ?? '').replace(/\.md$/i, '');
    // Prefer the explicit frontmatter slug (the schema requires it); fall back
    // to the filename so the pure helpers still have a stable identifier.
    const slug =
      typeof data.slug === 'string' && data.slug.length > 0 ? data.slug : fileBase;
    return { id: slug, slug, file: relPath, body: parsed.content, data: data as unknown as T };
  });
}

/**
 * slug -> [files], so duplicate-slug messages can list every offending file.
 * Typed structurally (only `slug`/`file` are used) so it accepts either the
 * company or drug `FileEntry[]` — including the `companies | drugs` union the
 * P10 loop iterates over.
 */
function groupFilesBySlug(entries: ReadonlyArray<{ slug: string; file: string }>): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of entries) {
    const arr = m.get(e.slug) ?? [];
    arr.push(e.file);
    m.set(e.slug, arr);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Validate.
// ---------------------------------------------------------------------------

function main(): void {
  const violations: string[] = [];

  const companies = readEntries<CompanyData>(companiesDir);
  const drugs = readEntries<DrugData>(drugsDir);
  const facts = readFactIndex(violations);
  const verifiedProvenance = readVerifiedProvenance(violations);
  if (!existsSync(legacyManifestPath)) {
    violations.push(`[P15] Missing legacy LKG manifest: ${relative(siteRoot, legacyManifestPath)}.`);
  }
  const legacyManifest = existsSync(legacyManifestPath)
    ? (JSON.parse(readFileSync(legacyManifestPath, 'utf8')) as LegacyManifest)
    : { version: 0, snapshotId: '', capturedAt: '', migrationDeadline: '', entries: {} };
  if (existsSync(legacyManifestPath)) {
    if (canonicalHash(legacyManifest) !== LEGACY_LKG_POLICY.manifestHash) {
      violations.push('[P15] Legacy LKG manifest differs from the immutable policy baseline.');
    }
    if (legacyManifest.snapshotId !== LEGACY_LKG_POLICY.snapshotId ||
        legacyManifest.capturedAt !== LEGACY_LKG_POLICY.capturedAt ||
        legacyManifest.migrationDeadline !== LEGACY_LKG_POLICY.migrationDeadline ||
        Object.keys(legacyManifest.entries).length !== LEGACY_LKG_POLICY.entryCount) {
      violations.push('[P15] Legacy LKG snapshot identity, deadline, or entry set violates policy.');
    }
  }

  // These casts are safe: FileEntry structurally satisfies catalog's Entry<T>
  // (id/slug/data), and the extra `file` field is ignored by the helpers.
  const companyEntries = companies as unknown as CompanyEntry[];
  const drugEntries = drugs as unknown as DrugEntry[];

  // --- P10: slug uniqueness within each collection -------------------------
  for (const [label, entries] of [
    ['companies', companies],
    ['drugs', drugs],
  ] as const) {
    const filesBySlug = groupFilesBySlug(entries);
    for (const slug of findDuplicateSlugs(entries)) {
      const files = (filesBySlug.get(slug) ?? []).join(', ');
      violations.push(
        `[P10] Duplicate slug "${slug}" in ${label} (files: ${files}). ` +
          `Each slug must be unique within its collection.`,
      );
    }
  }

  // --- P4: referential integrity -------------------------------------------
  // Rule 1: every drug (draft or reviewed) must reference an EXISTING company.
  // Rule 2: additionally, a PUBLISHED (reviewed) drug's company must ALSO be
  //         published. A draft drug pointing at an existing but unpublished
  //         company is sound and is not flagged.
  const allCompanySlugs = new Set(companies.map((c) => c.slug));
  for (const drug of checkReferentialIntegrity(companyEntries, drugEntries)) {
    const fe = drug as unknown as FileEntry<DrugData>;
    const company = fe.data.company as unknown;
    const ref =
      typeof company === 'string'
        ? company
        : ((company as { id?: string; slug?: string })?.id ??
           (company as { id?: string; slug?: string })?.slug ??
           JSON.stringify(company));
    const reason = !allCompanySlugs.has(ref)
      ? `referenced company "${ref}" does not exist`
      : `this drug is published (reviewStatus 'reviewed') but its company "${ref}" is not published`;
    violations.push(`[P4] Drug "${fe.slug}" (${fe.file}) field 'company': ${reason}.`);
  }

  // --- P2/P3/P5/P7 + P13/P14/P15: per-drug content invariants ---------------
  // `drugContentInvariants` runs the base invariants for every drug and, for
  // PUBLISHED (reviewed) drugs, the codified review checks:
  //   P13 source registry + distinct document identities + official anchor,
  //   P14 scope red-line (no dosing/usage-advice text in summary + mechanism),
  //   P15 auto-review metadata (high confidence, within recheck window).
  // Each returned message already names its property + field; we prefix the file.
  for (const drug of drugs) {
    const result = drugContentInvariants(drug as unknown as DrugEntry);
    for (const v of result.violations) {
      violations.push(`[content] Drug "${drug.slug}" (${drug.file}) — ${v}.`);
    }

    if (drug.data.verification?.status === 'verified') {
      const referenced = new Map<string, AtomicFact>();
      const reviewedPaths = new Set<string>();
      for (const ref of drug.data.factRefs ?? []) {
        const errors = validateFactRef(
          drug.data,
          ref,
          facts,
          String(drug.data.genericNameEn ?? ''),
        );
        for (const error of errors) {
          violations.push(`[facts] Drug "${drug.slug}" (${drug.file}) ${ref.contentPath}: ${error}.`);
        }
        if (ref.reviewStatus === 'reviewed' && errors.length === 0) reviewedPaths.add(ref.contentPath);
        for (const factId of ref.factIds) {
          const fact = facts.get(factId);
          if (fact) referenced.set(factId, fact);
        }
      }
      for (const contentPath of requiredTrustedFactPaths(drug.data)) {
        if (!reviewedPaths.has(contentPath)) {
          violations.push(`[facts] Drug "${drug.slug}" (${drug.file}): verified v2 field ${contentPath} has no valid reviewed factRef.`);
        }
      }
      for (const factId of referenced.keys()) {
        const factPath = `src/content/facts/${factId}.json`;
        if (!verifiedProvenance.has(factPath)) {
          violations.push(`[facts] Drug "${drug.slug}" (${drug.file}): ${factId} lacks protected refresh provenance.`);
        }
      }
      const expectedBundleHash = factBundleHash(referenced.values());
      if (drug.data.verification.bundleHash !== expectedBundleHash) {
        violations.push(`[facts] Drug "${drug.slug}" (${drug.file}): verification.bundleHash does not match referenced facts.`);
      }
    }

    const legacy = drug.data.legacyLkg;
    if (legacy) {
      const catalogEntry = legacyManifest.entries[drug.slug];
      const currentDigest = sha256(
        canonicalJson(trustedFactPayload(drug.data as unknown as Record<string, unknown>, drug.body)),
      );
      if (!catalogEntry) {
        violations.push(`[P15] Drug "${drug.slug}" (${drug.file}) is not one of the explicit legacy LKG entries.`);
      } else if (catalogEntry.contentDigest !== currentDigest) {
        violations.push(
          `[P15] Drug "${drug.slug}" (${drug.file}) changed from its legacy LKG snapshot; ` +
            `remove legacyLkg and provide verified field evidence + bundleHash.`,
        );
      }
      const migrateBy = new Date(legacy.migrateBy).toISOString().slice(0, 10);
      if (legacy.snapshotId !== legacyManifest.snapshotId || migrateBy !== legacyManifest.migrationDeadline) {
        violations.push(`[P15] Drug "${drug.slug}" (${drug.file}) legacy metadata disagrees with the migration manifest.`);
      }
    }
  }

  const statusCounts = { verified: 0, conflicted: 0, stale: 0, blocked: 0 };
  let legacyCount = 0;
  let citationCount = 0;
  let citedWithId = 0;
  let citedWithSourceId = 0;
  let evidenceClaimCount = 0;
  for (const drug of drugs) {
    const status = drug.data.verification?.status;
    if (status) statusCounts[status] += 1;
    if (drug.data.legacyLkg) legacyCount += 1;
    citationCount += drug.data.citations?.length ?? 0;
    citedWithId += drug.data.citations?.filter((citation) => !!citation.id).length ?? 0;
    citedWithSourceId += drug.data.citations?.filter((citation) => !!citation.sourceId).length ?? 0;
    evidenceClaimCount += drug.data.evidence?.length ?? 0;
  }
  const coverage = {
    total: drugs.length,
    ...statusCounts,
    legacyLkg: legacyCount,
    needsOnlineVerification: drugs.length - statusCounts.verified,
    citations: citationCount,
    citationsWithId: citedWithId,
    citationsWithSourceId: citedWithSourceId,
    evidenceClaims: evidenceClaimCount,
  };
  if (!existsSync(coverageReportPath)) {
    violations.push(`[P15] Missing trusted-content coverage report: ${relative(siteRoot, coverageReportPath)}.`);
  } else {
    const report = JSON.parse(readFileSync(coverageReportPath, 'utf8')) as any;
    if (report.migrationDeadline !== LEGACY_LKG_POLICY.migrationDeadline) {
      violations.push('[P15] trusted-content coverage report changes the immutable migration deadline.');
    }
    const reportCoverage = {
      total: report.drugs?.total,
      verified: report.drugs?.verified,
      conflicted: report.drugs?.conflicted,
      stale: report.drugs?.stale,
      blocked: report.drugs?.blocked,
      legacyLkg: report.drugs?.legacyLkg,
      needsOnlineVerification: report.drugs?.needsOnlineVerification,
      citations: report.citations?.total,
      citationsWithId: report.citations?.withStableId,
      citationsWithSourceId: report.citations?.withStableSourceId,
      evidenceClaims: report.evidence?.mappedClaims,
    };
    if (canonicalJson(reportCoverage) !== canonicalJson(coverage)) {
      violations.push('[P15] trusted-content coverage report is stale; regenerate it from current content.');
    }
  }

  // --- P1: publish gate — the published set contains only reviewed entries -
  const publishedCompanies = publishedOnly(companyEntries);
  const publishedDrugs = publishedOnly(drugEntries);
  for (const [label, published] of [
    ['company', publishedCompanies],
    ['drug', publishedDrugs],
  ] as const) {
    for (const entry of published) {
      if (entry.data.reviewStatus !== 'reviewed') {
        violations.push(
          `[P1] Published ${label} "${entry.data.slug ?? entry.id}" has ` +
            `reviewStatus "${entry.data.reviewStatus}" (a draft must never reach the published set).`,
        );
      }
    }
  }

  // --- P8-supporting: the published set / search index is well-formed ------
  const records = buildSearchRecords(companyEntries, drugEntries);
  const expectedCount = publishedCompanies.length + publishedDrugs.length;
  if (records.length !== expectedCount) {
    violations.push(
      `[P8] Search index has ${records.length} record(s) but there are ` +
        `${expectedCount} published entr(ies); the index must cover exactly the published set.`,
    );
  }
  const draftCompanySlugs = new Set(
    companies.filter((c) => c.data.reviewStatus === 'draft').map((c) => c.slug),
  );
  const draftDrugSlugs = new Set(
    drugs.filter((d) => d.data.reviewStatus === 'draft').map((d) => d.slug),
  );
  for (const r of records) {
    const leaked = r.type === 'company' ? draftCompanySlugs.has(r.slug) : draftDrugSlugs.has(r.slug);
    if (leaked) {
      violations.push(`[P1/P8] Draft ${r.type} "${r.slug}" leaked into the search index / output.`);
    }
  }

  // --- Report --------------------------------------------------------------
  const scanned = `${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} + ` +
    `${drugs.length} drug${drugs.length === 1 ? '' : 's'}`;

  if (violations.length > 0) {
    console.error(`\nContent validation FAILED: ${violations.length} problem(s) found.\n`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error(`\nScanned ${scanned}. Fix the entries above, then rebuild.\n`);
    process.exit(1);
  }

  console.log(
    `Content validation passed: scanned ${scanned}; ` +
      `${publishedCompanies.length} + ${publishedDrugs.length} published, ` +
      `${records.length} search record(s). Trust coverage: ${coverage.verified}/${coverage.total} verified, ` +
      `${coverage.legacyLkg} explicit legacy LKG (${coverage.stale} stale), ` +
      `${coverage.evidenceClaims} mapped field claim(s), ${coverage.citationsWithId}/${coverage.citations} citations ` +
      `with stable id and ${coverage.citationsWithSourceId}/${coverage.citations} with sourceId. ` +
      `Online verification remaining: ${coverage.needsOnlineVerification}; migration deadline: ` +
      `${legacyManifest.migrationDeadline}. P13/P14/P15 hold; high-review metadata grants no publication bypass.`,
  );
}

main();
