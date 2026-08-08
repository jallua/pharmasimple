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

import {
  citationSourceIdentityMatches,
  distinctCitationSourceCount,
  isRegisteredAuthoritativeSource,
} from './source-registry.ts';
import { hasComparativeClaim } from './content-style.ts';
import { contentCopyHash, evidenceClaimMatches } from './trusted-content.ts';
import type { FactRef } from './trusted-content.ts';

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
  /** Stable content-derived ID used by field-level evidence records. */
  id?: string;
  title: string;
  publisher?: string;
  url?: string;
  retrievedDate?: Date | string;
  /** Deterministic registry ID or `web:<https-host>` identity. */
  sourceId?: string;
  /** Legacy display metadata only. It is never trusted for authority decisions. */
  sourceType?: SourceType;
}

export interface EvidenceLink {
  /** RFC 6901 JSON Pointer into a factual drug field. */
  claimPath: string;
  /** Exact value observed and supported when the evidence bundle was built. */
  claimValue: unknown;
  citationIds: string[];
}

export type VerificationStatus = 'verified' | 'conflicted' | 'stale' | 'blocked';

interface VerificationWindow {
  checkedAt: Date | string;
  nextCheckAt: Date | string;
  pipelineVersion: string;
}

export type Verification =
  | (VerificationWindow & {
      status: 'verified';
      schemaVersion: 2;
      bundleHash: string;
    })
  | (VerificationWindow & {
      status: Exclude<VerificationStatus, 'verified'>;
      schemaVersion?: 1 | 2;
      bundleHash?: string;
    });

export interface LegacyLkg {
  snapshotId: string;
  capturedAt: Date | string;
  migrateBy: Date | string;
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
  analogy?: string;
  simple: string;
  advanced: string;
}

