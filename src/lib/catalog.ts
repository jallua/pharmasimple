// site/src/lib/catalog.ts
//
// Pure, framework-agnostic catalog helpers.
//
// These functions intentionally do NOT import `astro:content`. They operate on
// plain "entry-like" objects of the shape { id?/slug?, data: {...} } so they can
// be unit-tested with fast-check without booting Astro. At runtime the Astro
// pages pass real `CollectionEntry` objects (which share this shape) straight
// into these helpers.
//
// The invariants encoded here mirror the correctness properties P1-P10 in the
// design document.

// ---------------------------------------------------------------------------
// Types — standalone mirrors of the content schema in `content.config.ts`.
// ---------------------------------------------------------------------------

export type ReviewStatus = 'draft' | 'reviewed';

export type TargetType =
  | 'receptor'
  | 'enzyme'
  | 'ion-channel'
  | 'pathway'
  | 'protein'
  | 'other';

/**
 * Classifies a citation's provenance. `regulator` (e.g. FDA/NMPA/EMA),
 * `label` (official prescribing information such as DailyMed) and `gov`
 * (government / authoritative body such as NCI/NCBI) are authoritative
 * "anchors" (P13). `company` (a drug maker's official site) counts toward the
 * required source total but is NOT an anchor. `other` only counts toward the
 * total. Peer-reviewed journals are intentionally NOT an authoritative source.
 */
export type SourceType = 'regulator' | 'label' | 'gov' | 'company' | 'other';

export interface Citation {
  title: string;
  publisher?: string;
  url?: string;
  retrievedDate?: Date | string;
  sourceType?: SourceType;
}

export type Confidence = 'high' | 'medium' | 'low';

/**
 * Auto-review metadata (P15 / 需求 8.7). Recorded on a published drug so the
 * build can verify it was code-reviewed with high confidence and is still within
 * its recheck window.
 */
export interface Review {
  reviewer?: 'auto';
  checkedOn: Date | string;
  confidence: Confidence;
  recheckBy?: Date | string;
}

export interface Media {
  type: 'image' | 'animation' | 'placeholder';
  src?: string;
  animationKey?: string;
  alt: string;
  caption?: string;
  status?: 'ready' | 'in-progress';
}

export interface Target {
  name: string;
  type: TargetType;
  role: string;
}

/**
 * A region-scoped group of indications. The same drug is approved for different
 * indications in different regulatory regions, so indications are grouped by
 * `region` (e.g. "中国") with an optional `regulator` (e.g. "NMPA") and an
 * optional `asOf` reference date. `items` holds that region's approved
 * indications (at least one, each non-empty). Mirrors the `indications` shape in
 * `content.config.ts`.
 */
export interface IndicationGroup {
  region: string;
  regulator?: string;
  items: string[];
  asOf?: string;
}

export interface Mechanism {
  analogy: string;
  simple: string;
  advanced: string;
}

export interface CompanyData {
  slug: string;
  locale: 'zh';
  name: string;
  logo?: string;
  country?: string;
  summary?: string;
  order?: number;
  reviewStatus: ReviewStatus;
}

export interface DrugData {
  slug: string;
  locale: 'zh';
  /**
   * Reference to a company. In these pure helpers it is treated as the company
   * slug/id. Real Astro entries model `reference('companies')` as
   * `{ collection, id }`; `companyRef()` normalizes both shapes.
   */
  company: string | { collection?: string; id?: string; slug?: string };
  genericName: string;
  brandName?: string;
  drugClass?: string;
  /** Homepage prominence weight (higher = more prominent); optional (需求 1/9). */
  popularity?: number;
  summary?: string;
  /** Indications grouped by regulatory region (see {@link IndicationGroup}). */
  indications: IndicationGroup[];
  target: Target;
  mechanism: Mechanism;
  /** Figures/animations are optional: a drug with no ready media shows none. */
  media?: Media[];
  citations: Citation[];
  /** Auto-review metadata; required (and high-confidence) once published (P15). */
  review?: Review;
  reviewStatus: ReviewStatus;
  updatedDate?: Date | string;
}

