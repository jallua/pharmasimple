import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { JSDOM } from 'jsdom';
import MechanismLayers from '../src/components/MechanismLayers.astro';
import MechanismMedia from '../src/components/MechanismMedia.astro';
import BtkInhibitor from '../src/components/animations/BtkInhibitor.astro';
import Pd1Checkpoint from '../src/components/animations/Pd1Checkpoint.astro';
import { animations, hasAnimation, getAnimation } from '../src/components/animations';
import { t } from '../src/lib/i18n';
import { hasComparativeClaim } from '../src/lib/content-style';
import type { Media, Mechanism } from '../src/lib/catalog';

// ---------------------------------------------------------------------------
// Animation registry — the two original BeiGene sample animations (Task 9) plus
// the blockbuster-class animations added alongside the new global drugs.
// Every registered key resolves; every OTHER key still fails the guard, which is
// what forces the placeholder fallback in MechanismMedia (P6).
// ---------------------------------------------------------------------------

test('animation registry contains the two original + sixty-six new class animations', () => {
  expect(Object.keys(animations).sort()).toEqual([
    'ace-inhibitor',
    'alk-inhibitor',
    'alpha-glucosidase',
    'androgen-receptor-inhibitor',
    'anti-fgf23',
    'antihistamine',
    'antisense-oligo',
    'asparaginase',
    'aspirin-cox',
    'atypical-antipsychotic',
    'bcr-abl-inhibitor',
    'beta2-agonist',
    'biguanide',
    'blactam',
    'btk-inhibitor',
    'ccb',
    'cdk46-inhibitor',
    'cftr-modulator',
    'cgrp-inhibitor',
    'clotting-factor',
    'cnp-analog',
    'conjugate-vaccine',
    'cortisol-synthesis-inhibitor',
    'dopamine-stabilizer',
    'egfr-inhibitor',
    'egfr-mab',
    'factor-xa-inhibitor',
    'gaba-anesthetic',
    'gcsf',
    'gip-glp1-coagonist',
    'glp1-agonist',
    'hdac-inhibitor',
    'her2-adc',
    'her2-antibody',
    'hiv-integrase',
    'idh-inhibitor',
    'iga-budesonide',
    'il12-23-inhibitor',
    'il13-inhibitor',
    'il23-inhibitor',
    'il4-13-inhibitor',
    'il6-inhibitor',
    'immunoglobulin',
    'insulin',
    'integrin-blocker',
    'mrna-vaccine',
    'parp-inhibitor',
    'pd-l1-checkpoint',
    'pd1-checkpoint',
    'pd1-checkpoint-fc-silent',
    'ppi',
    'progestin',
    'prostacyclin',
    'prostaglandin-glaucoma',
    'retinoid',
    'serd',
    'sglt2-inhibitor',
    'sirna-silencer',
    'sodium-channel-blocker',
    'statin',
    'thrombolytic',
    'tnf-decoy-receptor',
    'tnf-inhibitor',
    'tnf-pegylated-fab',
    'vasopressin-v2',
    'vegfr-inhibitor',
    'viral-vector-vaccine',
    'vmat2-inhibitor',
  ]);
  for (const key of [
    'btk-inhibitor',
    'pd1-checkpoint',
    'glp1-agonist',
    'tnf-inhibitor',
    'factor-xa-inhibitor',
    'her2-antibody',
    'bcr-abl-inhibitor',
    'il4-13-inhibitor',
    'cdk46-inhibitor',
    'sglt2-inhibitor',
    'hiv-integrase',
    'androgen-receptor-inhibitor',
    'vegfr-inhibitor',
    'cgrp-inhibitor',
    'il6-inhibitor',
    'iga-budesonide',
    'integrin-blocker',
    'dopamine-stabilizer',
    'egfr-inhibitor',
    'pd-l1-checkpoint',
    'alk-inhibitor',
    'hdac-inhibitor',
    'statin',
    'il23-inhibitor',
    'cftr-modulator',
    'mrna-vaccine',
    'sirna-silencer',
    'antisense-oligo',
    'vmat2-inhibitor',
    'parp-inhibitor',
    'ppi',
    'ccb',
    'blactam',
    'insulin',
    'prostaglandin-glaucoma',
    'beta2-agonist',
    'alpha-glucosidase',
    'aspirin-cox',
    'gaba-anesthetic',
    'ace-inhibitor',
    'biguanide',
    'conjugate-vaccine',
    'viral-vector-vaccine',
    'vasopressin-v2',
    'prostacyclin',
    'idh-inhibitor',
    'anti-fgf23',
    'retinoid',
    'serd',
    'sodium-channel-blocker',
    'atypical-antipsychotic',
    'gcsf',
    'progestin',
    'cortisol-synthesis-inhibitor',
    'clotting-factor',
    'immunoglobulin',
    'asparaginase',
    'antihistamine',
    'thrombolytic',
    'cnp-analog',
    'tnf-decoy-receptor',
    'tnf-pegylated-fab',
    'egfr-mab',
    'gip-glp1-coagonist',
    'il12-23-inhibitor',
    'her2-adc',
    'il13-inhibitor',
    'pd1-checkpoint-fc-silent',
  ]) {
    expect(hasAnimation(key)).toBe(true);
    expect(getAnimation(key)).toBeDefined();
  }

  // Unknown / empty / undefined keys never resolve (still forces the placeholder — P6).
  expect(hasAnimation('not-a-real-key')).toBe(false);
  expect(hasAnimation(undefined)).toBe(false);
  expect(hasAnimation('')).toBe(false);
  expect(getAnimation('anything')).toBeUndefined();
});

