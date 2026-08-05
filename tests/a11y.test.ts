// tests/a11y.test.ts — automated accessibility checks (Task 12 / 需求 13).
//
// These render the site's document shell (BaseLayout) and every content
// component through Astro's container API, then run axe-core against the result
// and assert there are NO serious/critical violations.
//
// WHY the shell + components (not the page route modules): the container SSR
// path used in tests cannot render the `src/pages/**/*.astro` route modules —
// they resolve through Astro's content-collection layer / full-document routing
// and fail to render here ("NoMatchingRenderer"). BaseLayout is the shell EVERY
// page wraps its body in (skip-link, header/nav/main/footer landmarks, <html
// lang>, <title>, footer disclaimer), and the content components below are the
// exact building blocks the pages assemble — so auditing shell + components
// covers the same accessibility surface the real pages expose.
//
// WHY the default (node) test environment + a hand-built JSDOM: under vitest's
// browser-like test environment Vite resolves `.astro` imports to their CLIENT
// build, which the server-side container cannot render. So this file MUST run in
// the default node environment (where `.astro` SSR works, like the other
// component tests); we then build a JSDOM window ourselves, load axe-core INTO
// it, and run axe there — the well-worn axe-core + jsdom pattern for Node.
// (Do NOT add a vitest environment override comment to this file — the browser
// environment breaks `.astro` server rendering here.)
//
// WHAT axe CANNOT check under jsdom (stays MANUAL — see report): jsdom has no
// layout/paint engine, so rules needing real geometry or colors can't run. The
// canonical case is `color-contrast` (WCAG 1.4.3), DISABLED below and verified
// manually against the tokens in global.css / in a real browser — consistent
// with the design's accessibility caveat. Visual focus-outline appearance is
// likewise covered by the manual keyboard walkthrough.
//
// Everything axe CAN evaluate structurally — document language & title,
// landmark/heading structure, list nesting, link/button names, image & svg
// alternative text, ARIA validity, form labels — is enforced at serious/critical.
import { test, expect } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import BaseLayout from '../src/layouts/BaseLayout.astro';
import MechanismLayers from '../src/components/MechanismLayers.astro';
import MechanismMedia from '../src/components/MechanismMedia.astro';
import Citations from '../src/components/Citations.astro';
import Disclaimer from '../src/components/Disclaimer.astro';
import Search from '../src/components/Search.astro';
import BtkInhibitor from '../src/components/animations/BtkInhibitor.astro';
import Pd1Checkpoint from '../src/components/animations/Pd1Checkpoint.astro';
import Glp1Agonist from '../src/components/animations/Glp1Agonist.astro';
import TnfInhibitor from '../src/components/animations/TnfInhibitor.astro';
import FactorXaInhibitor from '../src/components/animations/FactorXaInhibitor.astro';
import Her2Antibody from '../src/components/animations/Her2Antibody.astro';
import BcrAblInhibitor from '../src/components/animations/BcrAblInhibitor.astro';
import type { Media, Mechanism, Citation } from '../src/lib/catalog';

// Minimal local shapes for the bits of axe-core's result we consume. We load
// axe at runtime INTO the jsdom window (below), so we don't import axe-core's
// module types (its `export =` shape doesn't expose these as named imports).
interface AxeNode {
  target: string[];
}
interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: AxeNode[];
}
interface AxeRunOptions {
  resultTypes?: string[];
  rules?: Record<string, { enabled: boolean }>;
}

// Read axe-core's UMD bundle once; it is eval'd into each JSDOM window.
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

// axe options: keep every rule EXCEPT the ones that cannot run without a real
// layout engine. `color-contrast` is the canonical example (see header note).
const AXE_OPTIONS: AxeRunOptions = {
  resultTypes: ['violations'],
  rules: { 'color-contrast': { enabled: false } },
};

const seriousOrCritical = (violations: AxeViolation[]): AxeViolation[] =>
  violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');

