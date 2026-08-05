import { test, expect } from 'vitest';
import fc from 'fast-check';
import {
  publishedOnly,
  publishedCompanyDetailPaths,
  publishedDrugDetailPaths,
  companiesWithPublishedDrugs,
  sortCompanies,
  type CompanyEntry,
  type DrugEntry,
  type ReviewStatus,
} from '../src/lib/catalog';

// ---------------------------------------------------------------------------
// These exercise the PURE routing logic behind the Astro pages' getStaticPaths
// (Task 7). The pages call getCollection(...) and hand the results straight to
// these helpers, so testing the helpers with in-memory fixtures verifies the
// page-level guarantees P1 (published only) and P4 (reference integrity).
// ---------------------------------------------------------------------------

const companyEntry = (
  slug: string,
  reviewStatus: ReviewStatus,
  extra: Partial<CompanyEntry['data']> = {},
): CompanyEntry => ({
  id: slug,
  data: { slug, locale: 'zh', name: slug, reviewStatus, ...extra },
});

const drugEntry = (slug: string, company: string, reviewStatus: ReviewStatus): DrugEntry => ({
  id: slug,
  data: {
    slug,
    locale: 'zh',
    company,
    genericName: slug,
    indications: [{ region: 'CN', regulator: 'NMPA', items: ['x'] }],
    target: { name: 't', type: 'protein', role: 'r' },
    mechanism: { analogy: 'a', simple: 's', advanced: 'adv' },
    media: [{ type: 'placeholder', alt: 'alt' }],
    citations: [],
    reviewStatus,
  },
});

// ---------------------------------------------------------------------------
// Empty collections — pages must build gracefully with zero content (Task 10
// authors the first content), producing zero routes.
// ---------------------------------------------------------------------------

test('empty collections yield zero routes for both dynamic pages', () => {
  expect(publishedCompanyDetailPaths([], [])).toEqual([]);
  expect(publishedDrugDetailPaths([])).toEqual([]);
  expect(companiesWithPublishedDrugs([]).size).toBe(0);
});

// ---------------------------------------------------------------------------
// P1 — only published entries become routes.
// ---------------------------------------------------------------------------

test('P1: /drugs/[slug] paths are exactly the published drugs; drafts excluded', () => {
  const drugs = [
    drugEntry('d1', 'acme', 'reviewed'),
    drugEntry('d2', 'acme', 'draft'),
    drugEntry('d3', 'acme', 'reviewed'),
  ];
  const paths = publishedDrugDetailPaths(drugs);
  expect(paths.map((p) => p.params.slug).sort()).toEqual(['d1', 'd3']);
  expect(paths.every((p) => p.props.drug.data.reviewStatus === 'reviewed')).toBe(true);
});

test('P1: /companies/[slug] paths are exactly the published companies WITH >=1 published drug; drafts excluded', () => {
  const companies = [
    companyEntry('acme', 'reviewed'),
    companyEntry('secret', 'draft'),
    companyEntry('globex', 'reviewed'),
  ];
  const drugs = [drugEntry('a1', 'acme', 'reviewed'), drugEntry('g1', 'globex', 'reviewed')];
  const paths = publishedCompanyDetailPaths(companies, drugs);
  expect(paths.map((p) => p.params.slug).sort()).toEqual(['acme', 'globex']);
});

test('a published company with NO published drugs is not routed (no "in preparation" page)', () => {
  const companies = [companyEntry('acme', 'reviewed'), companyEntry('empty', 'reviewed')];
  // `empty` has only a DRAFT drug -> it has no published content -> not routed.
  const drugs = [drugEntry('a1', 'acme', 'reviewed'), drugEntry('e1', 'empty', 'draft')];
  const paths = publishedCompanyDetailPaths(companies, drugs);
  expect(paths.map((p) => p.params.slug)).toEqual(['acme']);
});

// ---------------------------------------------------------------------------
// P1 + P4 — a company page lists only its OWN published drugs, and a published
// company page never surfaces drafts or drugs that reference another company.
// ---------------------------------------------------------------------------

test('P1/P4: a company page lists only its own published drugs', () => {
  const companies = [companyEntry('acme', 'reviewed'), companyEntry('globex', 'reviewed')];
  const drugs = [
    drugEntry('a1', 'acme', 'reviewed'),
    drugEntry('a2', 'acme', 'draft'), // draft -> excluded (P1)
    drugEntry('g1', 'globex', 'reviewed'),
    drugEntry('x1', 'ghost', 'reviewed'), // references a missing company -> attached nowhere (P4)
  ];
  const paths = publishedCompanyDetailPaths(companies, drugs);

  const acme = paths.find((p) => p.params.slug === 'acme');
  const globex = paths.find((p) => p.params.slug === 'globex');
  expect(acme?.props.drugs.map((d) => d.data.slug)).toEqual(['a1']);
  expect(globex?.props.drugs.map((d) => d.data.slug)).toEqual(['g1']);

  // No page ever surfaces the draft or the dangling drug.
  const allListed = paths.flatMap((p) => p.props.drugs.map((d) => d.data.slug));
  expect(allListed).not.toContain('a2');
  expect(allListed).not.toContain('x1');
});

