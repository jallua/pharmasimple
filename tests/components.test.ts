import { test, expect } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Disclaimer from '../src/components/Disclaimer.astro';
import Citations from '../src/components/Citations.astro';
import LanguageSwitcher from '../src/components/LanguageSwitcher.astro';
import { t } from '../src/lib/i18n';
import type { Citation } from '../src/lib/catalog';

// ---------------------------------------------------------------------------
// P11 — the disclaimer text is present wherever the component renders. Text is
// single-sourced from i18n, so we assert against t('zh', 'disclaimer.body').
// ---------------------------------------------------------------------------

test('P11: footer Disclaimer renders the single-sourced disclaimer text', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Disclaimer, {});
  expect(html).toContain(t('zh', 'disclaimer.body'));
});

test('P11: prominent Disclaimer renders both the title and the body', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Disclaimer, {
    props: { variant: 'prominent' },
  });
  expect(html).toContain(t('zh', 'disclaimer.title'));
  expect(html).toContain(t('zh', 'disclaimer.body'));
  expect(html).toContain('role="note"');
});

// ---------------------------------------------------------------------------
// Citations rendering (P2 display side).
// ---------------------------------------------------------------------------

test('Citations renders each title, links only those with a url', async () => {
  const container = await AstroContainer.create();
  const citations: Citation[] = [
    { title: 'FDA prescribing information', url: 'https://example.com/label' },
    { title: 'Textbook chapter (no link)' },
  ];
  const html = await container.renderToString(Citations, { props: { citations } });

  expect(html).toContain(t('zh', 'citations.heading'));
  expect(html).toContain('FDA prescribing information');
  expect(html).toContain('href="https://example.com/label"');
  expect(html).toContain('Textbook chapter (no link)');
  // The linkless citation is not wrapped in an anchor.
  expect(html).toContain('<span>Textbook chapter (no link)</span>');
});

test('Citations renders nothing when there are no citations', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Citations, { props: { citations: [] } });
  expect(html).not.toContain('<ol');
  expect(html).not.toContain('<section');
  expect(html.trim()).toBe('');
});

// ---------------------------------------------------------------------------
// Language switcher stays hidden while only one locale ships.
// ---------------------------------------------------------------------------

test('LanguageSwitcher renders nothing while only one locale ships', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(LanguageSwitcher, {});
  expect(html.trim()).toBe('');
});