/** Minimal shape shared by Astro's `CollectionEntry` objects. */
export interface Entry<T> {
  id?: string;
  slug?: string;
  data: T;
}

export type CompanyEntry = Entry<CompanyData>;
export type DrugEntry = Entry<DrugData>;

// ---------------------------------------------------------------------------
// Search records
// ---------------------------------------------------------------------------

export interface CompanySearchRecord {
  type: 'company';
  title: string;
  name: string;
  slug: string;
  url: string;
}

export interface DrugSearchRecord {
  type: 'drug';
  title: string;
  name: string;
  slug: string;
  url: string;
  genericName: string;
  brandName?: string;
  drugClass?: string;
  /** Flattened list of every indication item across all regions (P8): search
   * still matches indication terms regardless of the region grouping. */
  indications: string[];
}

export type SearchRecord = CompanySearchRecord | DrugSearchRecord;

// ---------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------

/** True when a value is a string with at least one character (mirrors zod `.min(1)`). */
const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Canonical identifier for an entry. Prefers the explicit `data.slug` field
 * (which the schema requires), then falls back to the Astro entry `id`/`slug`.
 */
const entrySlug = (entry: {
  id?: string;
  slug?: string;
  data?: { slug?: string };
}): string => entry.data?.slug ?? entry.slug ?? entry.id ?? '';

/** Normalize a drug's `company` reference (string or `{ id/slug }`) to a slug string. */
const companyRef = (drug: DrugEntry): string => {
  const c: unknown = drug.data.company;
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object') {
    const obj = c as { id?: string; slug?: string };
    return obj.id ?? obj.slug ?? '';
  }
  return '';
};

// ---------------------------------------------------------------------------
// Public pure functions
// ---------------------------------------------------------------------------

/**
 * P1 — publish gate. Keep only reviewed entries; drafts never leak out.
 * Generic so it works for both companies and drugs (any reviewable entry).
 */
export const publishedOnly = <T extends { data: { reviewStatus: ReviewStatus } }>(
  items: T[],
): T[] => items.filter((item) => item.data.reviewStatus === 'reviewed');

/** Stable URL for a company detail page. */
export const toCompanyUrl = (slug: string): string => `/companies/${slug}`;

/** Stable URL for a drug mechanism page. */
export const toDrugUrl = (slug: string): string => `/drugs/${slug}`;

/**
 * P8 — search coverage. Build the search-index records from the published
 * companies and drugs only (drafts are excluded via `publishedOnly`).
 */
export function buildSearchRecords(
  companies: CompanyEntry[],
  drugs: DrugEntry[],
): SearchRecord[] {
  const companyRecords: SearchRecord[] = publishedOnly(companies).map((c) => {
    const slug = entrySlug(c);
    return {
      type: 'company',
      title: c.data.name,
      name: c.data.name,
      slug,
      url: toCompanyUrl(slug),
    };
  });

  const drugRecords: SearchRecord[] = publishedOnly(drugs).map((d) => {
    const slug = entrySlug(d);
    return {
      type: 'drug',
      title: d.data.genericName,
      name: d.data.genericName,
      slug,
      url: toDrugUrl(slug),
      genericName: d.data.genericName,
      brandName: d.data.brandName,
      drugClass: d.data.drugClass,
      // P8 — flatten every region group's `items` into a single list so search
      // still matches indication terms regardless of the region grouping.
      indications: (Array.isArray(d.data.indications) ? d.data.indications : []).flatMap(
        (group) => (group && Array.isArray(group.items) ? group.items : []),
      ),
    };
  });

  return [...companyRecords, ...drugRecords];
}

/**
 * P10 — slug uniqueness. Return the list of slugs that appear more than once
 * (each duplicated slug is reported a single time). An empty result means all
 * slugs are unique.
 */
export function findDuplicateSlugs(
  items: Array<{ id?: string; slug?: string; data?: { slug?: string } }>,
): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const slug = entrySlug(item);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }

  const duplicates: string[] = [];
  for (const [slug, count] of counts) {
    if (count > 1) duplicates.push(slug);
  }
  return duplicates;
}

