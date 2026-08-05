// site/src/lib/i18n.ts
//
// Tiny, pure i18n lookup (Task 4). UI strings live in JSON dictionaries under
// `src/i18n/*.json`; components call `t(locale, key)` to resolve them.
//
// Design guarantees (correctness property P9):
//   - The default locale ('zh') resolves for every key present in its dictionary.
//   - A missing locale falls back to the default locale.
//   - A missing key falls back predictably to the key string itself.
//   - `t` NEVER throws, for any `locale`/`key` input (including non-strings).
//
// Keeping this a pure function means it can be unit-tested without booting Astro.

import zh from '../i18n/zh.json';

/** The default locale. Chinese is authored first (需求 10). */
export const defaultLocale = 'zh';

/** All locales the site currently ships. Add 'en' etc. here to light up i18n. */
export const locales = ['zh'] as const;

export type Locale = (typeof locales)[number];

/** A nested dictionary: values are either strings or further nested objects. */
export interface Dictionary {
  [key: string]: string | Dictionary;
}

const dictionaries: Record<string, Dictionary> = {
  zh: zh as Dictionary,
};

/**
 * Resolve a dot-separated `key` (e.g. "nav.companies") against a dictionary.
 * Returns the string leaf, or `undefined` if the path is missing or lands on a
 * non-string (e.g. an intermediate object).
 */
function lookup(dict: Dictionary | undefined, key: string): string | undefined {
  if (!dict || typeof key !== 'string' || key.length === 0) return undefined;
  let current: string | Dictionary | undefined = dict;
  for (const part of key.split('.')) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Dictionary)[part];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * Translate `key` for `locale`, falling back to the default locale, then to the
 * raw key. Never throws — a missing translation degrades gracefully.
 */
export function t(locale: string, key: string): string {
  const fromLocale = lookup(dictionaries[locale], key);
  if (fromLocale !== undefined) return fromLocale;

  const fromDefault = lookup(dictionaries[defaultLocale], key);
  if (fromDefault !== undefined) return fromDefault;

  // Predictable, non-throwing fallback: echo the key so missing strings are
  // visible in the UI rather than crashing the render.
  return key;
}

/** Whether a language switcher should render (only meaningful with >1 locale). */
export const hasMultipleLocales = locales.length > 1;

/** True when `value` is one of the known locales. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}
