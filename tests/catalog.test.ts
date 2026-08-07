import { test, expect } from 'vitest';
import fc from 'fast-check';
import {
  publishedOnly,
  buildSearchRecords,
  toCompanyUrl,
  toDrugUrl,
  findDuplicateSlugs,
  checkReferentialIntegrity,
  drugContentInvariants,
  isAuthoritativeAnchor,
  hasScopeViolation,
  sortByPopularity,
  groupByDrugClass,
  classAnchor,
  therapeuticArea,
  groupByTherapeuticArea,
  THERAPEUTIC_AREAS,
  relatedDrugs,
  areaAnchor,
  drugsCountByCompany,
  type CompanyEntry,
  type DrugEntry,
  type DrugData,
  type IndicationGroup,
  type ReviewStatus,
  type TargetType,
  type Media,
  type Citation,
  type Review,
  type SourceType,
} from '../src/lib/catalog';

// ---------------------------------------------------------------------------
// Local arbitraries for companies and drugs.
// ---------------------------------------------------------------------------

const nonEmptyString = fc.string({ minLength: 1 });
const reviewStatusArb: fc.Arbitrary<ReviewStatus> = fc.constantFrom('draft', 'reviewed');
const targetTypeArb: fc.Arbitrary<TargetType> = fc.constantFrom(
  'receptor',
  'enzyme',
  'ion-channel',
  'pathway',
  'protein',
  'other',
);

// Text that never trips the P14 scope red-line (no dosing/usage-advice text).
// Used for the mechanism layers + summary of the "valid drug" arbitrary so a
// randomly-generated reviewed drug always passes P14.
const safeText = nonEmptyString.filter((s) => !hasScopeViolation(s));

const sourceTypeArb: fc.Arbitrary<SourceType> = fc.constantFrom(
  'regulator',
  'label',
  'gov',
  'company',
  'other',
);

// A citation guaranteed to be an authoritative anchor from the registry.
const anchorCitationArb: fc.Arbitrary<Citation> = nonEmptyString.map((title) => ({
  title,
  url: 'https://www.fda.gov/drugs/example',
  sourceId: 'us-fda',
  sourceType: 'regulator' as const,
}));

// Any citation (may or may not be an anchor).
const citationArb: fc.Arbitrary<Citation> = fc.record({
  title: nonEmptyString,
  publisher: fc.option(nonEmptyString, { nil: undefined }),
  url: fc.option(fc.webUrl(), { nil: undefined }),
  sourceType: fc.option(sourceTypeArb, { nil: undefined }),
});

// >=2 independently identified sources including one registry anchor (P13).
const anchoredCitationsArb: fc.Arbitrary<Citation[]> = fc
  .tuple(anchorCitationArb, nonEmptyString, fc.array(citationArb, { maxLength: 1 }))
  .map(([anchor, title, rest]) => [
    anchor,
    { title, url: 'https://dailymed.nlm.nih.gov/dailymed/example', sourceId: 'us-dailymed' },
    ...rest,
  ]);

// High-confidence, in-window auto-review (satisfies P15). `checkedOn` is "now"
// with no `recheckBy`, so the recheck deadline is ~12 months in the future.
const reviewArb: fc.Arbitrary<Review> = fc.record({
  reviewer: fc.constant('auto' as const),
  checkedOn: fc.constant(new Date()),
  confidence: fc.constant('high' as const),
});

const mediaArb: fc.Arbitrary<Media> = fc.record({
  type: fc.constantFrom('image', 'animation', 'placeholder'),
  alt: nonEmptyString,
  src: fc.option(nonEmptyString, { nil: undefined }),
  caption: fc.option(nonEmptyString, { nil: undefined }),
  status: fc.constantFrom('ready', 'in-progress'),
});

// A valid region-grouped indication: a non-empty region, an optional regulator/
// asOf, and at least one non-empty item.
const indicationGroupArb: fc.Arbitrary<IndicationGroup> = fc.record({
  region: nonEmptyString,
  regulator: fc.option(nonEmptyString, { nil: undefined }),
  items: fc.array(nonEmptyString, { minLength: 1, maxLength: 4 }),
  asOf: fc.option(nonEmptyString, { nil: undefined }),
});

// A fully-valid drug: satisfies every content invariant (P2/P3/P5/P7) AND the
// codified review checks (P13/P14/P15), so it is valid whether draft or
// reviewed. It always carries >=2 anchored citations + high-confidence review +
// scope-safe text; media is OPTIONAL (sometimes absent).
const validDrugDataArb: fc.Arbitrary<DrugData> = fc.record({
  slug: nonEmptyString,
  locale: fc.constant('zh' as const),
  company: nonEmptyString,
  genericName: nonEmptyString,
  brandName: fc.option(nonEmptyString, { nil: undefined }),
  drugClass: fc.option(nonEmptyString, { nil: undefined }),
  summary: fc.option(safeText, { nil: undefined }),
  indications: fc.array(indicationGroupArb, { minLength: 1, maxLength: 3 }),
  target: fc.record({ name: nonEmptyString, type: targetTypeArb, role: nonEmptyString }),
  mechanism: fc.record({
    analogy: safeText,
    simple: safeText,
    advanced: safeText,
  }),
  media: fc.option(fc.array(mediaArb, { minLength: 1, maxLength: 3 }), { nil: undefined }),
  citations: anchoredCitationsArb,
  review: reviewArb,
  reviewStatus: reviewStatusArb,
});

