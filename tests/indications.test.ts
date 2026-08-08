import { expect, test } from 'vitest';
import { homeIndicationGroups } from '../src/lib/indications';
import type { DrugEntry, ReviewStatus } from '../src/lib/catalog';

const drug = (
  slug: string,
  indicationItems: string[],
  reviewStatus: ReviewStatus = 'reviewed',
  drugClass = 'irrelevant mechanism class',
): DrugEntry => ({
  id: slug,
  data: {
    slug,
    locale: 'zh',
    company: 'acme',
    genericName: slug,
    brandName: slug,
    drugClass,
    indications: [{ region: 'CN', items: indicationItems }],
    target: { name: 't', type: 'protein', role: 'r' },
    mechanism: { simple: 's', advanced: 'a' },
    citations: [],
    reviewStatus,
  },
});

test('homepage indication groups come from published indication text, never drugClass', () => {
  const groups = homeIndicationGroups([
    drug('d1', ['2 型糖尿病'], 'reviewed', '类风湿关节炎'),
    drug('d2', ['类风湿关节炎']),
    drug('draft', ['2 型糖尿病'], 'draft'),
  ]);
  expect(groups.find((group) => group.id === 'type-2-diabetes')?.productCount).toBe(1);
  expect(groups.find((group) => group.id === 'rheumatoid-arthritis')?.productCount).toBe(1);
});

test('reviewed wording variants map to one clear indication entry', () => {
  const groups = homeIndicationGroups([
    drug('a', ['非瓣膜性房颤的卒中预防']),
    drug('b', ['降低非瓣膜性房颤患者的卒中和体循环栓塞风险']),
  ]);
  expect(groups.find((group) => group.id === 'af-stroke-prevention')).toMatchObject({
    label: '非瓣膜性房颤的卒中预防',
    query: '非瓣膜性房颤 卒中',
    productCount: 2,
  });
});

test('groups with no matching published product are omitted', () => {
  expect(homeIndicationGroups([drug('only', ['未列入首页词表的罕见适应症'])])).toEqual([]);
});
