import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const productPage = readFileSync(join(ROOT, 'src', 'pages', 'drugs', '[slug].astro'), 'utf8');
const productIndex = readFileSync(join(ROOT, 'src', 'pages', 'drugs', 'index.astro'), 'utf8');
const companyPage = readFileSync(join(ROOT, 'src', 'pages', 'companies', '[slug].astro'), 'utf8');
const companyIndex = readFileSync(join(ROOT, 'src', 'pages', 'companies', 'index.astro'), 'utf8');
const companyContentDir = join(ROOT, 'src', 'content', 'companies');
const homePage = readFileSync(join(ROOT, 'src', 'pages', 'index.astro'), 'utf8');
const aboutPage = readFileSync(join(ROOT, 'src', 'pages', 'about.astro'), 'utf8');
const sitemapPage = readFileSync(join(ROOT, 'src', 'pages', 'sitemap.xml.ts'), 'utf8');
const robots = readFileSync(join(ROOT, 'public', 'robots.txt'), 'utf8');
const globalCss = readFileSync(join(ROOT, 'src', 'styles', 'global.css'), 'utf8');
const zh = readFileSync(join(ROOT, 'src', 'i18n', 'zh.json'), 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = globalCss.match(new RegExp(`${escaped}\\s*\\{[^}]+\\}`));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[0] ?? '';
};