const companyEntryArb: fc.Arbitrary<CompanyEntry> = fc
  .record({
    slug: nonEmptyString,
    name: nonEmptyString,
    order: fc.option(fc.integer(), { nil: undefined }),
    reviewStatus: reviewStatusArb,
  })
  .map(({ slug, name, order, reviewStatus }) => ({
    id: slug,
    data: { slug, locale: 'zh' as const, name, order, reviewStatus },
  }));

const drugEntryArb: fc.Arbitrary<DrugEntry> = validDrugDataArb.map((data) => ({
  id: data.slug,
  data,
}));

// ---------------------------------------------------------------------------
// P1 — publish gate.
// ---------------------------------------------------------------------------

test('P1: publishedOnly keeps only reviewed entries and drops every draft', () => {
  fc.assert(
    fc.property(fc.array(companyEntryArb), fc.array(drugEntryArb), (companies, drugs) => {
      const pubCompanies = publishedOnly(companies);
      const pubDrugs = publishedOnly(drugs);

      expect(pubCompanies.every((c) => c.data.reviewStatus === 'reviewed')).toBe(true);
      expect(pubDrugs.every((d) => d.data.reviewStatus === 'reviewed')).toBe(true);

      expect(pubCompanies.length).toBe(
        companies.filter((c) => c.data.reviewStatus === 'reviewed').length,
      );
      expect(pubDrugs.length).toBe(drugs.filter((d) => d.data.reviewStatus === 'reviewed').length);
    }),
  );
});

// ---------------------------------------------------------------------------
// P2 / P3 / P5 / P7 — per-drug content invariants.
// ---------------------------------------------------------------------------

test('P2/P3/P5/P7: a fully-populated drug satisfies every content invariant', () => {
  fc.assert(
    fc.property(validDrugDataArb, (drug) => {
      const result = drugContentInvariants(drug);
      expect(result.valid).toBe(true);
      expect(result.violations).toEqual([]);
    }),
  );
});

test('P3: emptying any mechanism layer makes the drug invalid', () => {
  fc.assert(
    fc.property(validDrugDataArb, fc.constantFrom('analogy', 'simple', 'advanced'), (drug, layer) => {
      const broken: DrugData = { ...drug, mechanism: { ...drug.mechanism, [layer]: '' } };
      const result = drugContentInvariants(broken);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes(`mechanism.${layer}`))).toBe(true);
    }),
  );
});

test('P5: media is optional, but any media entry with an empty alt makes the drug invalid', () => {
  fc.assert(
    fc.property(validDrugDataArb, (drug) => {
      // Media absent is fine (optional).
      const noMedia: DrugData = { ...drug, media: undefined };
      expect(drugContentInvariants(noMedia).valid).toBe(true);

      // Media present but with an empty-alt entry is invalid (P5).
      const broken: DrugData = {
        ...drug,
        media: [...(drug.media ?? []), { type: 'image', alt: '' }],
      };
      const result = drugContentInvariants(broken);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('media.alt'))).toBe(true);
    }),
  );
});

// ---------------------------------------------------------------------------
// P13 / P14 / P15 — codified review checks (published drugs only). These make
// the "review" a deterministic build-time gate rather than a human/AI judgement.
// ---------------------------------------------------------------------------

/** A minimal, fully-valid REVIEWED drug for focused P13/P14/P15 example tests. */
const baseReviewedDrug = (overrides: Partial<DrugData> = {}): DrugData => ({
  slug: 'demo',
  locale: 'zh',
  company: 'acme',
  genericName: 'demo',
  summary: '一种示意药物,用于科普其作用机制。',
  indications: [{ region: '中国', regulator: 'NMPA', items: ['示意适应症'] }],
  target: { name: 't', type: 'protein', role: 'r' },
  mechanism: { analogy: '像一把锁。', simple: '通俗解释。', advanced: '进阶解释。' },
  media: [{ type: 'animation', animationKey: 'btk-inhibitor', alt: '示意动画', status: 'ready' }],
  citations: [
    { title: 'FDA label', url: 'https://www.fda.gov/x', sourceType: 'regulator' },
    { title: 'NCI', url: 'https://www.cancer.gov/y', sourceType: 'gov' },
  ],
  review: { reviewer: 'auto', checkedOn: new Date(), confidence: 'high' },
  reviewStatus: 'reviewed',
  ...overrides,
});

test('P13: authority comes from registry URL; hand-written sourceType cannot grant trust', () => {
  // Legacy sourceType values without a registered HTTPS URL are never anchors.
  expect(isAuthoritativeAnchor({ title: 'x', sourceType: 'regulator' })).toBe(false);
  expect(isAuthoritativeAnchor({ title: 'x', sourceType: 'label' })).toBe(false);
  expect(isAuthoritativeAnchor({ title: 'x', sourceType: 'gov' })).toBe(false);
  expect(isAuthoritativeAnchor({ title: 'x', sourceType: 'company' })).toBe(false);
  expect(isAuthoritativeAnchor({ title: 'x', sourceType: 'other' })).toBe(false);

  // Registry hosts (including www/subdomains) are anchors by URL.
  expect(isAuthoritativeAnchor({ title: 'x', url: 'https://www.fda.gov/a' })).toBe(true);
  expect(isAuthoritativeAnchor({ title: 'x', url: 'https://accessdata.fda.gov/a' })).toBe(true);
  expect(isAuthoritativeAnchor({ title: 'x', url: 'https://dailymed.nlm.nih.gov/a' })).toBe(true);
  expect(isAuthoritativeAnchor({ title: 'x', url: 'https://www.ncbi.nlm.nih.gov/books/x' })).toBe(true);
  expect(isAuthoritativeAnchor({ title: 'x', url: 'https://www.cancer.gov/a' })).toBe(true);
  expect(isAuthoritativeAnchor({ title: 'x', url: 'https://www.nmpa.gov.cn/a' })).toBe(true);
  expect(isAuthoritativeAnchor({ title: 'x', url: 'https://www.tga.gov.au/' })).toBe(true);

  // A declared sourceId must agree with the URL-derived registry entry.
  expect(isAuthoritativeAnchor({ title: 'x', url: 'https://www.fda.gov/a', sourceId: 'eu-ema' })).toBe(false);
  expect(isAuthoritativeAnchor({ title: 'x', url: 'https://www.fda.gov/a', sourceId: 'us-fda' })).toBe(true);

  expect(isAuthoritativeAnchor({ title: 'x', url: 'https://www.nature.com/articles/x' })).toBe(false);
  expect(isAuthoritativeAnchor({ title: 'x', url: 'https://example.com/x' })).toBe(false);
  expect(isAuthoritativeAnchor({ title: 'x', url: 'not a url' })).toBe(false);
  expect(isAuthoritativeAnchor({ title: 'x' })).toBe(false);
});

