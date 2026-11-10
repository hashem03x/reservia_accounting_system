const { test } = require('node:test');
const assert = require('node:assert/strict');
const seo = require('../../utils/website/seoResolver');

// Website Management - the pure SEO resolver (utils/website/seoResolver.js): canonical, hreflang,
// robots, Arabic-default x-default, generated-but-never-stored defaults, breadcrumbs, warnings.

const ORIGIN = 'https://reservia-energy.com';
const SETTINGS = {
  siteNameEn: 'Reservia',
  siteNameAr: 'ريزيرفيا',
  defaultLocale: 'ar',
  enabledLocales: ['ar', 'en'],
  titleTemplateEn: '%s | Reservia',
  titleTemplateAr: '%s | ريزيرفيا',
  publicSiteUrl: ORIGIN,
};

const page = (over = {}) => ({
  slug: 'about',
  path: '/about',
  pageType: 'managed',
  isHomePage: false,
  parentSlug: null,
  locales: ['ar', 'en'],
  seo: { titleEn: 'About us', titleAr: 'من نحن', descriptionEn: 'Reservia is an Egyptian solar and storage EPC company in Cairo.', descriptionAr: 'ريزيرفيا شركة مصرية للطاقة الشمسية والتخزين مقرها القاهرة، تصمم وتركب وتصون الأنظمة.' },
  sections: [],
  ...over,
});

const one = (p, settings = SETTINGS, others = []) => seo.resolveSite([...others, p], settings).pages.find(r => r.slug === p.slug);

test('URLs: language-prefixed, no trailing slash, home is /ar and /en', () => {
  assert.equal(seo.localeUrl(ORIGIN, 'ar', '/'), `${ORIGIN}/ar`);
  assert.equal(seo.localeUrl(`${ORIGIN}/`, 'en', '/services/'), `${ORIGIN}/en/services`);
  assert.equal(seo.normalizePath('about/'), '/about');
});

test('canonical: self-referencing by default, per language', () => {
  const r = one(page());
  assert.equal(r.seo.ar.canonical, `${ORIGIN}/ar/about`);
  assert.equal(r.seo.en.canonical, `${ORIGIN}/en/about`);
  assert.ok(!r.seo.ar.warnings.includes('canonical_overridden'));
});

test('canonical: an override is honoured (absolute or site path); staff paths and protocol-relative URLs are ignored', () => {
  assert.equal(one(page({ seo: { ...page().seo, canonicalEn: '/services' } })).seo.en.canonical, `${ORIGIN}/en/services`);
  assert.equal(one(page({ seo: { ...page().seo, canonicalEn: 'https://other.example.com/x/' } })).seo.en.canonical, 'https://other.example.com/x');
  assert.equal(one(page({ seo: { ...page().seo, canonicalEn: '/admin/login' } })).seo.en.canonical, `${ORIGIN}/en/about`);
  assert.equal(one(page({ seo: { ...page().seo, canonicalEn: '//evil.example.com' } })).seo.en.canonical, `${ORIGIN}/en/about`);
  assert.equal(seo.resolveCanonicalOverride('http://insecure.example.com', ORIGIN, 'en'), '');
});

test('hreflang: reciprocal ar/en alternates with x-default pointing at ARABIC (the default language)', () => {
  const r = one(page());
  const expected = [
    { hreflang: 'ar', href: `${ORIGIN}/ar/about` },
    { hreflang: 'en', href: `${ORIGIN}/en/about` },
    { hreflang: 'x-default', href: `${ORIGIN}/ar/about` },
  ];
  assert.deepEqual(r.seo.ar.alternates, expected);
  assert.deepEqual(r.seo.en.alternates, expected, 'every language version lists the same set');
});

test('hreflang: x-default follows the site setting when it is changed to English', () => {
  const r = one(page(), { ...SETTINGS, defaultLocale: 'en' });
  assert.equal(r.seo.ar.alternates.find(a => a.hreflang === 'x-default').href, `${ORIGIN}/en/about`);
});

test('hreflang: a single-language page declares none, and has no other language version at all', () => {
  const r = one(page({ locales: ['ar'] }));
  assert.deepEqual(r.locales, ['ar']);
  assert.deepEqual(r.seo.ar.alternates, []);
  assert.equal(r.seo.en, undefined);
});

