import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import MechanismLayers from '../src/components/MechanismLayers.astro';
import {
  CONTENT_FIELD_GUIDANCE,
  auditContentStyle,
  hasComparativeClaim,
  type ContentStyleDraft,
} from '../src/lib/content-style';

const restrainedDraft: ContentStyleDraft = {
  summary: '伊马替尼是一种酪氨酸激酶抑制剂，主要用于部分白血病和胃肠道间质瘤。',
  target: {
    name: 'BCR-ABL 融合激酶',
    role: '这种异常激酶会持续传递促进细胞增殖的信号。',
  },
  simple: '部分慢性髓性白血病细胞会产生异常活跃的 BCR-ABL 融合激酶。伊马替尼与这类激酶结合，降低其活性，使相关生长信号减弱。',
};

describe('content-style field contracts', () => {
  test('defines distinct responsibilities and makes analogy optional', () => {
    expect(Object.keys(CONTENT_FIELD_GUIDANCE)).toEqual(['summary', 'target', 'analogy', 'simple']);
    expect(CONTENT_FIELD_GUIDANCE.analogy).toContain('可缺省');
    expect(auditContentStyle(restrainedDraft, { mode: 'strict' })).toEqual({
      mode: 'strict',
      ok: true,
      issues: [],
    });
  });

  test('strict mode blocks cross-product comparison and substitution language', () => {
    const text = '\u4e0e\u53e6\u4e00\u4ea7\u54c1\u4e0d\u540c\uff0c\u672c\u4ea7\u54c1\u66f4\u5b89\u5168\uff0c\u53ef\u76f8\u4e92\u66ff\u4ee3\u3002';
    expect(hasComparativeClaim(text)).toBe(true);
    const audit = auditContentStyle({ ...restrainedDraft, simple: text }, { mode: 'strict' });
    expect(audit.ok).toBe(false);
    expect(audit.issues.some((issue) => issue.code === 'comparative-claim')).toBe(true);
  });

  test('flags narrow superiority and pregnancy-suitability wording without matching code identifiers', () => {
    expect(hasComparativeClaim('强于只激活一种')).toBe(true);
    expect(hasComparativeClaim('孕期也相对可用')).toBe(true);
    expect(hasComparativeClaim('孕期可考虑的抗 TNF 选择')).toBe(true);
    expect(hasComparativeClaim('GipGlp1Coagonist strongerThanSingleTarget')).toBe(false);
  });

  test('legacy reports findings without blocking while strict blocks them', () => {
    const risky = {
      ...restrainedDraft,
      summary: '一种精准狙击癌细胞的神药:它让狡猾的癌细胞无处可逃。',
      analogy: '伊马替尼既像钥匙关掉开关，又像踩下刹车，精准消灭敌人。',
      simple: `这是一个很长的句子，${'持续推动异常信号并重复堆叠信息'.repeat(8)}。`,
    };
    const legacy = auditContentStyle(risky, { mode: 'legacy' });
    const strict = auditContentStyle(risky, { mode: 'strict' });
    const codes = new Set(strict.issues.map((issue) => issue.code));

    expect(legacy.ok).toBe(true);
    expect(legacy.issues.every((issue) => !issue.blocking && issue.severity === 'warning')).toBe(true);
    expect(strict.ok).toBe(false);
    expect(strict.issues.every((issue) => issue.blocking && issue.severity === 'error')).toBe(true);
    for (const code of [
      'high-risk-promotion',
      'anthropomorphism',
      'multiple-metaphors',
      'template-language',
      'english-punctuation',
      'long-sentence',
    ] as const) {
      expect(codes.has(code)).toBe(true);
    }
  });

  test('required fields and copied field roles are detected', () => {
    const duplicated = 'BCR-ABL 激酶持续传递促进白血病细胞增殖的异常信号';
    const audit = auditContentStyle({ summary: duplicated, target: duplicated }, { mode: 'strict' });
    expect(audit.issues.some((issue) => issue.code === 'missing-required-field' && issue.field === 'simple')).toBe(true);
    expect(audit.issues.some((issue) => issue.code === 'role-overlap')).toBe(true);
  });
});

test('MechanismLayers omits an absent analogy layer', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(MechanismLayers, {
    props: {
      mechanism: {
        analogy: undefined,
        simple: '通俗说明',
        advanced: '进阶说明',
      },
    },
  });

  expect(html).not.toContain('mechanism__layer--analogy');
  expect(html).toContain('通俗说明');
  expect(html).toContain('进阶说明');
});

test('content audit CLI emits JSON and keeps legacy findings report-only', () => {
  const script = fileURLToPath(new URL('../scripts/audit-content-style.ts', import.meta.url));
  const fixture = fileURLToPath(new URL('../src/content/drugs/imatinib.md', import.meta.url));
  const result = spawnSync(process.execPath, [script, fixture], { encoding: 'utf8' });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  const report = JSON.parse(result.stdout) as {
    mode: string;
    policy: string;
    scannedFiles: number;
    blockingIssueCount: number;
  };
  expect(report).toMatchObject({
    mode: 'legacy',
    policy: 'report-only',
    scannedFiles: 1,
    blockingIssueCount: 0,
  });
});