test('P13: a reviewed drug with 2 sources incl. an anchor passes', () => {
  expect(drugContentInvariants(baseReviewedDrug()).valid).toBe(true);
});

test('P13: fewer than two sources fails', () => {
  const r = drugContentInvariants(
    baseReviewedDrug({ citations: [{ title: 'FDA', sourceType: 'regulator' }] }),
  );
  expect(r.valid).toBe(false);
  expect(r.violations.some((v) => v.includes('P13'))).toBe(true);
});

test('P13: two sources but NO authoritative anchor fails (a company site is not an anchor)', () => {
  const r = drugContentInvariants(
    baseReviewedDrug({
      citations: [
        { title: 'BeiGene 官网', url: 'https://www.beigene.com/x', sourceType: 'company' },
        { title: '某博客', url: 'https://example.com/post' },
      ],
    }),
  );
  expect(r.valid).toBe(false);
  expect(r.violations.some((v) => v.includes('anchor'))).toBe(true);
});

test('P13: a registered host counts as the anchor even without sourceType', () => {
  const r = drugContentInvariants(
    baseReviewedDrug({
      citations: [
        { title: 'DailyMed', url: 'https://dailymed.nlm.nih.gov/x' },
        { title: 'BeiGene 官网', url: 'https://www.beigene.com/x', sourceType: 'company' },
      ],
    }),
  );
  expect(r.valid).toBe(true);
});

test('P14: hasScopeViolation flags dosing and usage-advice text', () => {
  expect(hasScopeViolation('每日100mg')).toBe(true);
  expect(hasScopeViolation('每次 2 片')).toBe(true);
  expect(hasScopeViolation('推荐剂量为两片')).toBe(true);
  expect(hasScopeViolation('用法用量:口服')).toBe(true);
  expect(hasScopeViolation('建议服用一片')).toBe(true);
  expect(hasScopeViolation('recommended dose is one tablet')).toBe(true);
  expect(hasScopeViolation('take 2 tablets')).toBe(true);
  expect(hasScopeViolation('剂量 500 mg/kg')).toBe(true);
});

test('P14: hasScopeViolation does NOT false-positive on PD-L1≥1 / ≥1 线 / Cys481 / IgG4', () => {
  expect(hasScopeViolation('PD-L1≥1')).toBe(false);
  expect(hasScopeViolation('≥1 线既往治疗')).toBe(false);
  expect(hasScopeViolation('共价结合 Cys481 残基')).toBe(false);
  expect(hasScopeViolation('人源化 IgG4 抗 PD-1 单克隆抗体')).toBe(false);
  expect(hasScopeViolation('阻断 PD-L1/PD-L2 相互作用')).toBe(false);
  expect(hasScopeViolation('高微卫星不稳定性(MSI-H / dMMR)实体瘤')).toBe(false);
  expect(hasScopeViolation('经 LYN/SYK 激活 BTK,进而激活 PLCγ2')).toBe(false);
});

test('P14: a reviewed drug whose mechanism contains dosing text fails; a clean one passes', () => {
  const bad = drugContentInvariants(
    baseReviewedDrug({
      mechanism: { analogy: '正常比喻', simple: '每日100mg 口服', advanced: '进阶解释' },
    }),
  );
  expect(bad.valid).toBe(false);
  expect(bad.violations.some((v) => v.includes('P14'))).toBe(true);
  expect(bad.violations.some((v) => v.includes('mechanism.simple'))).toBe(true);

  const good = drugContentInvariants(
    baseReviewedDrug({
      mechanism: { analogy: '像给开关上锁', simple: '阻断增殖信号', advanced: '共价结合 Cys481' },
    }),
  );
  expect(good.valid).toBe(true);
});

test('P15: a reviewed drug without review metadata fails', () => {
  const r = drugContentInvariants(baseReviewedDrug({ review: undefined }));
  expect(r.valid).toBe(false);
  expect(r.violations.some((v) => v.includes('P15'))).toBe(true);
});

test('P15: a reviewed drug with non-high confidence fails', () => {
  const r = drugContentInvariants(
    baseReviewedDrug({ review: { reviewer: 'auto', checkedOn: new Date(), confidence: 'medium' } }),
  );
  expect(r.valid).toBe(false);
  expect(r.violations.some((v) => v.includes('confidence'))).toBe(true);
});

