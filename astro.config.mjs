// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://pharmasimple.matata.fun',
  i18n: {
    defaultLocale: 'zh',
    locales: ['zh'],
    routing: { prefixDefaultLocale: false }
  },
  vite: {
    plugins: [tailwindcss()]
  }
});