export interface CompanyData {
  slug: string;
  locale: 'zh';
  name: string;
  nameEn?: string;
  aliases?: string[];
  identitySource?: {
    title: string;
    url: string;
    retrievedDate: Date | string;
  };
  logo?: string;
  country?: string;
  summary?: string;
  summarySource?: {
    title: string;
    url: string;
    retrievedDate: Date | string;
  };
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
  /** English generic/INN name, shown as a secondary line (optional). */
  genericNameEn?: string;
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
  /** Deprecated v1 exact-value evidence; new content uses reviewed factRefs. */
  evidence?: EvidenceLink[];
  /** Reviewed links from public-facing copy to versioned atomic facts. */
  factRefs?: FactRef[];
  /** Machine verification state for every published drug. */
  verification?: Verification;
  /** Explicit, snapshot-bound migration exception; valid only while stale and before its deadline. */
  legacyLkg?: LegacyLkg;
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

/** A reviewed public record represents one product/trade name, never a brand bundle. */
export function hasSingleProductIdentity(brandName: string | undefined): boolean {
  const value = brandName?.trim() ?? '';
  return value.length > 0 && !/[\/;；]/.test(value);
}

/** Product/trade name is the public identity; generic name is the legacy-safe fallback. */
export function productNameOf(data: Pick<DrugData, 'brandName' | 'genericName'>): string {
  return data.brandName?.trim() || data.genericName;
}

export interface CompanyNameParts {
  primary: string;
  secondary?: string;
}

/**
 * Legacy company records store an English name in trailing parentheses. Keep
 * the source data intact, but expose a stable two-line presentation model.
 * Explicit nameEn metadata takes precedence for newly verified identities.
 */
export function companyNameParts(
  data: Pick<CompanyData, 'name' | 'nameEn'>,
): CompanyNameParts {
  const raw = data.name.trim();
  const parenthetical = raw.match(/^(.*?)\s*[\(\uFF08]([^()\uFF08\uFF09]+)[\)\uFF09]\s*$/);
  const primary = parenthetical?.[1]?.trim() || raw;
  const legacySecondary = parenthetical?.[2]?.trim();
  const candidate = data.nameEn?.trim() || legacySecondary;
  const secondary = candidate && candidate.localeCompare(primary, undefined, { sensitivity: 'accent' }) !== 0
    ? candidate
    : undefined;
  return { primary, ...(secondary ? { secondary } : {}) };
}

/** Plain-text company identity for metadata and accessible labels. */
export function companyDisplayNameOf(
  data: Pick<CompanyData, 'name' | 'nameEn'>,
): string {
  const { primary, secondary } = companyNameParts(data);
  return secondary ? primary + ' (' + secondary + ')' : primary;
}

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
export const toCompanyUrl = (slug: string): string => `/companies/${slug}/`;

/** Stable URL for a drug mechanism page. */
export const toDrugUrl = (slug: string): string => `/drugs/${slug}/`;

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
    const names = companyNameParts(c.data);
    return {
      type: 'company',
      title: names.primary,
      name: companyDisplayNameOf(c.data),
      slug,
      url: toCompanyUrl(slug),
    };
  });

  const drugRecords: SearchRecord[] = publishedOnly(drugs).map((d) => {
    const slug = entrySlug(d);
    const productName = productNameOf(d.data);
    return {
      type: 'drug',
      title: productName,
      name: productName,
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
 * P13 anchor test. Authority is derived exclusively from the versioned source
 * registry and an HTTPS URL. A hand-written `sourceType` can never grant trust.
 * If `sourceId` is supplied it must match the URL-derived registry entry.
 */
export function isAuthoritativeAnchor(citation: Citation | undefined | null): boolean {
  return citation ? isRegisteredAuthoritativeSource(citation) : false;
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
 *   - P16: one product identity and no comparative copy in text or media metadata.
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

  // P3 — plain-language and advanced layers are required; analogy is optional.
  const mechanism = data.mechanism;
  if (mechanism?.analogy !== undefined && !nonEmpty(mechanism.analogy)) {
    violations.push('mechanism.analogy must be non-empty when present');
  }
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

  // --- Codified trust checks (P13/P14/P15) — published drugs only.
  if (data.reviewStatus === 'reviewed') {
    // P13 — every citation has a stable ID and a sourceId bound to its HTTPS URL.
    const mismatchedSourceIds = citations.filter((citation) => !citationSourceIdentityMatches(citation));
    if (mismatchedSourceIds.length > 0) {
      violations.push(
        `citations: ${mismatchedSourceIds.length} missing/mismatched sourceId value(s) (P13)`,
      );
    }
    const independentSourceCount = distinctCitationSourceCount(citations);
    if (independentSourceCount < 2) {
      violations.push(
        `citations: a reviewed drug needs >=2 independently identified sources (has ${independentSourceCount}) (P13)`,
      );
    }
    if (!citations.some((citation) => isAuthoritativeAnchor(citation))) {
      violations.push(
        'citations: a reviewed drug needs at least one registry-approved official anchor (P13)',
      );
    }

    const citationIds = citations.map((citation) => citation.id).filter(nonEmpty);
    if (citationIds.length !== citations.length) {
      violations.push('citations: every citation needs a stable ID (P13)');
    }
    if (new Set(citationIds).size !== citationIds.length) {
      violations.push('citations: citation IDs must be unique (P13)');
    }

    // Field evidence binds an exact RFC 6901 claim path + value to known citations.
    if (Array.isArray(data.evidence)) {
      const knownIds = new Set(citationIds);
      const claimPaths = new Set<string>();
      for (const evidence of data.evidence) {
        if (!nonEmpty(evidence.claimPath) || !Array.isArray(evidence.citationIds) || evidence.citationIds.length < 1) {
          violations.push('evidence: every claim needs a path, value, and citation ID (P13)');
          continue;
        }
        if (claimPaths.has(evidence.claimPath)) {
          violations.push(`evidence.${evidence.claimPath}: duplicate claim path (P13)`);
        }
        claimPaths.add(evidence.claimPath);
        if (new Set(evidence.citationIds).size !== evidence.citationIds.length) {
          violations.push(`evidence.${evidence.claimPath}: duplicate citation ID (P13)`);
        }
        if (evidence.citationIds.some((id) => !knownIds.has(id))) {
          violations.push(`evidence.${evidence.claimPath}: references an unknown citation ID (P13)`);
        }
        if (!evidenceClaimMatches(data, evidence.claimPath, evidence.claimValue)) {
          violations.push(`evidence.${evidence.claimPath}: claimValue does not match current content (P13)`);
        }
      }
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

    // P16 — every reviewed public record is product-scoped and non-comparative,
    // including stale legacy LKG content and user-visible media metadata.
    const productCopyFields: Array<[string, string | undefined]> = [
      ...scopeFields,
      ...(Array.isArray(data.media)
        ? data.media.flatMap((item, index): Array<[string, string | undefined]> => [
            [`media[${index}].alt`, item.alt],
            [`media[${index}].caption`, item.caption],
          ])
        : []),
    ];
    if (!hasSingleProductIdentity(data.brandName)) {
      violations.push('brandName: reviewed content must identify exactly one product/trade name (P16)');
    }
    for (const [field, text] of productCopyFields) {
      if (hasComparativeClaim(text)) {
        violations.push(field + ': contains a cross-product comparison, suitability, or substitution claim (P16)');
      }
    }

    // P15 — no review-based fail-open. Verified bundles are the default. The
    // only exception is an explicit stale legacy LKG whose catalog digest is
    // checked by the build validator and whose migration deadline has not passed.
    const verification = data.verification;
    if (!verification) {
      violations.push('verification: reviewed content must carry verification metadata (P15)');
    } else {
      const checkedAt = new Date(verification.checkedAt);
      const nextCheckAt = new Date(verification.nextCheckAt);
      if (isNaN(checkedAt.getTime())) violations.push('verification.checkedAt: invalid date (P15)');
      if (isNaN(nextCheckAt.getTime())) violations.push('verification.nextCheckAt: invalid date (P15)');
      if (!isNaN(checkedAt.getTime()) && !isNaN(nextCheckAt.getTime()) && nextCheckAt < checkedAt) {
        violations.push('verification.nextCheckAt: must not precede checkedAt (P15)');
      }

      if (verification.status === 'verified') {
        if (!verification.bundleHash || !/^sha256:[a-f0-9]{64}$/.test(verification.bundleHash)) {
          violations.push('verification.bundleHash: verified content requires a real SHA-256 bundle hash (P15)');
        }
        if (verification.schemaVersion !== 2) {
          violations.push('verification.schemaVersion: verified content must use canonical v2 factRefs (P15)');
        }
        const refs = Array.isArray(data.factRefs) ? data.factRefs : [];
        if (refs.length < 1) {
          violations.push('verification: verified v2 content must carry reviewed factRefs (P15)');
        }
        for (const ref of refs) {
          if (ref.reviewStatus !== 'reviewed') {
            violations.push(`factRefs.${ref.contentPath}: reviewStatus must be reviewed (P15)`);
          }
          const copyHash = contentCopyHash(data, ref.contentPath);
          if (!copyHash || copyHash !== ref.copyHash) {
            violations.push(`factRefs.${ref.contentPath}: copyHash does not match current copy (P15)`);
          }
          const ids = [...ref.factIds].sort();
          const bound = Object.keys(ref.boundFactHashes).sort();
          if (JSON.stringify(ids) !== JSON.stringify(bound)) {
            violations.push(`factRefs.${ref.contentPath}: boundFactHashes must exactly cover factIds (P15)`);
          }
        }
        if (!isNaN(nextCheckAt.getTime()) && today.getTime() > nextCheckAt.getTime()) {
          violations.push('verification: verified evidence bundle is stale (P15)');
        }
        if (data.legacyLkg) violations.push('legacyLkg: verified content must leave the legacy queue (P15)');
      } else if (verification.status === 'stale' && data.legacyLkg) {
        const migrateBy = new Date(data.legacyLkg.migrateBy);
        const capturedAt = new Date(data.legacyLkg.capturedAt);
        if (verification.bundleHash) {
          violations.push('verification.bundleHash: legacy/stale content must not claim an evidence bundle hash (P15)');
        }
        if (isNaN(migrateBy.getTime()) || isNaN(capturedAt.getTime())) {
          violations.push('legacyLkg: capturedAt and migrateBy must be valid dates (P15)');
        } else {
          if (today.getTime() > migrateBy.getTime()) {
            violations.push(`legacyLkg: migration deadline ${migrateBy.toISOString().slice(0, 10)} has passed (P15)`);
          }
          if (!isNaN(nextCheckAt.getTime()) && nextCheckAt.getTime() !== migrateBy.getTime()) {
            violations.push('legacyLkg: migrateBy must equal verification.nextCheckAt (P15)');
          }
        }
      } else {
        violations.push(
          `verification.status: '${verification.status}' cannot be published without verified evidence (P15)`,
        );
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
    return companyNameParts(a.data).primary.localeCompare(companyNameParts(b.data).primary);
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

// ---------------------------------------------------------------------------
// Therapeutic-area grouping for the homepage "按作用机制浏览" browse.
// Pure + fixture-testable. Maps a free-text `drugClass` to a coarse therapeutic
// area via ordered keyword rules (first match wins; anything unmatched falls
// into the final "其他" bucket) and builds an area -> class-group structure on
// top of the published-only `groupByDrugClass` (so P1 still holds).
// ---------------------------------------------------------------------------

/** Ordered therapeutic areas (display order for the homepage browse). */
export const THERAPEUTIC_AREAS = [
  '肿瘤(抗癌)',
  '免疫与炎症',
  '代谢与内分泌',
  '心血管与血液',
  '抗感染与疫苗',
  '神经与精神',
  '呼吸与过敏',
  '眼科',
  '其他(罕见病、皮肤等)',
] as const;

export type TherapeuticArea = (typeof THERAPEUTIC_AREAS)[number];

const FALLBACK_AREA: TherapeuticArea = '其他(罕见病、皮肤等)';

const AREA_RULES: ReadonlyArray<{ area: TherapeuticArea; re: RegExp }> = [
  {
    area: '肿瘤(抗癌)',
    re: /PD-1|PD-L1|HER2|EGFR|VEGFR|BCR-ABL|ALK|BTK|PARP|CDK|IDH|HDAC|酪氨酸激酶|雄激素受体|雌激素受体|SERD|门冬酰胺酶|抗癌|ADC/i,
  },
  { area: '免疫与炎症', re: /TNF|IL-\d|白细胞介素|整合素|IgA 肾病|皮质类固醇/i },
  { area: '代谢与内分泌', re: /GLP-1|GIP|SGLT2|双胍|胰岛素|葡萄糖苷酶|降糖|皮质醇|孕激素|避孕/i },
  {
    area: '心血管与血液',
    re: /他汀|HMG-CoA|Ⅹa|Xa 因子|抗凝|血管紧张素|ACEI|钙通道|CCB|COX|抗血小板|溶栓|纤溶|凝血因子|集落刺激因子|G-CSF|前列环素|IP 受体/i,
  },
  { area: '抗感染与疫苗', re: /抗生素|头孢|青霉素|内酰胺|HIV|反转录酶|疫苗|mRNA|载体/i },
  { area: '神经与精神', re: /抗精神病|多巴胺|抗癫痫|麻醉|GABA|VMAT2|CGRP|偏头痛/i },
  { area: '呼吸与过敏', re: /β2|支气管|抗组胺|鼻用|哮喘/i },
  { area: '眼科', re: /眼用|降眼压|前列腺素类似物/i },
  {
    area: FALLBACK_AREA,
    re: /FGF23|利钠肽|CNP|siRNA|RNAi|反义寡核苷酸|CFTR|免疫球蛋白|加压素|抗利尿|维 A 酸|视黄酸/i,
  },
];

/**
 * Map a free-text drug class to a coarse therapeutic area (first matching rule
 * wins; anything unmatched falls into the final "其他" bucket). Pure + total.
 */
export function therapeuticArea(drugClass: string): TherapeuticArea {
  const c = drugClass ?? '';
  for (const { area, re } of AREA_RULES) {
    if (re.test(c)) return area;
  }
  return FALLBACK_AREA;
}

/**
 * Build a safe, deterministic HTML id/anchor for a (possibly Chinese) drug-class
 * name: lowercase, keep letters/numbers (incl. CJK), collapse every other run to
 * a single '-', and trim stray '-'. Prefixed with "class-" so the result is a
 * valid, non-empty id even for a punctuation-only class. Pure + total.
 */
export function classAnchor(drugClass: string): string {
  const body = (drugClass ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `class-${body}`;
}

/** A therapeutic area with its drug-class groups (see {@link groupByTherapeuticArea}). */
export interface TherapeuticAreaGroup {
  area: TherapeuticArea;
  classes: DrugClassGroup[];
  drugCount: number;
}

/**
 * Group published drugs by therapeutic area, then by drug class, for the
 * homepage browse. Areas follow {@link THERAPEUTIC_AREAS} order and only
 * non-empty areas are returned; within an area the classes keep the
 * `groupByDrugClass` ordering (most-prominent class first). Pure; built on the
 * published-only `groupByDrugClass` so the publish gate (P1) still holds.
 */
export function groupByTherapeuticArea(drugs: DrugEntry[]): TherapeuticAreaGroup[] {
  const classGroups = groupByDrugClass(drugs).filter((g) => g.drugClass.length > 0);
  const byArea = new Map<TherapeuticArea, DrugClassGroup[]>();
  for (const group of classGroups) {
    const area = therapeuticArea(group.drugClass);
    const arr = byArea.get(area);
    if (arr) arr.push(group);
    else byArea.set(area, [group]);
  }
  const result: TherapeuticAreaGroup[] = [];
  for (const area of THERAPEUTIC_AREAS) {
    const classes = byArea.get(area);
    if (classes && classes.length > 0) {
      result.push({
        area,
        classes,
        drugCount: classes.reduce((sum, g) => sum + g.drugs.length, 0),
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// UX helpers (site UX pass): related drugs, area anchors, per-company drug
// counts. All pure + fixture-testable, built on the published-only primitives
// so the publish gate (P1) still holds.
// ---------------------------------------------------------------------------

/**
 * Safe, deterministic HTML id/anchor for a therapeutic-area name (mirrors
 * {@link classAnchor} but with an "area-" prefix). Pure + total.
 */
export function areaAnchor(area: string): string {
  const body = (area ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `area-${body}`;
}

/**
 * Map of company slug -> number of that company's PUBLISHED drugs (P1). Used by
 * the companies index to show a "收录 N 种药物" count. Pure + total.
 */
export function drugsCountByCompany(drugs: DrugEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const drug of publishedOnly(drugs)) {
    const ref = companyRef(drug);
    if (ref) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  return counts;
}
