/// <reference types="vitest/config" />
// Use Astro's `getViteConfig` so Vitest can transform and render `.astro`
// components (needed for the container-API component tests). Pure-TS tests
// (catalog, i18n, citations) keep working unchanged.
// The triple-slash reference above pulls in Vitest's module augmentation for
// Vite's `UserConfig`, which adds the `test` field `getViteConfig` accepts.
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