test('P15: a reviewed drug past its recheck deadline fails; an explicit future recheckBy keeps it valid', () => {
  const today = new Date('2026-08-04T00:00:00Z');

  // Old checkedOn, no recheckBy -> deadline = checkedOn + 12 months < today.
  const overdue = drugContentInvariants(
    baseReviewedDrug({
      review: { reviewer: 'auto', checkedOn: new Date('2024-01-01T00:00:00Z'), confidence: 'high' },
    }),
    today,
  );
  expect(overdue.valid).toBe(false);
  expect(overdue.violations.some((v) => v.includes('overdue'))).toBe(true);

  // An explicit future recheckBy keeps it valid even with an old checkedOn.
  const future = drugContentInvariants(
    baseReviewedDrug({
      review: {
        reviewer: 'auto',
        checkedOn: new Date('2024-01-01T00:00:00Z'),
        confidence: 'high',
        recheckBy: new Date('2099-01-01T00:00:00Z'),
      },
    }),
    today,
  );
  expect(future.valid).toBe(true);
});

test('P13/P14/P15: draft drugs are exempt (only reviewed drugs are gated)', () => {
  const draft = drugContentInvariants(
    baseReviewedDrug({
      reviewStatus: 'draft',
      citations: [], // <2 sources
      review: undefined, // no review metadata
      summary: '每日100mg', // dosing text
    }),
  );
  expect(draft.valid).toBe(true);
});

test('P7: valid region-grouped indications pass the content invariant', () => {
  fc.assert(
    fc.property(validDrugDataArb, fc.array(indicationGroupArb, { minLength: 1, maxLength: 4 }), (drug, groups) => {
      const ok: DrugData = { ...drug, indications: groups };
      const result = drugContentInvariants(ok);
      // No indication-related violation for a well-formed grouped list.
      expect(result.violations.some((v) => v.includes('indications'))).toBe(false);
    }),
  );
});

test('P7: a drug with zero region groups is invalid', () => {
  fc.assert(
    fc.property(validDrugDataArb, (drug) => {
      const broken: DrugData = { ...drug, indications: [] };
      const result = drugContentInvariants(broken);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('indication'))).toBe(true);
    }),
  );
});

test('P7: a region group with an empty region is invalid', () => {
  fc.assert(
    fc.property(validDrugDataArb, indicationGroupArb, (drug, group) => {
      const broken: DrugData = { ...drug, indications: [{ ...group, region: '' }] };
      const result = drugContentInvariants(broken);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('region'))).toBe(true);
    }),
  );
});

test('P7: a region group with zero items is invalid', () => {
  fc.assert(
    fc.property(validDrugDataArb, indicationGroupArb, (drug, group) => {
      const broken: DrugData = { ...drug, indications: [{ ...group, items: [] }] };
      const result = drugContentInvariants(broken);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('items'))).toBe(true);
    }),
  );
});

test('P7: a region group with an empty item value is invalid', () => {
  fc.assert(
    fc.property(validDrugDataArb, indicationGroupArb, (drug, group) => {
      const broken: DrugData = { ...drug, indications: [{ ...group, items: [...group.items, ''] }] };
      const result = drugContentInvariants(broken);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('items'))).toBe(true);
    }),
  );
});

test('P7: a drug missing target.name or target.type is invalid', () => {
  fc.assert(
    fc.property(validDrugDataArb, fc.constantFrom('name', 'type'), (drug, field) => {
      const broken: DrugData = { ...drug, target: { ...drug.target, [field]: '' } };
      const result = drugContentInvariants(broken);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes(`target.${field}`))).toBe(true);
    }),
  );
});

test('P2: a reviewed drug needs a citation; a draft with none is still invariant-valid', () => {
  fc.assert(
    fc.property(validDrugDataArb, (drug) => {
      const reviewedNoCite: DrugData = { ...drug, reviewStatus: 'reviewed', citations: [] };
      const reviewedResult = drugContentInvariants(reviewedNoCite);
      expect(reviewedResult.valid).toBe(false);
      expect(reviewedResult.violations.some((v) => v.includes('citation'))).toBe(true);

      // Citations are only required once reviewed, so a draft with no citations
      // still satisfies the content invariants.
      const draftNoCite: DrugData = { ...drug, reviewStatus: 'draft', citations: [] };
      expect(drugContentInvariants(draftNoCite).valid).toBe(true);
    }),
  );
});

// ---------------------------------------------------------------------------
// P4 — referential integrity (refined, aligned with the design):
//   Rule 1: EVERY drug (draft or reviewed) must reference an EXISTING company.
//   Rule 2: ADDITIONALLY, a PUBLISHED (reviewed) drug's company must ALSO be
//           published.
//   => A DRAFT drug referencing an existing but unpublished company is sound and
//      must NOT be flagged.
// ---------------------------------------------------------------------------

/** Minimal company entry for focused, example-based P4 tests. */
const companyEntry = (slug: string, reviewStatus: ReviewStatus): CompanyEntry => ({
  id: slug,
  data: { slug, locale: 'zh', name: slug, reviewStatus },
});

/** Minimal (schema-complete) drug entry for focused, example-based P4 tests. */
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

