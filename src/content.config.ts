import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { citationSourceIdentityMatches } from './lib/source-registry.ts';

const reviewStatus = z.enum(['draft', 'reviewed']);
const locale = z.enum(['zh']);
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const factId = z.string().regex(/^fact-[a-f0-9]{64}$/);
const evidenceId = z.string().regex(/^evidence-[a-f0-9]{64}$/);
const excerptId = z.string().regex(/^excerpt-[a-f0-9]{64}$/);

const citation = z
  .object({
    id: z.string().regex(/^cite-[a-f0-9]{16}$/),
    sourceId: z.string().min(1),
    title: z.string().min(1),
    publisher: z.string().optional(),
    url: z.url(),
    retrievedDate: z.coerce.date().optional(),
    sourceType: z.enum(['regulator', 'label', 'gov', 'company', 'other']).optional(),
  })
  .superRefine((value, context) => {
    if (!citationSourceIdentityMatches(value)) {
      context.addIssue({
        code: 'custom',
        message: 'sourceId must be the deterministic registered-source or HTTPS-host identity for url',
        path: ['sourceId'],
      });
    }
  });

/** v1 compatibility only; new verified content uses factRefs. */
const evidenceLink = z.object({
  claimPath: z
    .string()
    .regex(/^\/(company|genericName|genericNameEn|brandName|drugClass|summary|indications|target|mechanism)(\/.*)?$/),
  claimValue: z.unknown().refine((value) => value !== undefined, 'claimValue is required'),
  citationIds: z.array(z.string().regex(/^cite-[a-f0-9]{16}$/)).min(1),
});

const verificationBase = {
  checkedAt: z.coerce.date(),
  nextCheckAt: z.coerce.date(),
  pipelineVersion: z.string().min(1),
};
const verification = z.discriminatedUnion('status', [
  z.object({ status: z.literal('verified'), schemaVersion: z.literal(2), ...verificationBase, bundleHash: sha256 }),
  z.object({ status: z.literal('conflicted'), schemaVersion: z.union([z.literal(1), z.literal(2)]).optional(), ...verificationBase, bundleHash: sha256.optional() }),
  z.object({ status: z.literal('stale'), schemaVersion: z.union([z.literal(1), z.literal(2)]).optional(), ...verificationBase, bundleHash: sha256.optional() }),
  z.object({ status: z.literal('blocked'), schemaVersion: z.union([z.literal(1), z.literal(2)]).optional(), ...verificationBase, bundleHash: sha256.optional() }),
]);

const contentPath = z
  .string()
  .regex(/^\/(company|genericName|genericNameEn|brandName|drugClass|summary|indications|target|mechanism)(\/.*)?$/);

const factScope = z.object({
  jurisdiction: z.enum(['GLOBAL', 'US', 'EU', 'CN']),
  subjectType: z.enum(['active-ingredient', 'medicinal-product']),
  subjectId: z.string().min(1),
  productId: z.string().min(1).optional(),
});

const factAssertion = z.object({
  factKey: z.string().min(1),
  predicate: z.string().min(1),
  value: z.unknown().refine((value) => value !== undefined, 'assertion value is required'),
  scope: factScope,
  sourceId: z.string().min(1),
  lineageId: z.string().min(1),
  evidenceId,
  excerptId: excerptId.optional(),
});

const transformation = z.object({
  operation: z.string().min(1),
  toolVersion: z.string().min(1),
  inputSha256: sha256,
  outputSha256: sha256,
  locator: z.string().min(1),
});

const evidenceDocument = z.object({
  evidenceId,
  sourceId: z.string().min(1),
  sourceUrl: z.url().refine((url) => url.startsWith('https://'), 'evidence source must use HTTPS'),
  documentId: z.string().min(1),
  documentVersion: z.string().min(1),
  lineageId: z.string().min(1),
  jurisdiction: z.enum(['US', 'EU', 'CN']),
  activeIngredient: z.string().min(1),
  productId: z.string().min(1),
  documentType: z.enum(['label', 'regulatory-product']),
  retrievedAt: z.iso.datetime({ offset: true }),
  mediaType: z.string().min(1),
  rawSha256: sha256,
  rawObjectPath: z.string().regex(/^evidence\/objects\/[a-f0-9]{64}\.bin$/),
  transformations: z.array(transformation),
});

const atomicFact = z.object({
  schemaVersion: z.literal(2),
  factId,
  factKey: z.string().min(1),
  predicate: z.string().min(1),
  value: z.unknown().refine((value) => value !== undefined, 'fact value is required'),
  scope: factScope,
  status: z.enum(['verified', 'conflicted', 'stale', 'blocked']),
  assertions: z.array(factAssertion).min(1),
  resolutionHash: sha256,
  evidenceDocuments: z.array(evidenceDocument).min(1),
  importHash: sha256,
});

