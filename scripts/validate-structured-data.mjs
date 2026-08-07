import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.html')) files.push(path);
  }
}
function typesIn(value, out = []) {
  if (Array.isArray(value)) value.forEach((item) => typesIn(item, out));
  else if (value && typeof value === 'object') {
    const type = value['@type'];
    if (Array.isArray(type)) out.push(...type);
    else if (typeof type === 'string') out.push(type);
    Object.values(value).forEach((item) => typesIn(item, out));
  }
  return out;
}

walk(root);
const errors = [];
let drugPages = 0;
for (const file of files) {
  const rel = relative(root, file).replaceAll('\\', '/');
  const html = readFileSync(file, 'utf8');
  const payloads = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  if (payloads.length !== 1) { errors.push(`${rel}: expected one JSON-LD script`); continue; }
  let data;
  try { data = JSON.parse(payloads[0][1]); } catch { errors.push(`${rel}: invalid JSON-LD`); continue; }
  const nodes = Array.isArray(data['@graph']) ? data['@graph'] : [data];
  const types = typesIn(data);
  const site = nodes.find((node) => node['@type'] === 'WebSite');
  if (site?.['@id'] !== 'https://dongyaojun.com/#website') errors.push(`${rel}: unstable WebSite @id`);
  if (types.includes('Product') || types.includes('Drug')) errors.push(`${rel}: Product/Drug type must not be emitted`);

  if (!/^drugs\/[^/]+\/index\.html$/.test(rel)) continue;
  drugPages += 1;
  const page = nodes.find((node) => node['@type'] === 'MedicalWebPage');
  const crumbs = nodes.find((node) => node['@type'] === 'BreadcrumbList');
  const expectedUrl = `https://dongyaojun.com/${rel.replace(/index\.html$/, '')}`;
  if (!page || !crumbs) errors.push(`${rel}: missing MedicalWebPage or BreadcrumbList`);
  if (page?.about?.['@type'] !== 'Thing') errors.push(`${rel}: MedicalWebPage.about must be Thing`);
  if (page?.url !== expectedUrl || page?.['@id'] !== `${expectedUrl}#webpage`) {
    errors.push(`${rel}: page URL/@id does not match generated path`);
  }
  const finalCrumb = crumbs?.itemListElement?.at?.(-1)?.item;
  if (finalCrumb !== expectedUrl) errors.push(`${rel}: final breadcrumb URL differs from page URL`);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  if (canonical !== expectedUrl) errors.push(`${rel}: canonical URL differs from generated path`);
}
if (drugPages === 0) errors.push('no generated drug pages found');
if (errors.length) throw new Error(`Structured data validation failed:\n- ${errors.join('\n- ')}`);
console.log(`Structured data passed: ${drugPages} drug pages use MedicalWebPage without Product/Drug.`);