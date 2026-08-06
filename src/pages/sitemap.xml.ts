import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { publishedDrugDetailPaths, publishedCompanyDetailPaths } from '../lib/catalog';

// Static routes that always exist. Trailing slashes match the canonical URLs
// emitted by BaseLayout (Astro builds directory-style pages).
const STATIC_PATHS = ['/', '/drugs/', '/companies/', '/about/', '/search/'];

export async function GET(context: APIContext) {
  const origin = (context.site?.href ?? 'https://pharmasimple.matata.fun/').replace(/\/+$/, '');
  const drugs = await getCollection('drugs');
  const companies = await getCollection('companies');

  const paths = [
    ...STATIC_PATHS,
    ...publishedDrugDetailPaths(drugs).map((p) => `/drugs/${p.params.slug}/`),
    ...publishedCompanyDetailPaths(companies, drugs).map((p) => `/companies/${p.params.slug}/`),
  ];

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths.map((p) => `  <url><loc>${origin}${p}</loc></url>`).join('\n') +
    '\n</urlset>\n';

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
