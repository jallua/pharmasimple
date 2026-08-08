import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { sourceIdentityForUrl } from '../src/lib/source-registry.ts';
import { canonicalJson, trustedFactPayload } from '../src/lib/trusted-content.ts';
import { LEGACY_LKG_POLICY } from '../src/lib/trust-policy.ts';

const ROOT = join(import.meta.dirname, '..');
const DRUGS_DIR = join(ROOT, 'src', 'content', 'drugs');
const MANIFEST_PATH = join(ROOT, 'src', 'data', 'legacy-lkg.json');
const REPORT_PATH = join(ROOT, 'src', 'data', 'trusted-content-coverage.json');
const SNAPSHOT_ID = LEGACY_LKG_POLICY.snapshotId;
const CAPTURED_AT = LEGACY_LKG_POLICY.capturedAt;
const MIGRATE_BY = LEGACY_LKG_POLICY.migrationDeadline;
const HASH_RE = /^sha256:[a-f0-9]{64}$/;

if (existsSync(MANIFEST_PATH)) {
  throw new Error('legacy LKG manifest already exists; immutable migration baselines cannot be rebuilt');
}

const sha256 = (value: string): string =>
  `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;

function citationId(url: string, title: string): string {
  return `cite-${createHash('sha256').update(`${url}\0${title}`, 'utf8').digest('hex').slice(0, 16)}`;
}

function migrateFrontmatter(raw: string, file: string): string {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, any>;
  if (data.legacyLkg) {
    if (data.legacyLkg.snapshotId !== SNAPSHOT_ID) throw new Error(`${file}: unexpected legacy snapshot`);
    return raw.replace(/\r\n/g, '\n');
  }
  if (data.reviewStatus !== 'reviewed') throw new Error(`${file}: expected reviewed legacy entry`);
  if (!Array.isArray(data.citations) || data.citations.length < 1) throw new Error(`${file}: citations missing`);

  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let citationIndex = 0;
  const migrated: string[] = [];
  let skippingReview = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === 'review:') {
      skippingReview = true;
      continue;
    }
    if (skippingReview) {
      if (/^[^ \t].*:$/.test(line) || /^reviewStatus:/.test(line)) {
        skippingReview = false;
      } else {
        continue;
      }
    }

    if (/^  - title:/.test(line)) {
      const citation = data.citations[citationIndex++] as Record<string, unknown>;
      const title = String(citation.title ?? '');
      const url = String(citation.url ?? '');
      const sourceId = sourceIdentityForUrl(url);
      if (!url || !sourceId) throw new Error(`${file}: citation ${citationIndex} lacks a valid HTTPS URL`);
      migrated.push(line);
      migrated.push(`    id: ${citationId(url, title)}`);
      migrated.push(`    sourceId: ${sourceId}`);
      continue;
    }
    if (/^    (id|sourceId):/.test(line)) continue;

    if (/^reviewStatus:/.test(line)) {
      const checkedAt = data.review?.checkedOn
        ? new Date(data.review.checkedOn).toISOString().slice(0, 10)
        : CAPTURED_AT;
      migrated.push('verification:');
      migrated.push('  status: stale');
      migrated.push(`  checkedAt: ${checkedAt}`);
      migrated.push(`  nextCheckAt: ${MIGRATE_BY}`);
      migrated.push('  pipelineVersion: legacy-lkg-v1');
      migrated.push('legacyLkg:');
      migrated.push(`  snapshotId: ${SNAPSHOT_ID}`);
      migrated.push(`  capturedAt: ${CAPTURED_AT}`);
      migrated.push(`  migrateBy: ${MIGRATE_BY}`);
    }
    migrated.push(line);
  }

  if (citationIndex !== data.citations.length) {
    throw new Error(`${file}: migrated ${citationIndex}/${data.citations.length} citations`);
  }
  return migrated.join('\n');
}

const files = readdirSync(DRUGS_DIR).filter((name) => name.endsWith('.md')).sort();
if (files.length !== 102) throw new Error(`expected 102 legacy drugs, found ${files.length}`);

for (const file of files) {
  const path = join(DRUGS_DIR, file);
  const raw = readFileSync(path, 'utf8');
  writeFileSync(path, migrateFrontmatter(raw, file), 'utf8');
}

const entries: Record<string, { contentDigest: string }> = {};
let citationCount = 0;
let identifiedCitationCount = 0;
for (const file of files) {
  const parsed = matter(readFileSync(join(DRUGS_DIR, file), 'utf8'));
  const data = parsed.data as Record<string, any>;
  const citations = data.citations as Array<Record<string, unknown>>;
  citationCount += citations.length;
  identifiedCitationCount += citations.filter((citation) => citation.id && citation.sourceId).length;
  const contentDigest = sha256(canonicalJson(trustedFactPayload(data, parsed.content)));
  if (!HASH_RE.test(contentDigest)) throw new Error(`${file}: digest generation failed`);
  entries[String(data.slug)] = { contentDigest };
}

writeFileSync(
  MANIFEST_PATH,
  `${JSON.stringify({ version: 1, snapshotId: SNAPSHOT_ID, capturedAt: CAPTURED_AT, migrationDeadline: MIGRATE_BY, entries }, null, 2)}\n`,
  'utf8',
);

const report = {
  schemaVersion: 1,
  generatedAt: CAPTURED_AT,
  migrationDeadline: MIGRATE_BY,
  drugs: {
    total: files.length,
    verified: 0,
    conflicted: 0,
    stale: files.length,
    blocked: 0,
    legacyLkg: files.length,
    needsOnlineVerification: files.length,
  },
  citations: {
    total: citationCount,
    withStableId: identifiedCitationCount,
    withStableSourceId: identifiedCitationCount,
  },
  evidence: {
    mappedClaims: 0,
    note: 'No field evidence was inferred. Claims require explicit source-to-field mapping.',
  },
};
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
