import { test, expect } from 'vitest';
import fc from 'fast-check';
import { citationsToViewModel } from '../src/lib/citations';
import type { Citation } from '../src/lib/catalog';

// ---------------------------------------------------------------------------
// Pure citations -> view-model helper (P2 display side). This is the reliable
// backbone of the Citations component: the component only iterates this output.
// ---------------------------------------------------------------------------

test('empty or missing input yields an empty view model (component renders nothing)', () => {
  expect(citationsToViewModel([])).toEqual([]);
  expect(citationsToViewModel(undefined)).toEqual([]);
  expect(citationsToViewModel(null)).toEqual([]);
});

test('a citation with a url becomes a link; without one it does not', () => {
  const citations: Citation[] = [
    { title: 'FDA label', url: 'https://example.com/label' },
    { title: 'Journal article, no link' },
  ];
  const view = citationsToViewModel(citations);
  expect(view).toEqual([
    { title: 'FDA label', url: 'https://example.com/label', hasLink: true },
    { title: 'Journal article, no link', url: undefined, hasLink: false },
  ]);
});

test('entries without a usable title are dropped', () => {
  const citations = [
    { title: '' },
    { title: 'Kept' },
    // Defensive runtime handling of bad data: an object with no `title`. The
    // surrounding `as Citation[]` cast already admits this shape, so no
    // per-element @ts-expect-error is needed (it would be flagged as unused).
    { publisher: 'no title field' },
  ] as Citation[];
  const view = citationsToViewModel(citations);
  expect(view).toEqual([{ title: 'Kept', url: undefined, hasLink: false }]);
});

test('hasLink is true exactly when a non-empty url is present', () => {
  const citationArb: fc.Arbitrary<Citation> = fc.record({
    title: fc.string({ minLength: 1 }),
    url: fc.option(fc.webUrl(), { nil: undefined }),
    publisher: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  });

  fc.assert(
    fc.property(fc.array(citationArb), (citations) => {
      const view = citationsToViewModel(citations);
      // Every kept view item mirrors a source citation with a non-empty title.
      expect(view.length).toBe(citations.filter((c) => c.title.length > 0).length);
      for (const item of view) {
        expect(item.hasLink).toBe(item.url !== undefined);
        if (item.url !== undefined) expect(item.url.length).toBeGreaterThan(0);
      }
    }),
  );
});
