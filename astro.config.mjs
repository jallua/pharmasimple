// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://dongyaojun.com',
  trailingSlash: 'always',
  i18n: {
    defaultLocale: 'zh',
    locales: ['zh'],
    routing: { prefixDefaultLocale: false }
  },
  vite: {
    plugins: [tailwindcss()]
  }
});