test('P4: checkReferentialIntegrity flags exactly the drugs that break rule 1 or rule 2', () => {
  const scenarioArb = fc
    .uniqueArray(companyEntryArb, { selector: (e) => e.data.slug, maxLength: 6 })
    .chain((companies) => {
      const slugs = companies.map((c) => c.data.slug);
      // A drug's company is either an existing company slug (draft or reviewed
      // company) or a (likely missing) random slug.
      const companyRefArb =
        slugs.length > 0 ? fc.oneof(fc.constantFrom(...slugs), nonEmptyString) : nonEmptyString;

      const drugArb: fc.Arbitrary<DrugEntry> = fc
        .record({ base: validDrugDataArb, company: companyRefArb })
        .map(({ base, company }) => ({ id: base.slug, data: { ...base, company } }));

      return fc.record({
        companies: fc.constant(companies),
        drugs: fc.uniqueArray(drugArb, { selector: (e) => e.data.slug, maxLength: 8 }),
      });
    });

  fc.assert(
    fc.property(scenarioArb, ({ companies, drugs }) => {
      const flagged = checkReferentialIntegrity(companies, drugs);
      const allCompanySlugs = new Set(companies.map((c) => c.data.slug));
      const publishedCompanySlugs = new Set(publishedOnly(companies).map((c) => c.data.slug));

      const expected = drugs.filter((d) => {
        const ref = d.data.company as string;
        if (!allCompanySlugs.has(ref)) return true; // Rule 1: missing company (any status).
        if (d.data.reviewStatus === 'reviewed') return !publishedCompanySlugs.has(ref); // Rule 2.
        return false; // Draft referencing an existing company is sound.
      });

      expect(new Set(flagged.map((d) => d.data.slug))).toEqual(
        new Set(expected.map((d) => d.data.slug)),
      );
      expect(flagged.length).toBe(expected.length);

      // No sound drug is flagged: a draft drug pointing at an existing company
      // (draft or published) must never appear.
      const flaggedSlugs = new Set(flagged.map((d) => d.data.slug));
      for (const d of drugs) {
        const ref = d.data.company as string;
        if (allCompanySlugs.has(ref) && d.data.reviewStatus === 'draft') {
          expect(flaggedSlugs.has(d.data.slug)).toBe(false);
        }
      }
    }),
  );
});

test('P4: a DRAFT drug referencing an existing but UNPUBLISHED company is NOT flagged', () => {
  const companies = [companyEntry('acme', 'draft')];
  const drugs = [drugEntry('d1', 'acme', 'draft')];
  expect(checkReferentialIntegrity(companies, drugs)).toEqual([]);
});

test('P4: a PUBLISHED drug referencing an existing but UNPUBLISHED company IS flagged', () => {
  const companies = [companyEntry('acme', 'draft')];
  const drugs = [drugEntry('d1', 'acme', 'reviewed')];
  expect(checkReferentialIntegrity(companies, drugs).map((d) => d.data.slug)).toEqual(['d1']);
});

test('P4: any drug (draft or reviewed) referencing a MISSING company IS flagged', () => {
  const companies: CompanyEntry[] = [];
  const drugs = [drugEntry('d1', 'ghost', 'draft'), drugEntry('d2', 'ghost', 'reviewed')];
  expect(new Set(checkReferentialIntegrity(companies, drugs).map((d) => d.data.slug))).toEqual(
    new Set(['d1', 'd2']),
  );
});

test('P4: a PUBLISHED drug referencing a PUBLISHED company is sound (not flagged)', () => {
  const companies = [companyEntry('acme', 'reviewed')];
  const drugs = [drugEntry('d1', 'acme', 'reviewed')];
  expect(checkReferentialIntegrity(companies, drugs)).toEqual([]);
});

// ---------------------------------------------------------------------------
// P8 — search coverage.
// ---------------------------------------------------------------------------

test('P8: buildSearchRecords covers exactly the published companies + drugs and no drafts', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(companyEntryArb, { selector: (e) => e.data.slug, maxLength: 6 }),
      fc.uniqueArray(drugEntryArb, { selector: (e) => e.data.slug, maxLength: 6 }),
      (companies, drugs) => {
        const records = buildSearchRecords(companies, drugs);
        const pubCompanies = publishedOnly(companies);
        const pubDrugs = publishedOnly(drugs);

        // Exactly one record per published entry.
        expect(records.length).toBe(pubCompanies.length + pubDrugs.length);

        const companyRecordSlugs = new Set(
          records.filter((r) => r.type === 'company').map((r) => r.slug),
        );
        const drugRecordSlugs = new Set(records.filter((r) => r.type === 'drug').map((r) => r.slug));
        expect(companyRecordSlugs).toEqual(new Set(pubCompanies.map((c) => c.data.slug)));
        expect(drugRecordSlugs).toEqual(new Set(pubDrugs.map((d) => d.data.slug)));

        // No draft slug ever appears in the index.
        const draftCompanySlugs = new Set(
          companies.filter((c) => c.data.reviewStatus === 'draft').map((c) => c.data.slug),
        );
        const draftDrugSlugs = new Set(
          drugs.filter((d) => d.data.reviewStatus === 'draft').map((d) => d.data.slug),
        );
        for (const r of records) {
          if (r.type === 'company') expect(draftCompanySlugs.has(r.slug)).toBe(false);
          else expect(draftDrugSlugs.has(r.slug)).toBe(false);
        }

        // Records carry the expected search fields and stable URLs.
        for (const r of records) {
          expect(typeof r.title).toBe('string');
          expect(typeof r.name).toBe('string');
          if (r.type === 'drug') {
            expect(r.url).toBe(toDrugUrl(r.slug));
            expect(typeof r.genericName).toBe('string');
            expect(Array.isArray(r.indications)).toBe(true);
          } else {
            expect(r.url).toBe(toCompanyUrl(r.slug));
          }
        }
      },
    ),
  );
});