/**
 * P4 — referential integrity, aligned with the design ("每个药品的 `company`
 * 指向存在的公司;已发布药品所属公司亦为已发布"):
 *
 *   - Rule 1: EVERY drug (draft or reviewed) must reference an EXISTING company.
 *   - Rule 2: ADDITIONALLY, a PUBLISHED (reviewed) drug's company must ALSO be
 *     published.
 *
 * A DRAFT drug that references an existing—but still unpublished—company is
 * therefore sound (drafts may be authored before their company goes live) and is
 * NOT flagged. Returns exactly the drugs that break one of the two rules above.
 */
export function checkReferentialIntegrity(
  companies: CompanyEntry[],
  drugs: DrugEntry[],
): DrugEntry[] {
  const allCompanySlugs = new Set(companies.map(entrySlug));
  const publishedCompanySlugs = new Set(publishedOnly(companies).map(entrySlug));

  return drugs.filter((drug) => {
    const ref = companyRef(drug);
    // Rule 1 — the referenced company must exist (for every drug, any status).
    if (!allCompanySlugs.has(ref)) return true;
    // Rule 2 — a published drug additionally requires a published company.
    if (drug.data.reviewStatus === 'reviewed' && !publishedCompanySlugs.has(ref)) {
      return true;
    }
    // Existing company + (a draft drug, or a reviewed drug with published company).
    return false;
  });
}

// ---------------------------------------------------------------------------
// Codified review checks (P13/P14/P15) — deterministic, pure, testable.
//
// These replace the previous "human/AI judgement" review with build-time code
// that the prebuild validator (and the Zod schema, for P15) enforce. All three
// apply to PUBLISHED (reviewed) drugs.
// ---------------------------------------------------------------------------

/**
 * Host allowlist for an authoritative regulator/gov "anchor" citation (P13). A
 * citation URL whose hostname equals one of these — or is a subdomain of one —
 * is treated as authoritative. Company official sites and peer-reviewed journals
 * are deliberately absent.
 */
export const ANCHOR_HOST_ALLOWLIST: readonly string[] = [
  'fda.gov',
  'accessdata.fda.gov',
  'dailymed.nlm.nih.gov',
  'nlm.nih.gov',
  'nih.gov',
  'ncbi.nlm.nih.gov',
  'cancer.gov',
  'nmpa.gov.cn',
  'ema.europa.eu',
  'pmda.go.jp',
  'tga.gov.au',
  'who.int',
];

/** True when `host` equals an allowlisted domain or is a subdomain of one. */
function hostIsAllowlisted(host: string): boolean {
  const h = host.toLowerCase();
  return ANCHOR_HOST_ALLOWLIST.some((domain) => h === domain || h.endsWith(`.${domain}`));
}

/**
 * P13 anchor test. A citation is an authoritative anchor when its `sourceType`
 * is `regulator`/`label`/`gov`, OR its `url` host is in {@link ANCHOR_HOST_ALLOWLIST}.
 * A `company` (drug-maker) source is NOT an anchor (it only counts toward the
 * required source total), and peer-reviewed journals are not authoritative.
 */
export function isAuthoritativeAnchor(citation: Citation | undefined | null): boolean {
  if (!citation) return false;
  const st = citation.sourceType;
  if (st === 'regulator' || st === 'label' || st === 'gov') return true;
  if (typeof citation.url === 'string' && citation.url.length > 0) {
    try {
      return hostIsAllowlisted(new URL(citation.url).hostname);
    } catch {
      return false; // malformed URL -> not an anchor
    }
  }
  return false;
}

// P14 scope red-line regexes (case-insensitive). `DOSING_RE` matches a number
// immediately followed by a dose unit (optionally "/kg", "/day", "/次" …), or a
// "每日 N" / "每次 N" pattern. `ADVICE_RE` matches usage/dosage-advice phrasing.
// Both are intentionally narrow so they do NOT fire on things like "PD-L1≥1",
// "≥1 线", "Cys481" or "IgG4" (a bare digit with no dose unit after it).
const DOSING_RE =
  /\d+\s*(?:mg|mcg|µg|ug|ml|iu|单位|g)(?:\s*\/\s*(?:kg|day|d|次|日))?|每日\s*\d|每次\s*\d/i;