describe('company to product public architecture', () => {
  test('uses the trade name as product identity and generic name as supporting information', () => {
    expect(productPage).toContain('const productName = productNameOf(data)');
    expect(productPage).toContain('<h1 class="drug__name">{productName}</h1>');
    expect(productPage).toContain("t(locale, 'drug.genericName')");
    expect(companyPage).toContain('productNameOf(drug.data)');
    expect(productIndex).toContain("groupByTherapeuticArea(await getCollection('drugs'))");
    expect(homePage).toContain('productNameOf(drug.data)');
  });

  test('presents the product-scoped mechanism before indications', () => {
    expect(productPage.indexOf('<MechanismLayers')).toBeLessThan(
      productPage.indexOf('<section class="drug__indications"'),
    );
    expect(productPage).toContain("scopeNote={t(locale, 'mechanism.productScope')}");
    expect(productPage).toContain('subjectLabel={productName}');
  });

  test('removes comparison-oriented related-product navigation without removing discovery', () => {
    expect(productPage).not.toContain('relatedDrugs');
    expect(productPage).not.toContain('related-drugs');
    expect(homePage).toContain('class="by-class"');
    expect(homePage).toContain('groupByTherapeuticArea');
    expect(zh).not.toContain('relatedTitle');
    expect(zh).not.toContain('relatedLead');
  });

  test('keeps product and reusable-mechanism scope text readable and non-overflowing', () => {
    expect(globalCss).toMatch(/\.drug__name,\s*\.drug-list__product\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(cssRule('.drug__generic-name')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(globalCss).toMatch(/\.mechanism__scope,\s*\.mechanism-media__scope\s*\{[^}]*line-height:\s*1\.65/);
  });

  test('scopes sticky navigation styles away from the product article header', () => {
    expect(productPage).toContain('<header class="drug__header">');
    expect(cssRule('body > header')).toMatch(/position:\s*sticky/);
    expect(globalCss).not.toMatch(/(?:^|\n)header\s*\{[^}]*position:\s*sticky/);
  });
});



describe('public discovery and terminology regression coverage', () => {
  test('keeps the public section name “热门药物” and prioritizes BeOne/百济神州 products', () => {
    expect(zh).toContain('"popularTitle": "热门药物"');
    expect(homePage).toContain("t(locale, 'home.popularTitle')");
    const beigeneFirst = homePage.indexOf("companyRefOf(drug) === 'beigene'");
    const otherCompanies = homePage.indexOf("companyRefOf(drug) !== 'beigene'");
    expect(beigeneFirst).toBeGreaterThan(-1);
    expect(beigeneFirst).toBeLessThan(otherCompanies);
  });

  test('uses the original mechanism anchors and omits homepage indication browsing', () => {
    expect(homePage).toContain('groupByTherapeuticArea(allDrugs)');
    expect(homePage).toContain('classAnchor(classGroup.drugClass)');
    expect(homePage).toContain('href={`/drugs/#${classAnchor(classGroup.drugClass)}`}');
    expect(productIndex).toContain('id={classAnchor(classGroup.drugClass)}');
    expect(productIndex).toContain('classGroup.drugs.map((drug)');
    expect(homePage).not.toContain("href={'/search/?q='");
    expect(homePage).not.toContain('homeIndicationGroups');
    expect(homePage).not.toContain('class="home-indications"');
    expect(homePage).not.toContain('firstIndicationOf');
    expect(homePage).not.toContain('drug.data.summary');
    expect(homePage).toContain('drug.data.mechanism.analogy ?? drug.data.mechanism.simple');
    expect(homePage).toContain("<h1 id=\"home-title\">{t(locale, 'site.title')}</h1>");
    expect(homePage).toContain('class="home-entries"');
    expect(homePage).toContain('href="/companies/"');
    expect(homePage).toContain('href="/about/"');
    expect(zh).not.toContain('indicationsTitle');
  });

  test('uses the fixed public headings and keeps mechanism content before indications', () => {
    expect(zh).toContain('"indications": "适应症"');
    expect(productPage.indexOf('<MechanismLayers')).toBeLessThan(
      productPage.indexOf("t(locale, 'drug.indicationsByRegion')"),
    );
    expect(productPage).toContain("const mechanismHeading = t(locale, 'mechanism.heading')");
    expect(productPage).toContain("const mediaHeading = t(locale, 'mechanism.mediaHeading')");
    expect(productPage).not.toContain('mechanism.productHeadingSuffix');
  });

  test('shows structured company names and only officially sourced company summaries', () => {
    expect(companyPage).toContain('<CompanyName data={data} />');
    expect(companyPage).toContain('data.summary && data.summarySource');
    expect(companyPage).toContain('data.summarySource.url');
    expect(companyPage).toContain("t(locale, 'company.website')");
    expect(companyPage).not.toContain('summaryRetrievedDate');
    expect(companyPage).not.toContain("t(locale, 'company.retrievedDate')");
    expect(companyPage).not.toContain('title={data.summarySource.title}');
    expect(companyIndex).toContain('company.data.summary && company.data.summarySource');
    expect(companyPage).toContain('const indicationGroup = drug.data.indications[0]');
    expect(companyPage).toContain("t(locale, 'drug.indicationExample')");
    expect(companyPage).toContain('indicationContext');
    expect(companyPage).not.toContain('flatMap((group) => group.items)[0]');
    expect(productIndex).toContain('productNameOf(drug.data)');
    expect(productIndex).not.toContain('drug.data.summary');
  });

  test('keeps About aligned with company-profile and publication rules', () => {
    const aboutStrings = (JSON.parse(zh) as { about: Record<string, string> }).about;
    expect(aboutPage).toContain("t(locale, 'about.companyProfilesTitle')");
    expect(aboutPage).toContain("t(locale, 'about.companyProfilesLead')");
    expect(aboutPage).toContain('companiesWithPublishedDrugs');
    expect(aboutPage).toContain('withPublishedDrugs.has(slugOf(company))');
    expect(aboutStrings.companyProfilesLead).toContain('公司网站');
    expect(aboutStrings.companyProfilesLead).toContain('无法核验公司介绍页时，本站不展示简介');
    expect(aboutStrings.guideCitations).toBe('参考来源：产品页列出所用资料链接，便于逐条核对。');
    expect(aboutStrings.guideAnalogy).toMatch(/^一句话比喻：/);
    expect(aboutStrings.guideTarget).toMatch(/^作用靶点：/);
    expect(aboutStrings.methodPoint1).toContain('部分既有记录仍在逐步拆分');
    expect(aboutStrings.methodPoint3).toContain('页面内容不用于产品横向优劣');
    expect(aboutStrings.methodPoint4).toContain('部分既有内容仍在持续复核和更新');
    expect(aboutStrings.sourcesLead).toContain('目前至少列出两份相互独立的资料');
    expect(aboutStrings.sourcesLead).not.toContain('两条相互独立的权威来源');
    expect(Object.values(aboutStrings).join('\n')).not.toMatch(/官网来源|检索日期|门禁|草稿状态/);
  });

  test('keeps sitemap and robots aligned with every public route family', () => {
    expect(sitemapPage).toContain("const STATIC_PATHS = ['/', '/drugs/', '/companies/', '/about/', '/search/']");
    expect(sitemapPage).toContain('publishedDrugDetailPaths(drugs)');
    expect(sitemapPage).toContain('publishedCompanyDetailPaths(companies, drugs)');
    expect(robots).toContain('Sitemap: https://dongyaojun.com/sitemap.xml');
  });

  test('records an official profile source for every verified company summary', () => {
    const profiles = readdirSync(companyContentDir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => ({ file, content: readFileSync(join(companyContentDir, file), 'utf8') }));
    const summaryProfiles = profiles.filter(({ content }) => /^summary: /m.test(content));
    const identityOnly = profiles
      .filter(({ content }) => !/^summary: /m.test(content))
      .map(({ file }) => file);
    const withoutSource = summaryProfiles
      .filter(({ content }) => !content.includes('summarySource:'))
      .map(({ file }) => file);
    expect(profiles).toHaveLength(103);
    expect(summaryProfiles).toHaveLength(101);
    expect(identityOnly).toEqual(['major-pharmaceuticals.md', 'thea.md']);
    expect(withoutSource).toEqual(['cr-pharma.md']);
    for (const { content } of summaryProfiles.filter(({ file }) => file !== 'cr-pharma.md')) {
      expect(content).toMatch(/^summary: /m);
      expect(content.match(/^summary: (.+)$/m)?.[1] ?? '').not.toMatch(/官网|网站(?:显示|包括|列出)|栏目/);
      expect(content).toMatch(/summarySource:\s*\r?\n  title: .+\r?\n  url: https?:\/\//);
      expect(content).toContain('retrievedDate: 2026-08-08');
    }
  });

  test('supports query-string search and keeps accessibility helpers operational', () => {
    const search = readFileSync(join(ROOT, 'src', 'components', 'Search.astro'), 'utf8');
    const layout = readFileSync(join(ROOT, 'src', 'layouts', 'BaseLayout.astro'), 'utf8');
    expect(search).toContain("new URLSearchParams(window.location.search).get('q')");
    expect(search).toContain('clear_search:');
    expect(layout).toContain('aria-current={isCurrentNav');
    expect(cssRule('.sr-only')).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(cssRule('.skip-link')).toMatch(/translateY\(calc\(-100% - 1rem\)\)/);
    expect(cssRule('.skip-link:focus-visible')).toMatch(/translateY\(1rem\)/);
  });
});