test('P8: a drug search record flattens every region group item into one list', () => {
  fc.assert(
    fc.property(
      validDrugDataArb.map(
        (data): DrugEntry => ({ id: data.slug, data: { ...data, reviewStatus: 'reviewed' } }),
      ),
      (drug) => {
        const records = buildSearchRecords([], [drug]);
        expect(records.length).toBe(1);
        const record = records[0];
        expect(record.type).toBe('drug');
        if (record.type !== 'drug') return;

        const expected = drug.data.indications.flatMap((group) => group.items);
        // Same items, same order, fully flattened (no nested region objects leak).
        expect(record.indications).toEqual(expected);
        expect(record.indications.every((i) => typeof i === 'string')).toBe(true);
      },
    ),
  );
});

test('P8: flattening preserves items from a known multi-region drug', () => {
  const drug: DrugEntry = {
    id: 'demo',
    data: {
      slug: 'demo',
      locale: 'zh',
      company: 'acme',
      genericName: 'demo',
      indications: [
        { region: '美国', regulator: 'FDA', items: ['A1', 'A2'], asOf: '2025' },
        { region: '中国', regulator: 'NMPA', items: ['B1'] },
      ],
      target: { name: 't', type: 'protein', role: 'r' },
      mechanism: { analogy: 'a', simple: 's', advanced: 'adv' },
      media: [{ type: 'placeholder', alt: 'alt' }],
      citations: [{ title: 'c' }],
      reviewStatus: 'reviewed',
    },
  };
  const [record] = buildSearchRecords([], [drug]);
  expect(record.type).toBe('drug');
  if (record.type === 'drug') {
    expect(record.indications).toEqual(['A1', 'A2', 'B1']);
  }
});

// ---------------------------------------------------------------------------
// P10 — slug uniqueness + stable URLs.
// ---------------------------------------------------------------------------

test('P10: findDuplicateSlugs returns none for a set of unique slugs', () => {
  fc.assert(
    fc.property(fc.uniqueArray(nonEmptyString, { maxLength: 20 }), (slugs) => {
      const items = slugs.map((slug) => ({ id: slug, data: { slug } }));
      expect(findDuplicateSlugs(items)).toEqual([]);
    }),
  );
});

test('P10: findDuplicateSlugs detects an injected duplicate (and only it)', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(nonEmptyString, { minLength: 1, maxLength: 20 }),
      fc.nat(),
      (slugs, idx) => {
        const dup = slugs[idx % slugs.length];
        const items = [...slugs, dup].map((slug) => ({ id: slug, data: { slug } }));
        const duplicates = findDuplicateSlugs(items);
        expect(duplicates).toContain(dup);
        expect(new Set(duplicates)).toEqual(new Set([dup]));
      },
    ),
  );
});

test('P10: URL builders are deterministic and embed the slug', () => {
  fc.assert(
    fc.property(nonEmptyString, (slug) => {
      expect(toCompanyUrl(slug)).toBe(`/companies/${slug}/`);
      expect(toDrugUrl(slug)).toBe(`/drugs/${slug}/`);
      // Stable across calls.
      expect(toCompanyUrl(slug)).toBe(toCompanyUrl(slug));
      expect(toDrugUrl(slug)).toBe(toDrugUrl(slug));
    }),
  );
});

// ---------------------------------------------------------------------------
// sortByPopularity + groupByDrugClass — homepage / drugs-index ordering helpers.
// ---------------------------------------------------------------------------

/** Minimal published-by-default drug entry with controllable popularity/class. */
const popDrug = (
  slug: string,
  opts: {
    popularity?: number;
    drugClass?: string;
    genericName?: string;
    reviewStatus?: ReviewStatus;
  } = {},
): DrugEntry => ({
  id: slug,
  data: {
    slug,
    locale: 'zh',
    company: 'acme',
    genericName: opts.genericName ?? slug,
    drugClass: opts.drugClass,
    popularity: opts.popularity,
    indications: [{ region: 'CN', regulator: 'NMPA', items: ['x'] }],
    target: { name: 't', type: 'protein', role: 'r' },
    mechanism: { analogy: 'a', simple: 's', advanced: 'adv' },
    citations: [],
    reviewStatus: opts.reviewStatus ?? 'reviewed',
  },
});

/** Arbitrary drug entry carrying an optional popularity + drugClass (for PBT). */
const popDrugArb: fc.Arbitrary<DrugEntry> = fc
  .record({
    slug: nonEmptyString,
    genericName: nonEmptyString,
    drugClass: fc.option(fc.constantFrom('PD-1', 'BTK', 'other'), { nil: undefined }),
    popularity: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
    reviewStatus: reviewStatusArb,
  })
  .map(({ slug, genericName, drugClass, popularity, reviewStatus }) => ({
    id: slug,
    data: {
      slug,
      locale: 'zh' as const,
      company: 'acme',
      genericName,
      drugClass,
      popularity,
      indications: [{ region: 'CN', regulator: 'NMPA', items: ['x'] }],
      target: { name: 't', type: 'protein' as const, role: 'r' },
      mechanism: { analogy: 'a', simple: 's', advanced: 'adv' },
      citations: [],
      reviewStatus,
    },
  }));