/** Readable failure message: which rule, why, and where. */
const format = (violations: AxeViolation[]): string =>
  violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n    ` +
        v.nodes.map((n) => n.target.join(' ')).join('\n    '),
    )
    .join('\n');

/** Run axe INSIDE a fresh JSDOM window built from `html`, scoped to `selector`. */
async function audit(html: string, selector?: string): Promise<AxeViolation[]> {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  // Cast the window once so this stays independent of jsdom's exact typings.
  const win = dom.window as unknown as {
    eval: (code: string) => void;
    close: () => void;
    document: { querySelector: (s: string) => unknown };
    axe: { run: (ctx: unknown, opts: AxeRunOptions) => Promise<{ violations: AxeViolation[] }> };
  };
  win.eval(axeSource); // UMD bundle attaches `window.axe`
  const context = selector ? win.document.querySelector(selector) : win.document;
  const results = await win.axe.run(context, AXE_OPTIONS);
  win.close();
  return results.violations;
}

/** Audit a full page document (starts with <!doctype html>) — whole document. */
const auditFullPage = (html: string) => audit(html);

/** Audit a component fragment: wrap in a valid document + <main> and scope to it. */
const auditFragment = (html: string) =>
  audit(
    `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>fragment</title></head><body><main>${html}</main></body></html>`,
    'main',
  );

const expectClean = (violations: AxeViolation[]) => {
  const bad = seriousOrCritical(violations);
  expect(bad, format(bad)).toEqual([]);
};

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const mechanism: Mechanism = {
  analogy: '像给一台不断发出“增殖”指令的开关上了把锁。',
  simple: '泽布替尼结合 BTK,阻断促进恶性 B 细胞增殖的信号。',
  advanced: '共价结合 BTK 的 Cys481,抑制 BCR 下游的激酶活性。',
};

const media: Media[] = [
  {
    type: 'animation',
    animationKey: 'btk-inhibitor',
    status: 'ready',
    alt: '动画:泽布替尼结合并卡住 BTK,使促增殖信号中断。',
    caption: 'BTK 抑制机制示意动画',
  },
  { type: 'image', src: '/images/example.svg', status: 'ready', alt: '静态示意图' },
];

const citations: Citation[] = [
  { title: 'FDA 处方信息', url: 'https://example.com/label' },
  { title: '权威综述(无链接)' },
];

// A drug-mechanism-page-like body, mirroring the real `/drugs/[slug]` template
// structure (one <h1>, a prominent disclaimer, mechanism, indications, target).
const drugPageBody = `
  <article class="drug">
    <header class="drug__header">
      <h1>泽布替尼 (百悦泽)</h1>
      <p class="drug__class">药物类别: BTK 抑制剂</p>
      <p class="drug__company"><a href="/companies/beigene">所属公司</a></p>
      <p class="drug__summary">用于特定 B 细胞恶性肿瘤的口服 BTK 抑制剂。</p>
    </header>
    <aside class="disclaimer disclaimer--prominent" role="note" aria-label="免责声明">
      <strong class="disclaimer__title">免责声明</strong>
      <p class="disclaimer__body">本站为科普内容,不构成医疗建议。</p>
    </aside>
    <section class="mechanism" aria-label="作用机制">
      <h2>作用机制</h2>
      <div><h3>一句话比喻</h3><p>${mechanism.analogy}</p></div>
      <div><h3>通俗版</h3><p>${mechanism.simple}</p></div>
      <details><summary>进阶版</summary><p>${mechanism.advanced}</p></details>
    </section>
    <section class="drug__indications" aria-label="适应症(按获批地区)">
      <h2>适应症(按获批地区)</h2>
      <div class="drug__indication-group">
        <h3 class="drug__indication-region">
          <span class="drug__indication-place">中国 · NMPA</span>
          <span class="drug__indication-asof">截至 2025</span>
        </h3>
        <ul><li>慢性淋巴细胞白血病</li><li>套细胞淋巴瘤</li></ul>
      </div>
      <p class="drug__indications-note">各地区获批适应症以当地最新官方说明书为准;本页为科普性归纳,不代表在所有地区均可获得。</p>
    </section>
    <section class="drug__target" aria-label="作用靶点">
      <h2>作用靶点</h2>
      <p><strong>BTK</strong> <span>(酶)</span></p>
      <p>在 B 细胞受体信号通路中向下游传递增殖信号。</p>
    </section>
  </article>
