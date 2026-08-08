import { test, expect } from 'vitest';
import fc from 'fast-check';
import { t, locales, defaultLocale, hasMultipleLocales, isLocale } from '../src/lib/i18n';

// ---------------------------------------------------------------------------
// P9 — language fallback. The default locale resolves for every published
// entry/string; a missing locale or key falls back predictably and never throws.
// ---------------------------------------------------------------------------

test('P9: the default locale is zh and is part of the locale list', () => {
  expect(defaultLocale).toBe('zh');
  expect(locales).toContain('zh');
  expect(isLocale('zh')).toBe(true);
  expect(isLocale('en')).toBe(false);
});

test('P9: the default locale resolves known keys to their strings', () => {
  expect(t('zh', 'nav.companies')).toBe('公司');
  expect(t('zh', 'nav.drugs')).toBe('药物');
  expect(t('zh', 'nav.search')).toBe('搜索');
  expect(t('zh', 'nav.about')).toBe('关于');
  expect(t('zh', 'search.noResults')).toBe('未找到相关内容');
  expect(t('zh', 'mechanism.advanced')).toBe('进一步了解');
  expect(t('zh', 'mechanism.analogy')).toBe('一句话比喻');
  expect(t('zh', 'drug.target')).toBe('作用靶点');
  expect(t('zh', 'home.browseTitle')).toBe('开始浏览');
  expect(t('zh', 'home.popularLead')).toBe('从这些常用药物直接了解它们怎么起作用：');
  expect(t('zh', 'company.website')).toBe('公司网站');
  expect(t('zh', 'about.companyProfilesTitle')).toBe('公司简介怎么整理');
  expect(t('zh', 'about.companyProfilesLead')).toContain('公司网站');
  expect(t('zh', 'about.guideAnalogy')).toMatch(/^一句话比喻：/);
  expect(t('zh', 'about.guideTarget')).toMatch(/^作用靶点：/);
  expect(t('zh', 'drug.indicationExample')).toBe('适应症示例');
  expect(t('zh', 'notFound.title')).toBe('找不到页面');
  expect(t('zh', 'disclaimer.body')).toContain('不用于判断药物优劣');
});

test('P9: a missing locale falls back to the default locale value', () => {
  // 'en' is not shipped yet -> resolve via the default 'zh' dictionary.
  expect(t('en', 'nav.companies')).toBe(t('zh', 'nav.companies'));
  expect(t('fr-FR', 'disclaimer.body')).toBe(t('zh', 'disclaimer.body'));
});

test('P9: a missing key falls back predictably to the key itself (no throw)', () => {
  expect(t('zh', 'does.not.exist')).toBe('does.not.exist');
  expect(t('en', 'also.missing')).toBe('also.missing');
  // A key that lands on an intermediate object (not a string leaf) is a miss.
  expect(t('zh', 'nav')).toBe('nav');
});

test('P9: only one locale ships today, so the switcher stays hidden', () => {
  expect(hasMultipleLocales).toBe(false);
});

test('P9: t never throws and always returns a string for arbitrary input', () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (locale, key) => {
      const result = t(locale, key);
      expect(typeof result).toBe('string');
    }),
  );
});

test('P9: for any known key, an unknown locale yields the same string as the default', () => {
  const knownKeys = [
    'site.title',
    'nav.home',
    'nav.companies',
    'search.noResults',
    'disclaimer.title',
    'mechanism.simple',
  ];
  fc.assert(
    fc.property(fc.string(), fc.constantFrom(...knownKeys), (locale, key) => {
      // Whatever locale is requested, a known key never degrades to the raw key.
      expect(t(locale, key)).toBe(t(defaultLocale, key));
    }),
  );
});
