export type ContentStyleField = 'summary' | 'target' | 'analogy' | 'simple';
export type ContentAuditMode = 'legacy' | 'strict';

export interface ContentStyleDraft {
  summary?: unknown;
  target?: unknown;
  analogy?: unknown;
  simple?: unknown;
}

export interface ContentStyleIssue {
  code:
    | 'missing-required-field'
    | 'high-risk-promotion'
    | 'comparative-claim'
    | 'anthropomorphism'
    | 'multiple-metaphors'
    | 'template-language'
    | 'english-punctuation'
    | 'long-sentence'
    | 'role-overlap';
  field: ContentStyleField;
  severity: 'warning' | 'error';
  blocking: boolean;
  message: string;
  excerpt?: string;
}

export interface ContentStyleAudit {
  mode: ContentAuditMode;
  ok: boolean;
  issues: ContentStyleIssue[];
}

export const CONTENT_FIELD_GUIDANCE = {
  summary: '用一至两句说明药物类别、主要作用和用途，不写研发史、排名或口号。',
  target: '说明生物学靶点及其与疾病的关系，不重复药物作用过程。',
  analogy: '可缺省；使用时只保留一个必要且准确的类比，不把多个意象串在一起。',
  simple: '按“疾病变化—靶点作用—药物影响”解释因果链，使用自然中文，不堆砌进阶细节。',
} as const satisfies Record<ContentStyleField, string>;

export const CONTENT_STYLE_RULES = {
  sentenceLength: {
    summary: 64,
    target: 72,
    analogy: 72,
    simple: 90,
  },
  highRiskPromotion: [
    /精准(?:靶向|打击|狙击|杀伤)/,
    /精准地?(?:卡住|识别|消灭)/,
    /里程碑(?:式)?/,
    /革命性|颠覆性|划时代/,
    /神药|奇迹药|完美药物/,
    /彻底根治|治愈(?:所有|各种)/,
    /最先进|最佳|全球第一/,
  ],
  comparativeClaims: [
    /(?:\u76f8\u6bd4|\u76f8\u8f83|\u4f18\u4e8e|\u52a3\u4e8e|\u4e0d\u5982)/,
    /(?:\u4e0e|\u548c).{1,24}\u4e0d\u540c/,
    /\u6bd4(?:\u5355\u7528|\u5176\u4ed6|\u540c\u7c7b|\u4f20\u7edf|\u65e9\u671f).{0,20}(?:\u66f4|\u8f83|\u5f3a|\u5f31|\u5feb|\u6162|\u5168\u9762|\u5b89\u5168|\u6709\u6548|\u9002\u5408)/,
    /(?:\u66f4\u5b89\u5168|\u66f4\u9002\u5408|\u66f4\u6709\u6548|\u66f4\u5168\u9762|\u66f4\u7ba1\u7528|\u53ef(?:\u76f8\u4e92)?\u66ff\u4ee3)/,
    /[强弱]于/,
    /比(?:只|仅).{0,20}(?:更|强|弱|足)/,
    /(?:最大|主要|关键).{0,8}不同/,
    /(?:不会|不).{0,4}像.{1,24}那样/,
    /(?:相对(?:更)?(?:可用|安全|放心|适合)|具(?:有)?优势)/,
    /(?:孕期|妊娠期|孕妇).{0,16}(?:可用|可考虑|放心|适合|首选|优选)/,
    /(?:适合长期使用|常作为.{0,16}(?:选择|方案))/,
  ],
  anthropomorphism: [
    /狡猾|偷偷|伪装|欺骗/,
    /清醒|听话|逃跑|躲过/,
    /追杀|抓捕|卫兵|士兵|敌人/,
    /饿死|命令|指挥官/,
  ],
  templates: [
    /^(?:这是一种|一种).{0,30}(?:药|抑制剂|抗体)[：:]/,
    /(?:这个药|本药)(?:的作用)?(?:就是|可以|会)/,
    /通俗地说|简单来说|值得一提的是/,
    /正是它.{0,20}之处|多管齐下|双管齐下/,
  ],
  metaphorFamilies: {
    switch: /开关|按钮|闸门|总闸/,
    lock: /钥匙|锁孔|上锁|解锁/,
    driving: /刹车|油门|方向盘/,
    factory: /工厂|机器|流水线|工人/,
    combat: /狙击|武器|卫兵|士兵|敌人|抓捕/,
    transport: /道路|交通|接力|多米诺|补给线/,
    food: /断粮|饿住|饿死|做饭|口粮/,
  },
} as const;

export function hasComparativeClaim(text: string | undefined | null): boolean {
  return typeof text === 'string' && CONTENT_STYLE_RULES.comparativeClaims.some((pattern) => pattern.test(text));
}

