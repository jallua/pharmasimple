// site/src/content.config.ts
//
// Astro 7 Content Layer API: collections are defined with a `loader` (the glob
// loader reads Markdown from the content directories) plus a Zod `schema` that
// is validated at build time. Any entry that violates the schema fails the
// build (fail fast), which is how many correctness constraints (P1-P12 in the
// design) are enforced at "compile time".
import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
// Astro 7 bundles Zod v4 and deprecates the `z` re-export from `astro:content`
// (its own compiler recommends this exact import). The schema below is otherwise
// identical to the design doc.
import { z } from 'astro/zod';

const reviewStatus = z.enum(['draft', 'reviewed']); // 需求 8
const locale = z.enum(['zh']); // 后续扩展 'en' 等(需求 10)

const citation = z.object({
  id: z.string().min(1).optional(), // 字段级证据使用的稳定 ID
  title: z.string().min(1),
  publisher: z.string().optional(),
  url: z.url().optional(),
  retrievedDate: z.coerce.date().optional(), // 采集来源日期(需求 11.2)
  sourceId: z.string().min(1).optional(), // 若提供,必须与官方来源注册表和 URL 一致
  // 兼容已有内容的展示元数据;权威性只由来源注册表 + HTTPS URL 判定。
  sourceType: z.enum(['regulator', 'label', 'gov', 'company', 'other']).optional(),
});

const evidenceLink = z.object({
  claim: z.string().min(1),
  citationIds: z.array(z.string().min(1)).min(1),
});

const verification = z.object({
  status: z.enum(['verified', 'conflicted', 'stale', 'blocked']),
  checkedAt: z.coerce.date(),
  pipelineVersion: z.string().min(1),
  evidenceBundleHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  recheckBy: z.coerce.date().optional(),
});

// 自动审核元数据(P15 / 需求 8.7):审核者恒为 auto,记录核对日期与置信等级,
// 可选复核到期日(缺省则按 checkedOn + 12 个月计算)。
const review = z.object({
  reviewer: z.literal('auto').default('auto'),
  checkedOn: z.coerce.date(),
  confidence: z.enum(['high', 'medium', 'low']),
  recheckBy: z.coerce.date().optional(),
});

const media = z.object({
  type: z.enum(['image', 'animation', 'placeholder']),
  src: z.string().optional(), // 原创图片路径
  animationKey: z.string().optional(), // 引用动画注册表中的组件
  alt: z.string().min(1), // 必填替代文本(需求 4.3 / 13.1)
  caption: z.string().optional(),
  status: z.enum(['ready', 'in-progress']).default('ready'), // 动画制作中 -> 占位(需求 4.4)
});

const companies = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/companies' }),
  schema: z.object({
    slug: z.string().min(1),
    locale,
    name: z.string().min(1),
    logo: z.string().optional(),
    country: z.string().optional(),
    summary: z.string().optional(),
    order: z.number().optional(), // 稳定排序(需求 1.2)
    reviewStatus,
  }),
});

const drugs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/drugs' }),
  schema: z
    .object({
      slug: z.string().min(1),
      locale,
      company: reference('companies'), // 引用完整性(需求 2)
      genericName: z.string().min(1),
      genericNameEn: z.string().optional(), // 英文通用名/INN(作为副标题展示)
      brandName: z.string().optional(),
      drugClass: z.string().optional(),
      // 首页「热门药物」排序权重:数值越大越靠前;缺省时排在最后(需求 1 / 9)。
      popularity: z.number().optional(),
      summary: z.string().optional(),
      // 适应症按监管地区分组:同一药品在不同地区获批的适应症不同(需求 5.1)。
      indications: z
        .array(
          z.object({
            region: z.string().min(1), // 地区,如「中国」「美国」「欧盟」
            regulator: z.string().optional(), // 监管机构,如 NMPA / FDA / EMA
            items: z.array(z.string().min(1)).min(1), // 该地区的适应症条目(至少一条)
            asOf: z.string().optional(), // 数据参考时间,如 "2025"
          }),
        )
        .min(1), // 至少包含一个地区分组
      target: z.object({
        // 作用靶点(需求 5.2)
        name: z.string().min(1),
        type: z.enum(['receptor', 'enzyme', 'ion-channel', 'pathway', 'protein', 'other']),
        role: z.string().min(1),
      }),
      mechanism: z.object({
        // 分层讲解(需求 3.1)
        analogy: z.string().min(1), // 一句话比喻
        simple: z.string().min(1), // 通俗版
        advanced: z.string().min(1), // 进阶版
      }),
      media: z.array(media).optional(), // 图/动画可选:无已制作素材时不展示(需求 4)
      citations: z.array(citation),
      // 后台字段级证据;前端仍只在页面底部统一展示 citations。
      evidence: z.array(evidenceLink).optional(),
      // 新自动流水线写入的机器验证结果;旧内容迁移期间仍兼容 review。
      verification: verification.optional(),
      review: review.optional(), // 旧自动审核元数据(P15),待内容迁移后移除
      reviewStatus,
      updatedDate: z.coerce.date().optional(),
    })
    // 已评审的药品必须至少有一条来源(需求 6.4 / 8.4)
    .refine((d) => d.reviewStatus !== 'reviewed' || d.citations.length >= 1, {
      message: '已评审的药品必须至少包含一条来源引用',
      path: ['citations'],
    })
    // 发布内容必须由新流水线验证通过;迁移期间兼容已有的 high review 元数据。
    .refine(
      (d) =>
        d.reviewStatus !== 'reviewed' ||
        d.verification?.status === 'verified' ||
        (d.review !== undefined && d.review.confidence === 'high'),
      {
        message: '已发布的药品必须通过自动验证(verification=verified)或具有迁移期 high review 元数据',
        path: ['verification'],
      },
    ),
});

export const collections = { companies, drugs };