test('P16: rendered text from every registered animation is non-comparative', async () => {
  const container = await AstroContainer.create();
  const violations: Array<{ key: string; location: string; text: string }> = [];

  for (const [key, Animation] of Object.entries(animations)) {
    const html = await container.renderToString(Animation, { props: { subject: '测试药物' } });
    const dom = new JSDOM(html);
    const { document, NodeFilter } = dom.window;
    document.querySelectorAll('style, script').forEach((element) => element.remove());

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? '';
      if (text && hasComparativeClaim(text)) violations.push({ key, location: 'text', text });
    }

    document.querySelectorAll('[aria-label], [title]').forEach((element) => {
      for (const attribute of ['aria-label', 'title']) {
        const text = element.getAttribute(attribute)?.trim() ?? '';
        if (text && hasComparativeClaim(text)) violations.push({ key, location: attribute, text });
      }
    });
  }

  expect(violations).toEqual([]);
});

// ---------------------------------------------------------------------------
// MechanismLayers — all three layers (analogy, simple, advanced) render directly
// as visible content, each with its own <h3> label; there is no collapse and no
// <details>/<summary> (P3 presentation / 需求 3).
// ---------------------------------------------------------------------------

const mechanism: Mechanism = {
  analogy: 'ANALOGY_TEXT_一句话比喻',
  simple: 'SIMPLE_TEXT_通俗版',
  advanced: 'ADVANCED_TEXT_进阶版',
};

test('P3: MechanismLayers shows all three layers and all i18n labels', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(MechanismLayers, { props: { mechanism } });

  expect(html).toContain('ANALOGY_TEXT_一句话比喻');
  expect(html).toContain('SIMPLE_TEXT_通俗版');
  // Advanced text is present in the DOM (shown directly, not hidden/collapsed).
  expect(html).toContain('ADVANCED_TEXT_进阶版');

  // Labels come from i18n.
  expect(html).toContain(t('zh', 'mechanism.analogy'));
  expect(html).toContain(t('zh', 'mechanism.simple'));
  expect(html).toContain(t('zh', 'mechanism.advanced'));
});

test('P3: all three layers render directly as visible blocks (no <details> collapse)', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(MechanismLayers, { props: { mechanism } });

  // Every layer's text is present and visible.
  expect(html).toContain('ANALOGY_TEXT_一句话比喻');
  expect(html).toContain('SIMPLE_TEXT_通俗版');
  expect(html).toContain('ADVANCED_TEXT_进阶版');

  // Nothing is hidden behind a collapse: there is NO <details>/<summary>.
  expect(/<details(\s[^>]*)?>/i.test(html)).toBe(false);
  expect(/<summary(\s[^>]*)?>/i.test(html)).toBe(false);

  // All three layers are plain blocks, each labelled with an <h3> (same level).
  expect(html).toContain('mechanism__layer--analogy');
  expect(html).toContain('mechanism__layer--simple');
  expect(html).toContain('mechanism__layer--advanced');
  const advancedLabel = t('zh', 'mechanism.advanced');
  expect(new RegExp(`<h3(\\s[^>]*)?>${advancedLabel}</h3>`).test(html)).toBe(true);
});

// ---------------------------------------------------------------------------
// MechanismMedia — placeholder fallback (P6) + alt text always exposed (P5).
// ---------------------------------------------------------------------------