const REQUIRED_FIELDS: ContentStyleField[] = ['summary', 'target', 'simple'];
const FIELD_ORDER: ContentStyleField[] = ['summary', 'target', 'analogy', 'simple'];

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  return [record.name, record.role]
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('：');
}

function excerptAround(text: string, match: RegExpMatchArray): string {
  const start = Math.max(0, (match.index ?? 0) - 14);
  return text.slice(start, start + Math.max(36, match[0].length + 28));
}

function compact(text: string): string {
  return text.replace(/[\s，。；：、“”‘’（）()\-]/g, '');
}

export function auditContentStyle(
  draft: ContentStyleDraft,
  options: { mode?: ContentAuditMode } = {},
): ContentStyleAudit {
  const mode = options.mode ?? 'legacy';
  const texts = Object.fromEntries(
    FIELD_ORDER.map((field) => [field, asText(draft[field])]),
  ) as Record<ContentStyleField, string>;
  const issues: ContentStyleIssue[] = [];

  const add = (
    field: ContentStyleField,
    code: ContentStyleIssue['code'],
    message: string,
    excerpt?: string,
  ): void => {
    issues.push({
      code,
      field,
      severity: mode === 'strict' ? 'error' : 'warning',
      blocking: mode === 'strict',
      message,
      ...(excerpt ? { excerpt } : {}),
    });
  };

  for (const field of REQUIRED_FIELDS) {
    if (!texts[field]) add(field, 'missing-required-field', `${field} 不能为空。`);
  }

  for (const field of FIELD_ORDER) {
    const text = texts[field];
    if (!text) continue;

    for (const pattern of CONTENT_STYLE_RULES.highRiskPromotion) {
      const match = text.match(pattern);
      if (match) {
        add(field, 'high-risk-promotion', '删除宣传性、绝对化或“精准打击”式表述，改写为可核验的作用描述。', excerptAround(text, match));
        break;
      }
    }

    for (const pattern of CONTENT_STYLE_RULES.comparativeClaims) {
      const match = text.match(pattern);
      if (match) {
        add(field, 'comparative-claim', 'Remove cross-product superiority, difference, or substitution claims; describe only this product.', excerptAround(text, match));
        break;
      }
    }

    for (const pattern of CONTENT_STYLE_RULES.anthropomorphism) {
      const match = text.match(pattern);
      if (match) {
        add(field, 'anthropomorphism', '避免把细胞、肿瘤或药物写成人物，直接说明生物学过程。', excerptAround(text, match));
        break;
      }
    }

    for (const pattern of CONTENT_STYLE_RULES.templates) {
      const match = text.match(pattern);
      if (match) {
        add(field, 'template-language', '去掉套话和固定生成式句型，按本药事实自然成句。', excerptAround(text, match));
        break;
      }
    }

    const englishPunctuation = text.match(/[,;:!?\"]+/);
    if (englishPunctuation) {
      add(field, 'english-punctuation', '中文叙述使用全角中文标点；英文缩写内部的连字符不受影响。', excerptAround(text, englishPunctuation));
    }

    const metaphorFamilies = Object.entries(CONTENT_STYLE_RULES.metaphorFamilies)
      .filter(([, pattern]) => pattern.test(text))
      .map(([name]) => name);
    if (metaphorFamilies.length > 1) {
      add(field, 'multiple-metaphors', `同一字段混用了 ${metaphorFamilies.length} 组意象；最多保留一个类比。`);
    }

    const maxLength = CONTENT_STYLE_RULES.sentenceLength[field];
    for (const sentence of text.split(/[。！？；\n]/).map((part) => part.trim()).filter(Boolean)) {
      const length = Array.from(sentence.replace(/\s/g, '')).length;
      if (length > maxLength) {
        add(field, 'long-sentence', `单句 ${length} 字，超过 ${field} 的 ${maxLength} 字建议上限；请拆分因果关系。`, sentence.slice(0, 80));
      }
    }
  }

  const populated = FIELD_ORDER.filter((field) => texts[field]);
  for (let leftIndex = 0; leftIndex < populated.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < populated.length; rightIndex += 1) {
      const left = populated[leftIndex];
      const right = populated[rightIndex];
      const leftText = compact(texts[left]);
      const rightText = compact(texts[right]);
      const shorter = leftText.length <= rightText.length ? leftText : rightText;
      const longer = leftText.length > rightText.length ? leftText : rightText;
      if (shorter.length >= 24 && longer.includes(shorter)) {
        add(right, 'role-overlap', `${left} 与 ${right} 大段重复；请按字段职责拆分信息。`);
      }
    }
  }

  return {
    mode,
    ok: !issues.some((issue) => issue.blocking),
    issues,
  };
}