test('hreflang: a language disabled site-wide is never emitted', () => {
  const r = one(page(), { ...SETTINGS, enabledLocales: ['ar'] });
  assert.deepEqual(r.locales, ['ar']);
  assert.deepEqual(r.seo.ar.alternates, []);
});

test('hreflang: noindex pages and pages canonicalised elsewhere declare none', () => {
  assert.deepEqual(one(page({ seo: { ...page().seo, noindex: true } })).seo.ar.alternates, []);
  assert.deepEqual(one(page({ seo: { ...page().seo, canonicalAr: '/services' } })).seo.ar.alternates, []);
});

test('robots: index,follow by default; noindex / nofollow flags; staff paths are always noindex', () => {
  assert.equal(one(page()).seo.ar.robots, 'index,follow');
  assert.equal(one(page({ seo: { ...page().seo, noindex: true, nofollow: true } })).seo.ar.robots, 'noindex,nofollow');
  assert.equal(one(page({ path: '/admin' })).seo.ar.robots, 'noindex,follow');
});

test('title: the template is applied; the home page defaults to the site name', () => {
  assert.equal(one(page()).seo.en.title, 'About us | Reservia');
  assert.equal(one(page()).seo.ar.title, 'من نحن | ريزيرفيا');
  const home = page({ slug: 'home', path: '/', isHomePage: true, seo: {}, sections: [{ type: 'hero', content: { headingAr: 'مرحبا', subheadingAr: 'نص' } }] });
  assert.equal(one(home).seo.ar.title, 'ريزيرفيا');
});

test('defaults: a managed page without typed SEO derives title/description from visible content only', () => {
  const p = page({
    seo: {},
    sections: [
      { type: 'hero', isVisible: false, content: { headingEn: 'Hidden', subheadingEn: 'Hidden text' } },
      { type: 'hero', content: { headingEn: 'Solar for farms', subheadingEn: 'Replace diesel pumping with a solar system sized for your well and crops.' } },
    ],
  });
  const r = one(p).seo.en;
  assert.equal(r.title, 'Solar for farms | Reservia');
  assert.equal(r.titleSource, 'content');
  assert.equal(r.descriptionSource, 'content');
  assert.match(r.description, /^Replace diesel/);
  assert.ok(r.warnings.includes('title_generated'));
  assert.deepEqual(p.seo, {}, 'nothing is written back into the page');
});

test('defaults: a long body is summarised at a word boundary within the limit', () => {
  const long = 'word '.repeat(80);
  const s = seo.summarize(long, 160);
  assert.ok(s.length <= 160);
  assert.ok(s.endsWith('…'));
  assert.ok(!s.includes('wor…'));
});

test('defaults: a LEGACY page never derives anything - empty fields mean "keep the website\'s own text"', () => {
  const r = one(page({ pageType: 'legacy', seo: { titleAr: 'من نحن' } }));
  assert.equal(r.seo.ar.title, 'من نحن | ريزيرفيا');
  assert.equal(r.seo.en.title, '');
  assert.equal(r.seo.en.titleSource, 'website');
  assert.equal(r.seo.en.descriptionSource, 'website');
  assert.ok(!r.seo.en.warnings.includes('missing_title'));
  assert.deepEqual(seo.publishProblems(page({ pageType: 'legacy', seo: {} }), [], SETTINGS), []);
});

test('publishProblems: names each missing language and field', () => {
  const problems = seo.publishProblems(page({ seo: { titleEn: 'x', descriptionEn: 'y' } }), [], SETTINGS);
  assert.deepEqual(problems, ['Arabic SEO title (or a heading in the page content)', 'Arabic meta description (or descriptive text in the page content)']);
  assert.deepEqual(seo.publishProblems(page({ locales: ['en'], seo: { titleEn: 'x', descriptionEn: 'y' } }), [], SETTINGS), []);
});

