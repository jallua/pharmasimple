import { publishedOnly, type DrugEntry } from './catalog';

interface IndicationDefinition {
  id: string;
  label: string;
  query: string;
  patterns: RegExp[];
}

/**
 * Reviewed homepage vocabulary. Every group is matched against published
 * indication text; drug classes and mechanism labels are never used as a
 * proxy. Additions require an explicit editorial review and a regression test.
 */
export const HOME_INDICATION_DEFINITIONS: IndicationDefinition[] = [
  { id: 'type-2-diabetes', label: '2 型糖尿病', query: '2 型糖尿病', patterns: [/2\s*型糖尿病/i] },
  { id: 'rheumatoid-arthritis', label: '类风湿关节炎', query: '类风湿关节炎', patterns: [/类风湿关节炎/] },
  { id: 'ankylosing-spondylitis', label: '强直性脊柱炎', query: '强直性脊柱炎', patterns: [/强直性脊柱炎/] },
  { id: 'psoriatic-arthritis', label: '银屑病关节炎', query: '银屑病关节炎', patterns: [/银屑病关节炎/] },
  { id: 'plaque-psoriasis', label: '斑块型银屑病', query: '斑块型银屑病', patterns: [/斑块型银屑病/] },
  {
    id: 'af-stroke-prevention',
    label: '非瓣膜性房颤的卒中预防',
    query: '非瓣膜性房颤 卒中',
    patterns: [/非瓣膜性房颤.*卒中|卒中.*非瓣膜性房颤/],
  },
  { id: 'hepatocellular-carcinoma', label: '肝细胞癌', query: '肝细胞癌', patterns: [/肝细胞癌/] },
  { id: 'melanoma', label: '黑色素瘤', query: '黑色素瘤', patterns: [/黑色素瘤/] },
  { id: 'schizophrenia', label: '精神分裂症', query: '精神分裂症', patterns: [/精神分裂症/] },
  { id: 'cll', label: '慢性淋巴细胞白血病', query: '慢性淋巴细胞白血病', patterns: [/慢性淋巴细胞白血病/] },
  {
    id: 'covid-19-prevention',
    label: '新型冠状病毒感染预防',
    query: '预防 新型冠状病毒感染',
    patterns: [/预防.*(?:新型冠状病毒|COVID-19)|(?:新型冠状病毒|COVID-19).*预防/i],
  },
  {
    id: 'dvt-pe',
    label: '深静脉血栓与肺栓塞',
    query: '深静脉血栓 肺栓塞',
    patterns: [/深静脉血栓|肺栓塞/],
  },
];

export interface HomeIndicationGroup {
  id: string;
  label: string;
  query: string;
  productCount: number;
}

export function homeIndicationGroups(drugs: DrugEntry[]): HomeIndicationGroup[] {
  const published = publishedOnly(drugs);
  return HOME_INDICATION_DEFINITIONS.map((definition, order) => {
    const productCount = published.filter((drug) => {
      const items = drug.data.indications.flatMap((group) => group.items);
      return items.some((item) => definition.patterns.some((pattern) => pattern.test(item)));
    }).length;
    return { id: definition.id, label: definition.label, query: definition.query, productCount, order };
  })
    .filter((group) => group.productCount > 0)
    .sort((left, right) => right.productCount - left.productCount || left.order - right.order)
    .map(({ order: _order, ...group }) => group);
}
