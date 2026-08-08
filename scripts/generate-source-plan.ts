import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { sourceOverrideExpired } from '../src/lib/source-policy.ts';

const ROOT = join(import.meta.dirname, '..');
const DRUGS = join(ROOT, 'src', 'content', 'drugs');
const OUTPUT = join(ROOT, 'scraper', 'source-plan.json');
const OVERRIDES = join(ROOT, 'scraper', 'source-overrides.json');

type SourceName = 'fda' | 'dailymed' | 'ema' | 'nmpa';
type SourceValue = true | string;
type SourceOverride = {
  omit: SourceName[];
  add: Partial<Record<SourceName, SourceValue>>;
  blockAutomation: boolean;
  reason: string;
  reviewAfter: string;
};

const sourceKey: Record<string, SourceName> = {
  'us-fda': 'fda',
  'us-dailymed': 'dailymed',
  'eu-ema': 'ema',
  'cn-nmpa': 'nmpa',
};
const validSourceNames = new Set<SourceName>(Object.values(sourceKey));
const sourceHosts: Record<Exclude<SourceName, 'fda'>, Set<string>> = {
  dailymed: new Set(['dailymed.nlm.nih.gov', 'www.dailymed.nlm.nih.gov']),
  ema: new Set(['ema.europa.eu', 'www.ema.europa.eu']),
  nmpa: new Set(['nmpa.gov.cn', 'www.nmpa.gov.cn']),
};

const overrideDocument = JSON.parse(readFileSync(OVERRIDES, 'utf8')) as Record<string, any>;
if (overrideDocument.schemaVersion !== 1 || !overrideDocument.entries ||
    typeof overrideDocument.entries !== 'object' || Array.isArray(overrideDocument.entries)) {
  throw new Error('scraper/source-overrides.json must be a schemaVersion 1 object');
}
const overrides: Record<string, SourceOverride> = {};
for (const [slug, raw] of Object.entries(overrideDocument.entries as Record<string, any>)) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${slug}: source override must be an object`);
  }
  const omit = raw.omit ?? [];
  const add = raw.add ?? {};
  if (!Array.isArray(omit) || !omit.every((key) => validSourceNames.has(key))) {
    throw new Error(`${slug}: source override omit contains an unknown source`);
  }
  if (!add || typeof add !== 'object' || Array.isArray(add)) {
    throw new Error(`${slug}: source override add must be an object`);
  }
  for (const [key, value] of Object.entries(add)) {
    if (!validSourceNames.has(key as SourceName) || omit.includes(key)) {
      throw new Error(`${slug}: source override add/omit is invalid for ${key}`);
    }
    if (key === 'fda') {
      if (value !== true) throw new Error(`${slug}: FDA override must be true`);
      continue;
    }
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${slug}: ${key} override requires an explicit official URL`);
    }
    const url = new URL(value);
    if (url.protocol !== 'https:' || !sourceHosts[key as Exclude<SourceName, 'fda'>].has(url.hostname.toLowerCase())) {
      throw new Error(`${slug}: ${key} override URL is not on the official HTTPS host`);
    }
    if (key === 'dailymed' && !/[?&]setid=[0-9a-f-]{36}/i.test(value)) {
      throw new Error(`${slug}: DailyMed override requires an explicit setid`);
    }
  }
  if (raw.blockAutomation !== undefined && typeof raw.blockAutomation !== 'boolean') {
    throw new Error(`${slug}: source override blockAutomation must be boolean`);
  }
  if (typeof raw.reason !== 'string' || raw.reason.trim().length < 20 ||
      typeof raw.reviewAfter !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.reviewAfter)) {
    throw new Error(`${slug}: source override requires a reason and ISO reviewAfter date`);
  }
  if (sourceOverrideExpired(raw.reviewAfter)) {
    throw new Error(`${slug}: source override expired on ${raw.reviewAfter}; review it before generating a plan`);
  }
  overrides[slug] = {
    omit,
    add,
    blockAutomation: raw.blockAutomation === true,
    reason: raw.reason.trim(),
    reviewAfter: raw.reviewAfter,
  };
}

const entries = readdirSync(DRUGS)
  .filter((name) => name.endsWith('.md'))
  .sort()
  .map((name) => {
    const parsed = matter(readFileSync(join(DRUGS, name), 'utf8'));
    const data = parsed.data as Record<string, any>;
    const slug = String(data.slug);
    const sources: Partial<Record<SourceName, SourceValue>> = {};
    for (const citation of data.citations ?? []) {
      const key = sourceKey[String(citation.sourceId ?? '')];
      if (!key || sources[key]) continue;
      const url = String(citation.url ?? '');
      if (key === 'fda') {
        sources[key] = true;
      } else if (key === 'dailymed') {
        sources[key] = /[?&]setid=[0-9a-f-]{36}/i.test(url) ? url : true;
      } else {
        sources[key] = url;
      }
    }
    const override = overrides[slug];
    if (override) {
      for (const key of override.omit) delete sources[key];
      Object.assign(sources, override.add);
    }
    const configured = Object.values(sources).filter(Boolean).length;
    return {
      slug,
      genericName: String(data.genericNameEn ?? ''),
      enabled: configured >= 2 && Boolean(data.genericNameEn) && !override?.blockAutomation,
      cadence: 'weekly',
      minimumIndependentLineages: 2,
      sources,
      ...(override ? { sourceOverride: {
        reason: override.reason,
        reviewAfter: override.reviewAfter,
        blockAutomation: override.blockAutomation,
      } } : {}),
      note: override?.blockAutomation
        ? 'Blocked by reviewed source override until an independent official lineage is available.'
        : override
          ? 'Applicable sources include a reviewed override; see sourceOverride for rationale and review date.'
          : configured >= 2
          ? 'Applicable sources derived from explicit existing citation identities.'
          : 'Blocked until a second applicable official source is configured.',
    };
  });

const knownSlugs = new Set(entries.map((entry) => entry.slug));
for (const slug of Object.keys(overrides)) {
  if (!knownSlugs.has(slug)) throw new Error(`${slug}: source override does not match a drug record`);
}

const document = {
  schemaVersion: 1,
  generatedFrom: 'src/content/drugs/*.md citation identities plus scraper/source-overrides.json',
  entries,
};
writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ total: entries.length, enabled: entries.filter((entry) => entry.enabled).length }, null, 2));