const ADVICE_RE =
  /用法用量|推荐剂量|建议(?:服用|使用|剂量)|遵医嘱.*剂量|dosage|recommended dose|take\s+\d/i;

/**
 * P14 scope red-line: true when `text` contains dosing figures or usage/dosage
 * advice (which must never appear in published science-communication copy).
 */
export function hasScopeViolation(text: string | undefined | null): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return DOSING_RE.test(text) || ADVICE_RE.test(text);
}

/** Add whole months to a date, returning a new Date (handles year rollover). */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * P15 recheck window. Returns the recheck deadline for a review: `recheckBy`
 * when present, otherwise `checkedOn + 12 months`. Returns `undefined` when the
 * dates are missing/invalid (which P15 reports separately).
 */
export function recheckDeadline(review: Review | undefined): Date | undefined {
  if (!review) return undefined;
  if (review.recheckBy !== undefined) {
    const by = new Date(review.recheckBy);
    return isNaN(by.getTime()) ? undefined : by;
  }
  const checkedOn = review.checkedOn !== undefined ? new Date(review.checkedOn) : undefined;
  if (!checkedOn || isNaN(checkedOn.getTime())) return undefined;
  return addMonths(checkedOn, 12);
}

// ---------------------------------------------------------------------------
// Drug content invariants (P2, P3, P5, P7, and — for published drugs — P13/P14/P15)
// ---------------------------------------------------------------------------

export interface InvariantResult {
  valid: boolean;
  violations: string[];
}

/**
 * Pure checker for the per-drug content invariants:
 *   - P3: the three mechanism layers (analogy/simple/advanced) are non-empty.
 *   - P7: at least one region-grouped indication (each group has a non-empty
 *     region and >=1 non-empty item), and target.name + target.type are present.
 *   - P5: media is OPTIONAL, but IF present every entry needs a non-empty `alt`.
 *   - P2: a reviewed drug carries at least one citation.
 *
 * Additionally, FOR PUBLISHED (reviewed) DRUGS the codified review checks run:
 *   - P13: >=2 citations, at least one an authoritative regulator/gov anchor.
 *   - P14: summary + the three mechanism layers carry no dosing/usage-advice text.
 *   - P15: high-confidence auto-review metadata that is within its recheck window.
 *
 * Accepts either a full entry ({ data }) or a bare data object. `today` is
 * injectable so the freshness check (P15) is deterministic in tests.
 */
