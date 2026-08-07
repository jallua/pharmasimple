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

// ---------------------------------------------------------------------------
// Locate the content directories relative to this script.
// ---------------------------------------------------------------------------

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const siteRoot = join(scriptDir, '..');
const companiesDir = join(siteRoot, 'src', 'content', 'companies');
const drugsDir = join(siteRoot, 'src', 'content', 'drugs');

/** An entry-like object plus the source file, so violations can point to it. */
interface FileEntry<T> {
  id: string;
  slug: string;
  file: string; // path relative to the site root, forward-slashed
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
    return { id: slug, slug, file: relPath, data: data as unknown as T };
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
      `${records.length} search record(s). All properties (P1, P2, P3, P4, P5, P7, P8, P10) ` +
      `and the codified review checks P13 (registered sources, >=2 distinct documents, official anchor), ` +
      `P14 (scope red-line: no dosing/usage-advice) and P15 (verified evidence or legacy review ` +
      `within its recheck window) hold.`,
  );
}

main();