`;

// A companies-index-like body: one <h1> and a stable list of ONLY companies that
// have published content (no "in preparation" badge anymore).
const companiesIndexBody = `
  <h1>公司</h1>
  <ul class="company-list">
    <li class="company-list__item">
      <a class="company-list__link" href="/companies/beigene">百济神州</a>
      <p class="company-list__summary">一家全球性的肿瘤创新药企业。</p>
    </li>
  </ul>
`;

// ---------------------------------------------------------------------------
// Full-document audits through BaseLayout (skip-link, header/nav/main/footer
// landmarks, <html lang>, <title>, one <h1>, keyboard-usable nav + <details>).
// ---------------------------------------------------------------------------

test('a11y: BaseLayout shell + drug-page body has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(BaseLayout, {
    props: { title: '泽布替尼' },
    slots: { default: drugPageBody },
  });
  // Sanity: we actually rendered the full shell (skip link + main landmark).
  expect(html).toContain('class="skip-link"');
  expect(html).toContain('id="main-content"');
  expectClean(await auditFullPage(html));
});

test('a11y: BaseLayout shell + companies-index body has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(BaseLayout, {
    props: { title: '公司' },
    slots: { default: companiesIndexBody },
  });
  expectClean(await auditFullPage(html));
});

// ---------------------------------------------------------------------------
// Content-component audits (the exact building blocks the pages assemble).
// ---------------------------------------------------------------------------

test('a11y: MechanismLayers has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(MechanismLayers, { props: { mechanism } });
  expectClean(await auditFragment(html));
});

test('a11y: MechanismMedia (animation + image) has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(MechanismMedia, { props: { media } });
  // Confirm the real SVG animation + raster <img> are present in what we audit.
  expect(html).toContain('role="img"');
  expect(html).toContain('loading="lazy"');
  expectClean(await auditFragment(html));
});

test('a11y: Citations (linked + unlinked) has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Citations, { props: { citations } });
  expectClean(await auditFragment(html));
});

test('a11y: prominent Disclaimer has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Disclaimer, { props: { variant: 'prominent' } });
  expectClean(await auditFragment(html));
});

test('a11y: Search UI markup (labelled input) has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Search, {});
  expect(html).toContain('for="pagefind-search-input"'); // visually-hidden label present
  expectClean(await auditFragment(html));
});

// ---------------------------------------------------------------------------
// The two original SVG animations — each exposes an accessible name via
// role="img" + <title>, so svg-img-alt & friends must pass.
// ---------------------------------------------------------------------------

test('a11y: BtkInhibitor animation has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(BtkInhibitor, { props: { alt: 'BTK 抑制机制动画' } });
  expectClean(await auditFragment(html));
});

test('a11y: Pd1Checkpoint animation has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Pd1Checkpoint, {
    props: { alt: 'PD-1 检查点机制动画' },
  });
  expectClean(await auditFragment(html));
});

// ---------------------------------------------------------------------------
// The five blockbuster-class SVG animations added alongside the new drugs —
// each also exposes an accessible name via role="img" + <title>, so
// svg-img-alt & friends must pass just like the two originals above.
// ---------------------------------------------------------------------------

test('a11y: Glp1Agonist animation has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Glp1Agonist, {
    props: { alt: 'GLP-1 受体激动剂作用机制动画', subject: '司美格鲁肽' },
  });
  expectClean(await auditFragment(html));
});

test('a11y: TnfInhibitor animation has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(TnfInhibitor, {
    props: { alt: 'TNF-α 抑制剂作用机制动画', subject: '阿达木单抗' },
  });
  expectClean(await auditFragment(html));
});

test('a11y: FactorXaInhibitor animation has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(FactorXaInhibitor, {
    props: { alt: 'Ⅹa 因子抑制剂作用机制动画', subject: '阿哌沙班' },
  });
  expectClean(await auditFragment(html));
});

test('a11y: Her2Antibody animation has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Her2Antibody, {
    props: { alt: '抗 HER2 抗体作用机制动画', subject: '曲妥珠单抗' },
  });
  expectClean(await auditFragment(html));
});

test('a11y: BcrAblInhibitor animation has no serious/critical violations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(BcrAblInhibitor, {
    props: { alt: 'BCR-ABL 抑制剂作用机制动画', subject: '伊马替尼' },
  });
  expectClean(await auditFragment(html));
});
