import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { sourceOverrideExpired } from '../src/lib/source-policy';

const ROOT = join(import.meta.dirname, '..');

describe('trusted refresh automation', () => {
  test('source plan covers every current drug and only enables multi-source entries', () => {
    const plan = JSON.parse(readFileSync(join(ROOT, 'scraper', 'source-plan.json'), 'utf8'));
    expect(plan.schemaVersion).toBe(1);
    expect(plan.generatedFrom).toContain('scraper/source-overrides.json');
    expect(plan.entries).toHaveLength(102);
    for (const entry of plan.entries) {
      const configured = Object.values(entry.sources).filter(Boolean).length;
      expect(entry.minimumIndependentLineages).toBe(2);
      expect(entry.enabled).toBe(
        configured >= 2 && Boolean(entry.genericName) && entry.sourceOverride?.blockAutomation !== true,
      );
    }
    expect(plan.entries.filter((entry: any) => entry.enabled)).toEqual([]);
    const toripalimab = plan.entries.find((entry: any) => entry.slug === 'toripalimab');
    expect(toripalimab.sources).toEqual({
      fda: true,
      dailymed: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=82e7921a-1e84-4988-9799-0ad7d19b2a75',
    });
    expect(toripalimab.sourceOverride.reviewAfter).toBe('2026-09-07');
    expect(toripalimab.sourceOverride.blockAutomation).toBe(true);
    for (const slug of ['imatinib', 'lebrikizumab', 'nivolumab', 'pembrolizumab', 'tislelizumab', 'toripalimab', 'zanubrutinib']) {
      const entry = plan.entries.find((item: any) => item.slug === slug);
      expect(entry.enabled).toBe(false);
      expect(entry.sourceOverride.blockAutomation).toBe(true);
    }
  });

  test('source overrides expire at the beginning of reviewAfter in UTC', () => {
    expect(sourceOverrideExpired('2026-09-07', '2026-09-06')).toBe(false);
    expect(sourceOverrideExpired('2026-09-07', '2026-09-07')).toBe(true);
    expect(sourceOverrideExpired('2026-09-07', '2026-09-08')).toBe(true);
    expect(() => sourceOverrideExpired('2026-02-30', '2026-02-01')).toThrow(/real calendar date/);
  });


  test('workflows bind deployment and verified-content changes to trusted identities', () => {
    const deploy = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const refresh = readFileSync(join(ROOT, '.github', 'workflows', 'refresh-content.yml'), 'utf8');
    expect(deploy).not.toMatch(/^\s*workflow_dispatch:/m);
    expect(deploy.match(/if: github\.ref == 'refs\/heads\/main'/g)).toHaveLength(3);
    expect(deploy).toContain('Audit Python dependencies without artifact access');
    expect(ci).toContain('CONTENT_REFRESH_APP_BOT_LOGIN');
    expect(ci).toContain('gh run download');
    expect(ci).toContain("'src/lib/trust-policy.ts', 'src/data/legacy-lkg.json'");
    expect(ci).toContain('PR file differs from trusted run artifact');
    expect(refresh).toContain("find src/content/facts -maxdepth 1 -type f -name 'fact-*.json' -delete");
    expect(refresh).not.toContain('rm -rf src/content/facts');
  });

  test('trusted importer dry-run is non-mutating and reports blocked inputs', () => {
    const result = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts', 'import-verified-content.ts')],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const report = JSON.parse(result.stdout);
    expect(result.status).toBe(report.blocked.length ? 1 : 0);
    expect(report.schemaVersion).toBe(2);
    expect(Array.isArray(report.blocked)).toBe(true);
    expect(report.updatedFacts).toBe(0);
    expect(report.publicCopyFilesModified).toBe(0);
  });
});