test('P6/P5: MechanismMedia renders only ready animations + images; unrenderable items are skipped (no placeholder)', async () => {
  const container = await AstroContainer.create();
  const media: Media[] = [
    // animation, ready, but key is NOT registered -> skipped (P6), no placeholder.
    {
      type: 'animation',
      animationKey: 'unregistered-key',
      status: 'ready',
      alt: 'ALT_ANIMATION_UNREG',
      caption: 'CAP_UNREG',
    },
    // animation still in progress -> skipped, no "动画制作中" placeholder.
    {
      type: 'animation',
      animationKey: 'pd1-checkpoint',
      status: 'in-progress',
      alt: 'ALT_ANIMATION_WIP',
    },
    // a plain image with a src -> <img> with alt + caption (code-verified, rendered).
    { type: 'image', src: '/images/example.svg', status: 'ready', alt: 'ALT_IMAGE', caption: 'CAP_IMAGE' },
    // a bare placeholder entry -> skipped.
    { type: 'placeholder', status: 'ready', alt: 'ALT_PLACEHOLDER' },
  ];

  const html = await container.renderToString(MechanismMedia, {
    props: { media, heading: '作用机制示意' },
  });

  expect(html).toContain('<h2 class="mechanism-media__heading">作用机制示意</h2>');
  // No placeholder is ever rendered.
  expect(html).not.toContain('media-placeholder');

  // The image renders (with its alt + caption) — it is real, ready content.
  expect(html).toContain('src="/images/example.svg"');
  expect(html).toContain('ALT_IMAGE');
  expect(html).toContain('CAP_IMAGE');

  // Skipped items contribute no markup at all (their alt/caption never appear).
  expect(html).not.toContain('ALT_ANIMATION_UNREG');
  expect(html).not.toContain('CAP_UNREG');
  expect(html).not.toContain('ALT_ANIMATION_WIP');
  expect(html).not.toContain('ALT_PLACEHOLDER');
});

test('P6: an in-progress animation renders nothing (no "in preparation" placeholder)', async () => {
  const container = await AstroContainer.create();
  const media: Media[] = [
    // btk-inhibitor IS registered, but status is in-progress -> skipped entirely.
    { type: 'animation', animationKey: 'btk-inhibitor', status: 'in-progress', alt: 'ALT_WIP_ONLY' },
  ];
  const html = await container.renderToString(MechanismMedia, { props: { media } });
  expect(html.trim()).toBe('');
});

test('MechanismMedia renders nothing for an empty (or absent) media list', async () => {
  const container = await AstroContainer.create();
  expect((await container.renderToString(MechanismMedia, { props: { media: [] } })).trim()).toBe('');
  expect((await container.renderToString(MechanismMedia, { props: {} })).trim()).toBe('');
});

// ---------------------------------------------------------------------------
// Task 9 — the two BeiGene sample animations. Each renders as a schematic,
// accessible SVG (role="img" + a <title> from `alt`) followed by its five
// labelled step captions as plain, readable text, and its scoped CSS carries a
// `prefers-reduced-motion` block that disables all motion (需求 4, 13).
// ---------------------------------------------------------------------------

const btkSteps = [
  'B 细胞收到“生长”信号',
  'BTK 开关把“快繁殖”的命令往下传',
  '这个药卡住 BTK 开关',
  '“快繁殖”的命令被切断',
  '癌变的 B 细胞停止繁殖',
];

const pd1Steps = [
  '免疫卫兵(T 细胞)发现癌细胞',
  '癌细胞伸出 PD-L1,踩住卫兵的“刹车”(PD-1)',
  '卫兵被踩了刹车,停手不打',
  '这个药挡住刹车,癌细胞踩不到了',
  '卫兵重新清醒,继续攻击癌细胞',
];

/** Read an animation component's source so we can assert on its scoped CSS. */
const readAnimationSource = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/components/animations/${file}`, import.meta.url)), 'utf8');

test('Task 9: BtkInhibitor renders role=img, its alt text, and all five step captions', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(BtkInhibitor, { props: { alt: 'BTK_ALT_TEXT' } });

  expect(html).toContain('role="img"');
  expect(html).toContain('BTK_ALT_TEXT'); // exposed via the SVG <title>
  for (const step of btkSteps) expect(html).toContain(step);
});

test('Task 9: Pd1Checkpoint renders role=img, its alt text, and all five step captions', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Pd1Checkpoint, { props: { alt: 'PD1_ALT_TEXT' } });

  expect(html).toContain('role="img"');
  expect(html).toContain('PD1_ALT_TEXT');
  for (const step of pd1Steps) expect(html).toContain(step);
});

test('Task 9/13: both animations disable motion under prefers-reduced-motion', () => {
  for (const file of ['BtkInhibitor.astro', 'Pd1Checkpoint.astro']) {
    const src = readAnimationSource(file);
    expect(src).toContain('@media (prefers-reduced-motion: reduce)');
    // Inside that block every animation is switched off.
    expect(src).toContain('animation: none !important');
  }
});

test('Task 9/P6: MechanismMedia renders the registered animation when the key resolves and status is ready', async () => {
  const container = await AstroContainer.create();
  const media: Media[] = [
    {
      type: 'animation',
      animationKey: 'btk-inhibitor',
      status: 'ready',
      alt: 'ALT_BTK_MEDIA',
      caption: 'CAPTION_BTK',
    },
  ];
  const html = await container.renderToString(MechanismMedia, { props: { media } });

  // The real animation is rendered (its final step caption appears) — no placeholder.
  expect(html).toContain('癌变的 B 细胞停止繁殖');
  expect(html).not.toContain('media-placeholder');
  // alt (figure aria-label + SVG title) and the figure caption are still exposed.
  expect(html).toContain('ALT_BTK_MEDIA');
  expect(html).toContain('CAPTION_BTK');
  expect(html).toContain(t('zh', 'mechanism.mediaScope'));
});