test('sortByPopularity: published-only, popularity desc, undefined last, ties by genericName', () => {
  const drugs = [
    popDrug('mid', { popularity: 50, genericName: 'mid' }),
    popDrug('top2', { popularity: 100, genericName: 'zeta' }),
    popDrug('none1', { genericName: 'alpha' }), // no popularity -> sorts last
    popDrug('top1', { popularity: 100, genericName: 'beta' }), // ties at 100
    popDrug('none2', { genericName: 'gamma' }), // no popularity -> sorts last
    popDrug('draftTop', { popularity: 999, reviewStatus: 'draft' }), // excluded (P1)
  ];
  const sorted = sortByPopularity(drugs);

  // The draft never appears, even though it has the highest popularity.
  expect(sorted.map((d) => d.data.slug)).not.toContain('draftTop');
  // Popularity tiers descending, with undefined last.
  expect(sorted.map((d) => d.data.popularity)).toEqual([100, 100, 50, undefined, undefined]);
  // The 100-tie is broken by genericName ascending (beta before zeta).
  expect(sorted.slice(0, 2).map((d) => d.data.slug)).toEqual(['top1', 'top2']);
  // The undefined-tie is broken by genericName ascending (alpha before gamma).
  expect(sorted.slice(3).map((d) => d.data.slug)).toEqual(['none1', 'none2']);
});

test('sortByPopularity does not mutate its input', () => {
  const drugs = [popDrug('a', { popularity: 1 }), popDrug('b', { popularity: 2 })];
  const before = drugs.map((d) => d.data.slug);
  sortByPopularity(drugs);
  expect(drugs.map((d) => d.data.slug)).toEqual(before);
});

test('sortByPopularity (property): published-only; popularity non-increasing with undefined last', () => {
  fc.assert(
    fc.property(fc.array(popDrugArb), (drugs) => {
      const sorted = sortByPopularity(drugs);
      expect(sorted.length).toBe(publishedOnly(drugs).length);
      expect(sorted.every((d) => d.data.reviewStatus === 'reviewed')).toBe(true);

      let seenUndefined = false;
      let prev = Infinity;
      for (const d of sorted) {
        const p = d.data.popularity;
        if (p === undefined) {
          seenUndefined = true;
          continue;
        }
        // A defined popularity must never follow an undefined one.
        expect(seenUndefined).toBe(false);
        // Non-increasing among defined popularities.
        expect(p).toBeLessThanOrEqual(prev);
        prev = p;
      }
    }),
  );
});

test('groupByDrugClass: published-only, grouped by class, most-prominent class first', () => {
  const drugs = [
    popDrug('p1', { drugClass: 'PD-1', popularity: 100, genericName: 'p1' }),
    popDrug('b1', { drugClass: 'BTK', popularity: 75, genericName: 'b1' }),
    popDrug('p2', { drugClass: 'PD-1', popularity: 40, genericName: 'p2' }),
    popDrug('b2', { drugClass: 'BTK', popularity: 55, genericName: 'b2' }),
    popDrug('draftPd', { drugClass: 'PD-1', popularity: 999, reviewStatus: 'draft' }), // excluded
  ];
  const groups = groupByDrugClass(drugs);

  // Two classes; PD-1 leads because its top drug (100) outranks BTK's (75).
  expect(groups.map((g) => g.drugClass)).toEqual(['PD-1', 'BTK']);

  const pd1 = groups.find((g) => g.drugClass === 'PD-1');
  const btk = groups.find((g) => g.drugClass === 'BTK');
  // Correct grouping; within each group ordered by popularity desc.
  expect(pd1?.drugs.map((d) => d.data.slug)).toEqual(['p1', 'p2']);
  expect(btk?.drugs.map((d) => d.data.slug)).toEqual(['b1', 'b2']);

  // No draft leaks into any group; exactly the published drugs are covered.
  const allSlugs = groups.flatMap((g) => g.drugs.map((d) => d.data.slug));
  expect(allSlugs).not.toContain('draftPd');
  expect([...allSlugs].sort()).toEqual(['b1', 'b2', 'p1', 'p2']);
});

test('groupByDrugClass returns [] for empty or all-draft input', () => {
  expect(groupByDrugClass([])).toEqual([]);
  expect(groupByDrugClass([popDrug('d', { drugClass: 'X', reviewStatus: 'draft' })])).toEqual([]);
});

test('groupByDrugClass (property): covers exactly the published drugs and groups them correctly', () => {
  fc.assert(
    fc.property(fc.array(popDrugArb), (drugs) => {
      const groups = groupByDrugClass(drugs);
      const grouped = groups.flatMap((g) => g.drugs);

      // Every grouped drug is published; count matches publishedOnly.
      expect(grouped.every((d) => d.data.reviewStatus === 'reviewed')).toBe(true);
      expect(grouped.length).toBe(publishedOnly(drugs).length);

      // Group keys are distinct and every drug sits under its own drugClass (?? '').
      const keys = groups.map((g) => g.drugClass);
      expect(new Set(keys).size).toBe(keys.length);
      for (const g of groups) {
        expect(g.drugs.every((d) => (d.data.drugClass ?? '') === g.drugClass)).toBe(true);
      }
    }),
  );
});

// ---------------------------------------------------------------------------
// classAnchor / therapeuticArea / groupByTherapeuticArea — homepage browse UX.
// ---------------------------------------------------------------------------

test('classAnchor: safe, non-empty, prefixed, deterministic id; distinct near-duplicates differ', () => {
  const a = classAnchor('抗 PD-1 单克隆抗体(免疫检查点抑制剂)');
  expect(a).toBe(classAnchor('抗 PD-1 单克隆抗体(免疫检查点抑制剂)'));
  expect(a.startsWith('class-')).toBe(true);
  expect(/\s/.test(a)).toBe(false);
  expect(classAnchor('')).toBe('class-');
  expect(classAnchor('———')).toBe('class-');
  expect(classAnchor('抗 PD-L1 单克隆抗体')).not.toBe(classAnchor('抗 PD-L1 单克隆抗体(免疫检查点抑制剂)'));
});