test('warnings: too long / too short / duplicates among indexable pages', () => {
  const a = page({ slug: 'a', path: '/a', seo: { ...page().seo, titleEn: 'A very long page title that keeps going well past sixty chars' } });
  const b = page({ slug: 'b', path: '/b', seo: { ...page().seo, descriptionEn: 'Short.' } });
  const site = seo.resolveSite([a, b], SETTINGS);
  const [ra, rb] = site.pages;
  assert.ok(ra.seo.en.warnings.includes('title_too_long'));
  assert.ok(rb.seo.en.warnings.includes('description_too_short'));
  assert.ok(ra.seo.ar.warnings.includes('duplicate_title'), 'same Arabic title on two indexable pages');
  // A noindex duplicate is not a duplicate for search purposes.
  const c = page({ slug: 'c', path: '/c', seo: { ...page().seo, noindex: true } });
  const site2 = seo.resolveSite([page({ slug: 'd', path: '/d' }), c], SETTINGS);
  assert.ok(!site2.pages[0].seo.ar.warnings.includes('duplicate_title'));
});

test('breadcrumbs: Home first, then the parent chain; custom labels; hidden on the home page or when switched off', () => {
  const services = page({ slug: 'industrial', path: '/industrial', seo: { ...page().seo, titleEn: 'Industrial', titleAr: 'الصناعة', breadcrumbLabelAr: 'المصانع' } });
  const child = page({ slug: 'oil-gas', path: '/oil-gas', parentSlug: 'industrial', seo: { ...page().seo, titleEn: 'Oil and gas', titleAr: 'البترول' } });
  const r = one(child, SETTINGS, [services]);
  assert.deepEqual(
    r.seo.ar.breadcrumbs.map(c => [c.name, c.url]),
    [
      ['الرئيسية', `${ORIGIN}/ar`],
      ['المصانع', `${ORIGIN}/ar/industrial`],
      ['البترول', `${ORIGIN}/ar/oil-gas`],
    ],
  );
  assert.deepEqual(one(page({ isHomePage: true, path: '/' })).seo.ar.breadcrumbs, []);
  assert.deepEqual(one(page({ seo: { ...page().seo, showBreadcrumbs: false } })).seo.ar.breadcrumbs, []);
});

test('breadcrumbs: an ancestor that is not published in this language is skipped, never linked', () => {
  const parent = page({ slug: 'agri', path: '/agriculture', locales: ['en'] });
  const child = page({ slug: 'guide', path: '/solar-irrigation-guide', parentSlug: 'agri', locales: ['ar'] });
  const crumbs = one(child, SETTINGS, [parent]).seo.ar.breadcrumbs;
  assert.deepEqual(crumbs.map(c => c.url), [`${ORIGIN}/ar`, `${ORIGIN}/ar/solar-irrigation-guide`]);
});

test('resolveDraft: the draft replaces its own published version and reports publish problems', () => {
  const live = page({ seo: { ...page().seo, titleEn: 'Live title' } });
  const draft = page({ seo: { titleEn: 'Draft title', descriptionEn: 'D' } });
  const r = seo.resolveDraft(draft, [live], SETTINGS);
  assert.equal(r.seo.en.title, 'Draft title | Reservia');
  assert.equal(r.problems.length, 2, 'Arabic title and description missing');
});

test('open graph / twitter: fall back to the SEO title/description and the site default image', () => {
  const r = one(page(), { ...SETTINGS, defaultOgImage: { url: 'https://cdn.example.com/og.jpg' }, twitterHandle: 'reservia' }).seo.en;
  assert.equal(r.openGraph.title, 'About us | Reservia');
  assert.equal(r.openGraph.image, 'https://cdn.example.com/og.jpg');
  assert.equal(r.openGraph.locale, 'en_US');
  assert.equal(r.twitter.card, 'summary_large_image');
  assert.equal(r.twitter.site, '@reservia');
});

test('concurrent resolutions do not leak state into each other', () => {
  const a = seo.resolveSite([page({ slug: 'x', path: '/x', locales: ['en'] })], SETTINGS);
  const child = page({ slug: 'y', path: '/y', parentSlug: 'x', locales: ['ar'] });
  const b = seo.resolveSite([page({ slug: 'x', path: '/x', locales: ['ar', 'en'] }), child], SETTINGS);
  assert.equal(a.pages[0].locales.length, 1);
  assert.equal(b.pages[1].seo.ar.breadcrumbs.length, 3, 'x is available in Arabic in THIS site');
});