export function drugContentInvariants(
  drug: DrugEntry | DrugData,
  today: Date = new Date(),
): InvariantResult {
  const data: DrugData =
    drug && typeof drug === 'object' && 'data' in drug
      ? (drug as DrugEntry).data
      : (drug as DrugData);

  const violations: string[] = [];

  // P3 — three mechanism layers non-empty.
  const mechanism = data.mechanism;
  if (!mechanism || !nonEmpty(mechanism.analogy)) violations.push('mechanism.analogy is empty');
  if (!mechanism || !nonEmpty(mechanism.simple)) violations.push('mechanism.simple is empty');
  if (!mechanism || !nonEmpty(mechanism.advanced)) violations.push('mechanism.advanced is empty');

  // P7 — at least one region group; each group has a non-empty `region` and at
  // least one non-empty `item`.
  if (!Array.isArray(data.indications) || data.indications.length < 1) {
    violations.push('indications must contain at least one region group');
  } else {
    data.indications.forEach((group, i) => {
      if (!group || !nonEmpty(group.region)) {
        violations.push(`indications[${i}].region is empty`);
      }
      if (!group || !Array.isArray(group.items) || group.items.length < 1) {
        violations.push(`indications[${i}].items must contain at least one entry`);
      } else if (group.items.some((item) => !nonEmpty(item))) {
        violations.push(`indications[${i}].items contains an empty value`);
      }
    });
  }

  // P7 — target.name and target.type present.
  if (!data.target || !nonEmpty(data.target.name)) violations.push('target.name is missing');
  if (!data.target || !nonEmpty(data.target.type)) violations.push('target.type is missing');

  // P5 — media is OPTIONAL now; but if present every entry needs a non-empty alt.
  if (Array.isArray(data.media) && data.media.some((m) => !nonEmpty(m.alt))) {
    violations.push('media.alt must be non-empty for every media entry');
  }

  // P2 — reviewed drugs must have at least one citation.
  const citations = Array.isArray(data.citations) ? data.citations : [];
  if (data.reviewStatus === 'reviewed' && citations.length < 1) {
    violations.push('a reviewed drug must have at least one citation');
  }

  // --- Codified review checks (P13/P14/P15) — published (reviewed) drugs only.
  if (data.reviewStatus === 'reviewed') {
    // P13 — sources: >=2 total, and at least one authoritative anchor.
    if (citations.length < 2) {
      violations.push(
        `citations: a reviewed drug needs >=2 independent authoritative sources (has ${citations.length}) (P13)`,
      );
    }
    if (!citations.some((c) => isAuthoritativeAnchor(c))) {
      violations.push(
        'citations: a reviewed drug needs at least one authoritative regulator/gov anchor (P13)',
      );
    }

    // P14 — scope red-line: no dosing/usage-advice text in summary + mechanism.
    const scopeFields: Array<[string, string | undefined]> = [
      ['summary', data.summary],
      ['mechanism.analogy', mechanism?.analogy],
      ['mechanism.simple', mechanism?.simple],
      ['mechanism.advanced', mechanism?.advanced],
    ];
    for (const [field, text] of scopeFields) {
      if (hasScopeViolation(text)) {
        violations.push(`${field}: contains dosing or usage-advice text (scope red-line) (P14)`);
      }
    }

    // P15 — verification + freshness.
    const review = data.review;
    if (!review) {
      violations.push('review: a reviewed drug must carry auto-review metadata (P15)');
    } else {
      if (review.confidence !== 'high') {
        violations.push(
          `review.confidence: must be 'high' for a reviewed drug (got '${review.confidence}') (P15)`,
        );
      }
      const checkedOn =
        review.checkedOn !== undefined ? new Date(review.checkedOn) : undefined;
      if (!checkedOn || isNaN(checkedOn.getTime())) {
        violations.push('review.checkedOn: a reviewed drug must record a valid check date (P15)');
      } else {
        const deadline = recheckDeadline(review);
        if (deadline && today.getTime() > deadline.getTime()) {
          violations.push(
            `review: recheck overdue (deadline ${deadline.toISOString().slice(0, 10)}) (P15)`,
          );
        }
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Presentation ordering + getStaticPaths builders (Task 7)
//
// These are pure so the page routing logic can be unit-tested with small
// in-memory fixtures instead of booting Astro's content layer. The real pages
// call `getCollection(...)` and hand the results straight to these helpers.
// ---------------------------------------------------------------------------

/** Public accessor for an entry's canonical slug (wraps internal `entrySlug`). */
export const slugOf = (entry: {
  id?: string;
  slug?: string;
  data?: { slug?: string };
}): string => entrySlug(entry);

/** Public accessor for a drug's normalized company reference slug. */
export const companyRefOf = (drug: DrugEntry): string => companyRef(drug);

/**
 * Stable ordering for companies (需求 1.2): ascending `order` first (entries
 * without an explicit order sort last), ties broken by `name`. `Array#sort` is
 * stable (ES2019+), so equal keys preserve input order. Returns a new array
 * (the input is not mutated).
 */
export function sortCompanies(companies: CompanyEntry[]): CompanyEntry[] {
  return [...companies].sort((a, b) => {
    const ao = a.data.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.data.order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.data.name ?? '').localeCompare(b.data.name ?? '');
  });
}

/**
 * Comparator for drug prominence: higher `popularity` first, drugs WITHOUT a
 * popularity sort last, ties broken by `genericName` (ascending). Pure + total,
 * so both `sortByPopularity` and `groupByDrugClass` share one ordering rule.
 */
function comparePopularity(a: DrugEntry, b: DrugEntry): number {
  const ap = a.data.popularity;
  const bp = b.data.popularity;
  if (ap === undefined && bp === undefined) {
    return (a.data.genericName ?? '').localeCompare(b.data.genericName ?? '');
  }
  if (ap === undefined) return 1; // a (no popularity) sorts after b
  if (bp === undefined) return -1; // b (no popularity) sorts after a
  if (ap !== bp) return bp - ap; // higher popularity first
  return (a.data.genericName ?? '').localeCompare(b.data.genericName ?? '');
}

/**
 * Homepage "热门药物" ordering (需求 1/9): the PUBLISHED drugs (P1) ordered by
 * `popularity` descending, drugs without a popularity last, ties broken by
 * `genericName`. Returns a new array; the input is not mutated.
 */
export function sortByPopularity(drugs: DrugEntry[]): DrugEntry[] {
  return [...publishedOnly(drugs)].sort(comparePopularity);
}

/** A drug class and its published drugs (see {@link groupByDrugClass}). */
export interface DrugClassGroup {
  drugClass: string;
  drugs: DrugEntry[];
}

/**
 * "按作用机制浏览" grouping (需求 1/9): the PUBLISHED drugs (P1) grouped by
 * `drugClass`. Within each group the drugs are ordered by {@link comparePopularity};
 * the groups themselves are ordered by their most-prominent drug (then by class
 * name) so the most popular class leads. Drugs with no `drugClass` fall into a
 * single empty-string group (the pages handle/skip it). Pure + fixture-testable.
 */
export function groupByDrugClass(drugs: DrugEntry[]): DrugClassGroup[] {
  const groups = new Map<string, DrugEntry[]>();
  for (const drug of publishedOnly(drugs)) {
    const key = drug.data.drugClass ?? '';
    const arr = groups.get(key);
    if (arr) arr.push(drug);
    else groups.set(key, [drug]);
  }

  const result: DrugClassGroup[] = [];
  for (const [drugClass, groupDrugs] of groups) {
    result.push({ drugClass, drugs: [...groupDrugs].sort(comparePopularity) });
  }

  // Order groups by their most-prominent (already-sorted first) drug, then by
  // class name for a stable, predictable ordering.
  result.sort((a, b) => {
    const cmp = comparePopularity(a.drugs[0], b.drugs[0]);
    return cmp !== 0 ? cmp : a.drugClass.localeCompare(b.drugClass);
  });
  return result;
}

export interface CompanyDetailPath {
  params: { slug: string };
  props: { company: CompanyEntry; drugs: DrugEntry[] };
}

export interface DrugDetailPath {
  params: { slug: string };
  props: { drug: DrugEntry };
}

/**
 * getStaticPaths data for `/companies/[slug]` (Task 7). A company becomes a route
 * ONLY when it is PUBLISHED (P1) AND has at least one PUBLISHED drug whose
 * `company` reference resolves to it (P4) — drug-less companies are not routed,
 * so there is no "in preparation" company page. Each route carries only that
 * company's published, correctly-referenced drugs. Pure + fixture-testable.
 */
export function publishedCompanyDetailPaths(
  companies: CompanyEntry[],
  drugs: DrugEntry[],
): CompanyDetailPath[] {
  const pubDrugs = publishedOnly(drugs);
  return publishedOnly(companies)
    .map((company) => {
      const slug = entrySlug(company);
      return {
        company,
        slug,
        drugs: pubDrugs.filter((drug) => companyRef(drug) === slug),
      };
    })
    .filter((entry) => entry.drugs.length > 0)
    .map(({ company, slug, drugs: ownDrugs }) => ({
      params: { slug },
      props: { company, drugs: ownDrugs },
    }));
}

/**
 * getStaticPaths data for `/drugs/[slug]` (Task 7). Only PUBLISHED drugs become
 * routes (P1). Pure + fixture-testable.
 */
export function publishedDrugDetailPaths(drugs: DrugEntry[]): DrugDetailPath[] {
  return publishedOnly(drugs).map((drug) => ({
    params: { slug: entrySlug(drug) },
    props: { drug },
  }));
}

/**
 * Set of company slugs that have at least one PUBLISHED drug. The companies
 * index uses this to list ONLY companies that have published content (需求 1);
 * companies with no published drug are omitted entirely (no placeholder badge).
 */
export function companiesWithPublishedDrugs(drugs: DrugEntry[]): Set<string> {
  return new Set(publishedOnly(drugs).map((drug) => companyRef(drug)));
}