const factRef = z.object({
  contentPath,
  factIds: z.array(factId).min(1),
  relation: z.enum(['supports', 'contextualizes', 'derived-from']),
  boundFactHashes: z.record(factId, sha256),
  copyHash: sha256,
  reviewStatus: z.enum(['pending', 'reviewed', 'stale']),
});

const legacyLkg = z.object({
  snapshotId: z.string().min(1),
  capturedAt: z.coerce.date(),
  migrateBy: z.coerce.date(),
});

const media = z.object({
  type: z.enum(['image', 'animation', 'placeholder']),
  src: z.string().optional(),
  animationKey: z.string().optional(),
  alt: z.string().min(1),
  caption: z.string().optional(),
  status: z.enum(['ready', 'in-progress']).default('ready'),
});

const companies = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/companies' }),
  schema: z.object({
    slug: z.string().min(1),
    locale,
    name: z.string().min(1),
    nameEn: z.string().min(1).optional(),
    aliases: z.array(z.string().min(1)).optional(),
    identitySource: z
      .object({
        title: z.string().min(1),
        url: z.url(),
        retrievedDate: z.coerce.date(),
      })
      .optional(),
    logo: z.string().optional(),
    country: z.string().optional(),
    summary: z.string().optional(),
    summarySource: z
      .object({
        title: z.string().min(1),
        url: z.url(),
        retrievedDate: z.coerce.date(),
      })
      .optional(),
    order: z.number().optional(),
    reviewStatus,
  }),
});

const facts = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/facts' }),
  schema: atomicFact,
});

const drugs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/drugs' }),
  schema: z
    .object({
      slug: z.string().min(1),
      locale,
      company: reference('companies'),
      genericName: z.string().min(1),
      genericNameEn: z.string().optional(),
      brandName: z.string().optional(),
      drugClass: z.string().optional(),
      popularity: z.number().optional(),
      summary: z.string().optional(),
      indications: z
        .array(
          z.object({
            region: z.string().min(1),
            regulator: z.string().optional(),
            items: z.array(z.string().min(1)).min(1),
            asOf: z.string().optional(),
          }),
        )
        .min(1),
      target: z.object({
        name: z.string().min(1),
        type: z.enum(['receptor', 'enzyme', 'ion-channel', 'pathway', 'protein', 'other']),
        role: z.string().min(1),
      }),
      mechanism: z.object({
        analogy: z.string().min(1).optional(),
        simple: z.string().min(1),
        advanced: z.string().min(1),
      }),
      media: z.array(media).optional(),
      citations: z.array(citation),
      evidence: z.array(evidenceLink).optional(),
      factRefs: z.array(factRef).optional(),
      verification: verification.optional(),
      legacyLkg: legacyLkg.optional(),
      review: z.never().optional(),
      reviewStatus,
      updatedDate: z.coerce.date().optional(),
    })
    .superRefine((data, context) => {
      if (data.reviewStatus !== 'reviewed') return;
      if (data.citations.length < 1) {
        context.addIssue({ code: 'custom', message: '已评审的药品必须至少包含一条来源引用', path: ['citations'] });
      }
      const verified = data.verification?.status === 'verified';
      const explicitLegacy = data.verification?.status === 'stale' && data.legacyLkg !== undefined;
      if (!verified && !explicitLegacy) {
        context.addIssue({
          code: 'custom',
          message: '发布内容必须为 verified，或属于受清单约束且未到期的 stale legacy LKG',
          path: ['verification'],
        });
      }
      if (verified) {
        if (!data.factRefs?.length) {
          context.addIssue({ code: 'custom', message: 'verified v2 内容必须包含 factRefs', path: ['factRefs'] });
        } else if (data.factRefs.some((ref) => ref.reviewStatus !== 'reviewed')) {
          context.addIssue({ code: 'custom', message: 'verified v2 的 factRefs 必须全部完成编辑复核', path: ['factRefs'] });
        }
      }
      if (verified && data.legacyLkg) {
        context.addIssue({ code: 'custom', message: 'verified 内容不得继续声明 legacyLkg', path: ['legacyLkg'] });
      }
      if (explicitLegacy && data.verification && 'bundleHash' in data.verification && data.verification.bundleHash) {
        context.addIssue({ code: 'custom', message: '未联网验证的 legacy/stale 内容不得声明 bundleHash', path: ['verification', 'bundleHash'] });
      }
    }),
});

export const collections = { companies, facts, drugs };
export const VERIFICATION_STATUSES = ['verified', 'conflicted', 'stale', 'blocked'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