test('classAnchor (property): class- prefix, no whitespace, no leading/trailing dash in body', () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      const anchor = classAnchor(s);
      expect(anchor.startsWith('class-')).toBe(true);
      const body = anchor.slice('class-'.length);
      expect(/\s/.test(body)).toBe(false);
      if (body.length > 0) {
        expect(body.startsWith('-')).toBe(false);
        expect(body.endsWith('-')).toBe(false);
      }
    }),
  );
});

test('therapeuticArea: representative classes map to the expected area; unknown -> 其他', () => {
  expect(therapeuticArea('抗 PD-1 单克隆抗体(免疫检查点抑制剂)')).toBe('肿瘤(抗癌)');
  expect(therapeuticArea('BTK 抑制剂')).toBe('肿瘤(抗癌)');
  expect(therapeuticArea('TNF-α 抑制剂(全人源单克隆抗体)')).toBe('免疫与炎症');
  expect(therapeuticArea('GLP-1 受体激动剂')).toBe('代谢与内分泌');
  expect(therapeuticArea('他汀类(HMG-CoA 还原酶抑制剂)')).toBe('心血管与血液');
  expect(therapeuticArea('第二代头孢菌素(β-内酰胺类抗生素)')).toBe('抗感染与疫苗');
  expect(therapeuticArea('mRNA 疫苗')).toBe('抗感染与疫苗');
  expect(therapeuticArea('非典型抗精神病药(多巴胺 D2 部分激动剂)')).toBe('神经与精神');
  expect(therapeuticArea('短效 β2 受体激动剂(SABA,支气管扩张剂)')).toBe('呼吸与过敏');
  expect(therapeuticArea('前列腺素类似物(眼用降眼压药)')).toBe('眼科');
  expect(therapeuticArea('CFTR 调节剂(校正剂+增效剂)')).toBe('其他(罕见病、皮肤等)');
  expect(therapeuticArea('某种全新未知机制')).toBe('其他(罕见病、皮肤等)');
});

test('therapeuticArea (property): always returns one of the known areas', () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      expect(THERAPEUTIC_AREAS).toContain(therapeuticArea(s));
    }),
  );
});

test('groupByTherapeuticArea: areas in canonical order; published-only; drugCount matches', () => {
  const drugs = [
    popDrug('p1', { drugClass: '抗 PD-1 单克隆抗体(免疫检查点抑制剂)', popularity: 100 }),
    popDrug('s1', { drugClass: '他汀类(HMG-CoA 还原酶抑制剂)', popularity: 90 }),
    popDrug('s2', { drugClass: '他汀类(HMG-CoA 还原酶抑制剂)', popularity: 80 }),
    popDrug('g1', { drugClass: 'GLP-1 受体激动剂', popularity: 70 }),
    popDrug('draft', { drugClass: '抗 PD-1 单克隆抗体(免疫检查点抑制剂)', reviewStatus: 'draft' }),
  ];
  const areas = groupByTherapeuticArea(drugs);
  expect(areas.map((a) => a.area)).toEqual(['肿瘤(抗癌)', '代谢与内分泌', '心血管与血液']);
  const cardio = areas.find((a) => a.area === '心血管与血液');
  expect(cardio?.drugCount).toBe(2);
  expect(cardio?.classes[0].drugs.length).toBe(2);
  const allSlugs = areas.flatMap((a) => a.classes.flatMap((c) => c.drugs.map((d) => d.data.slug)));
  expect(allSlugs).not.toContain('draft');
});

// ---------------------------------------------------------------------------
// areaAnchor / relatedDrugs / drugsCountByCompany — UX helpers.
// ---------------------------------------------------------------------------

test('areaAnchor: area- prefixed, whitespace-free, deterministic', () => {
  expect(areaAnchor('肿瘤(抗癌)')).toBe(areaAnchor('肿瘤(抗癌)'));
  expect(areaAnchor('肿瘤(抗癌)').startsWith('area-')).toBe(true);
  expect(/\s/.test(areaAnchor('心血管与血液'))).toBe(false);
});

test('relatedDrugs: same class first, excludes self + drafts, capped', () => {
  const drugs = [
    popDrug('a', { drugClass: 'PD-1', popularity: 100 }),
    popDrug('b', { drugClass: 'PD-1', popularity: 90 }),
    popDrug('c', { drugClass: 'PD-1', popularity: 80, reviewStatus: 'draft' }),
    popDrug('x', { drugClass: 'BTK', popularity: 70 }),
  ];
  expect(relatedDrugs(drugs, 'a').map((d) => d.data.slug)).toEqual(['b']);
});

test('relatedDrugs: falls back to same therapeutic area for a singleton class', () => {
  const drugs = [
    popDrug('pd1', { drugClass: '抗 PD-1 单克隆抗体(免疫检查点抑制剂)', popularity: 100 }),
    popDrug('btk', { drugClass: 'BTK 抑制剂', popularity: 90 }),
    popDrug('statin', { drugClass: '他汀类(HMG-CoA 还原酶抑制剂)', popularity: 80 }),
  ];
  expect(relatedDrugs(drugs, 'pd1').map((d) => d.data.slug)).toEqual(['btk']);
});

test('relatedDrugs: unknown slug yields empty', () => {
  expect(relatedDrugs([popDrug('a', { drugClass: 'X' })], 'nope')).toEqual([]);
});

test('drugsCountByCompany: counts only published drugs per company', () => {
  const drugs = [popDrug('a', {}), popDrug('b', {}), popDrug('c', { reviewStatus: 'draft' })];
  expect(drugsCountByCompany(drugs).get('acme')).toBe(2);
});
