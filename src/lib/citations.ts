// site/src/lib/citations.ts
//
// Pure presentation helper for source citations (Task 5). Keeping the
// citations -> view-model mapping out of the `.astro` component means it can be
// unit-tested directly (and is the reliable fallback for the component test).
//
// Rules:
//   - Entries without a non-empty `title` are dropped (nothing useful to show).
//   - A citation is a link only when it carries a non-empty `url`.
//   - An empty / missing input yields an empty array (the component then renders
//     nothing at all).

import type { Citation } from './catalog';

export interface CitationView {
  title: string;
  url?: string;
  hasLink: boolean;
}

export function citationsToViewModel(
  citations?: Citation[] | null,
): CitationView[] {
  if (!Array.isArray(citations)) return [];

  return citations
    .filter((c): c is Citation => !!c && typeof c.title === 'string' && c.title.length > 0)
    .map((c) => {
      const url = typeof c.url === 'string' && c.url.length > 0 ? c.url : undefined;
      return { title: c.title, url, hasLink: url !== undefined };
    });
}
