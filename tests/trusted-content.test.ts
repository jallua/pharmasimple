import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { expect, test } from 'vitest';
import { citationSourceIdentityMatches, sourceIdentityForUrl } from '../src/lib/source-registry';
import {
  canonicalHash,
  canonicalJson,
  evidenceClaimMatches,
  resolveEvidenceClaim,
  trustedFactPayload,
} from '../src/lib/trusted-content';
import { LEGACY_LKG_POLICY } from '../src/lib/trust-policy';

const ROOT = join(import.meta.dirname, '..');
const DRUGS_DIR = join(ROOT, 'src', 'content', 'drugs');
const manifest = JSON.parse(
  readFileSync(join(ROOT, 'src', 'data', 'legacy-lkg.json'), 'utf8'),
) as {
  snapshotId: string;
  capturedAt: string;
  migrationDeadline: string;
  entries: Record<string, { contentDigest: string }>;
};
const report = JSON.parse(
  readFileSync(join(ROOT, 'src', 'data', 'trusted-content-coverage.json'), 'utf8'),
);
const sha256 = (value: string): string =>
  `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;

test('stable source identities distinguish registered authorities and external HTTPS hosts', () => {
  expect(sourceIdentityForUrl('https://www.fda.gov/a')).toBe('us-fda');
  expect(sourceIdentityForUrl('https://example.com/a')).toBe('web:example.com');
  expect(sourceIdentityForUrl('http://example.com/a')).toBeUndefined();
  expect(citationSourceIdentityMatches({ url: 'https://example.com/a', sourceId: 'web:example.com' })).toBe(true);
  expect(citationSourceIdentityMatches({ url: 'https://example.com/a', sourceId: 'web:other.com' })).toBe(false);
});

test('field evidence resolves RFC 6901 paths and compares exact values', () => {
  const drug = { summary: 'current', target: { name: 'BTK' }, indications: [{ items: ['CLL'] }] };
  expect(resolveEvidenceClaim(drug, '/target/name')).toBe('BTK');
  expect(resolveEvidenceClaim(drug, '/indications/0/items/0')).toBe('CLL');
  expect(resolveEvidenceClaim(drug, '/reviewStatus')).toBeUndefined();
  expect(evidenceClaimMatches(drug, '/summary', 'current')).toBe(true);
  expect(evidenceClaimMatches(drug, '/summary', 'old')).toBe(false);
});

test('legacy LKG manifest is pinned to the immutable migration policy', () => {
  expect(canonicalHash(manifest)).toBe(LEGACY_LKG_POLICY.manifestHash);
  expect(manifest.snapshotId).toBe(LEGACY_LKG_POLICY.snapshotId);
  expect(manifest.capturedAt).toBe(LEGACY_LKG_POLICY.capturedAt);
  expect(manifest.migrationDeadline).toBe(LEGACY_LKG_POLICY.migrationDeadline);
  expect(Object.keys(manifest.entries)).toHaveLength(LEGACY_LKG_POLICY.entryCount);
  expect(report.migrationDeadline).toBe(LEGACY_LKG_POLICY.migrationDeadline);
});

test('all 102 legacy LKG entries are explicit, stale, identity-complete, and snapshot-bound', () => {
  const files = readdirSync(DRUGS_DIR).filter((name) => name.endsWith('.md')).sort();
  expect(files).toHaveLength(102);
  expect(Object.keys(manifest.entries)).toHaveLength(102);

  let citations = 0;
  for (const file of files) {
    const parsed = matter(readFileSync(join(DRUGS_DIR, file), 'utf8'));
    const data = parsed.data as Record<string, any>;
    expect(data.review).toBeUndefined();
    expect(data.verification.status).toBe('stale');
    expect(data.verification.bundleHash).toBeUndefined();
    expect(data.legacyLkg.snapshotId).toBe(manifest.snapshotId);
    expect(new Date(data.legacyLkg.migrateBy).toISOString().slice(0, 10)).toBe(
      manifest.migrationDeadline,
    );
    expect(data.evidence).toBeUndefined();

    const ids = new Set<string>();
    for (const citation of data.citations) {
      citations += 1;
      expect(citation.id).toMatch(/^cite-[a-f0-9]{16}$/);
      expect(ids.has(citation.id)).toBe(false);
      ids.add(citation.id);
      expect(citationSourceIdentityMatches(citation)).toBe(true);
    }

    const digest = sha256(canonicalJson(trustedFactPayload(data, parsed.content)));
    expect(manifest.entries[data.slug]?.contentDigest).toBe(digest);
  }

  expect(citations).toBe(212);
  expect(report.drugs).toMatchObject({
    total: 102,
    verified: 0,
    stale: 102,
    legacyLkg: 102,
    needsOnlineVerification: 102,
  });
  expect(report.citations).toMatchObject({ total: 212, withStableId: 212, withStableSourceId: 212 });
  expect(report.evidence.mappedClaims).toBe(0);
});