test('P4: a reviewed drug pointing at an UNPUBLISHED company is never listed on a page', () => {
  const companies = [companyEntry('acme', 'reviewed'), companyEntry('secret', 'draft')];
  const drugs = [
    drugEntry('a1', 'acme', 'reviewed'),
    drugEntry('s1', 'secret', 'reviewed'), // company is draft -> not a route, so s1 is unreachable
  ];
  const paths = publishedCompanyDetailPaths(companies, drugs);
  expect(paths.map((p) => p.params.slug)).toEqual(['acme']);
  expect(paths.flatMap((p) => p.props.drugs.map((d) => d.data.slug))).toEqual(['a1']);
});

// ---------------------------------------------------------------------------
// Companies index helpers — stable ordering + "has published drugs" filtering
// (the index lists ONLY companies that have >=1 published drug; there is no
// "in preparation" badge anymore).
// ---------------------------------------------------------------------------

test('sortCompanies orders by `order` then name; entries without order sort last', () => {
  const companies = [
    companyEntry('zeta', 'reviewed', { order: 2 }),
    companyEntry('alpha', 'reviewed', { order: 1 }),
    companyEntry('noorder-b', 'reviewed'),
    companyEntry('noorder-a', 'reviewed'),
    companyEntry('beta', 'reviewed', { order: 1 }),
  ];
  const sorted = sortCompanies(companies).map((c) => c.data.slug);
  // order 1 (alpha, beta by name) -> order 2 (zeta) -> no order (by name).
  expect(sorted).toEqual(['alpha', 'beta', 'zeta', 'noorder-a', 'noorder-b']);
});

test('companiesWithPublishedDrugs only counts published drugs', () => {
  const drugs = [
    drugEntry('a1', 'acme', 'reviewed'),
    drugEntry('g1', 'globex', 'draft'), // draft doesn't count
  ];
  const withDrugs = companiesWithPublishedDrugs(drugs);
  expect(withDrugs.has('acme')).toBe(true);
  expect(withDrugs.has('globex')).toBe(false);
});

// ---------------------------------------------------------------------------
// Property: for arbitrary catalogs, page routes never leak a draft (P1).
// ---------------------------------------------------------------------------

const reviewStatusArb: fc.Arbitrary<ReviewStatus> = fc.constantFrom('draft', 'reviewed');
const companyArb = fc
  .record({ slug: fc.string({ minLength: 1 }), reviewStatus: reviewStatusArb })
  .map(({ slug, reviewStatus }) => companyEntry(slug, reviewStatus));
const drugArb = fc
  .record({
    slug: fc.string({ minLength: 1 }),
    company: fc.string({ minLength: 1 }),
    reviewStatus: reviewStatusArb,
  })
  .map(({ slug, company, reviewStatus }) => drugEntry(slug, company, reviewStatus));

test('P1 (property): routes never leak a draft, and company routes always have >=1 published drug', () => {
  fc.assert(
    fc.property(fc.array(companyArb), fc.array(drugArb), (companies, drugs) => {
      const drugPaths = publishedDrugDetailPaths(drugs);
      expect(drugPaths.length).toBe(publishedOnly(drugs).length);
      expect(drugPaths.every((p) => p.props.drug.data.reviewStatus === 'reviewed')).toBe(true);

      const companyPaths = publishedCompanyDetailPaths(companies, drugs);

      // Only published companies that have >=1 published drug are routed.
      const withDrugs = companiesWithPublishedDrugs(drugs);
      const expectedRouted = publishedOnly(companies).filter((c) => withDrugs.has(c.data.slug));
      expect(companyPaths.length).toBe(expectedRouted.length);

      for (const p of companyPaths) {
        expect(p.props.company.data.reviewStatus).toBe('reviewed'); // P1
        expect(p.props.drugs.length).toBeGreaterThan(0); // routed => has published drugs
        for (const d of p.props.drugs) {
          expect(d.data.reviewStatus).toBe('reviewed'); // P1
          expect(d.data.company).toBe(p.params.slug); // P4 (fixtures model company as slug)
        }
      }
    }),
  );
});
