// Website Management - the ONE place every SEO decision for the public website is made (SEO brief
// sections 2.1-2.6). Pure and DB-free: given the published pages, the site settings and a locale,
// it returns the final head metadata and breadcrumbs. Used by:
//   - the public site endpoint the website build reads (routes/website/publicRoute.js), so the
//     website only RENDERS these values and never re-derives them;
//   - publish validation (a page can't go live without a usable title/description per language);
//   - the dashboard's SEO preview (GET /website/pages/:id/seo-preview).
//
// Defaults are COMPUTED, never stored: an empty SEO field means "use the default", and nothing
// here writes back to the page - so an editor's own text is never overwritten automatically.

const LOCALES = ['ar', 'en'];
const SUFFIX = { ar: 'Ar', en: 'En' };
const HOME_LABEL = { ar: 'الرئيسية', en: 'Home' };
const TITLE_LIMIT = 60;
const DESCRIPTION_LIMIT = 160;
const DESCRIPTION_MIN = 50;
// Paths that must never be indexed or used as a canonical target.
const NON_PUBLIC_PATH = /^\/(admin|dashboard|api|website|portal|crm|commercial|login)(\/|$)/i;

const field = (obj, base, locale) => (obj ? String(obj[`${base}${SUFFIX[locale]}`] || '').trim() : '');

/** "/services/" -> "/services", "" -> "/" */
function normalizePath(path) {
  let p = String(path || '/').trim();
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
}

function trimOrigin(origin) {
  return String(origin || '').trim().replace(/\/+$/, '');
}

/** Absolute URL of a page in a language: https://site/ar, https://site/en/services */
function localeUrl(origin, locale, path) {
  const p = normalizePath(path);
  return `${trimOrigin(origin)}/${locale}${p === '/' ? '' : p}`;
}

/** An editor's canonical override, made absolute; '' when it is empty or unusable. */
function resolveCanonicalOverride(value, origin) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v.replace(/\/+$/, '') || v;
  if (v.startsWith('/') && !NON_PUBLIC_PATH.test(v)) return `${trimOrigin(origin)}${normalizePath(v)}`;
  return '';
}

/** Plain text, collapsed whitespace, cut at a word boundary with an ellipsis when too long. */
function summarize(text, limit) {
  const clean = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const atWord = cut.slice(0, cut.lastIndexOf(' ') > limit * 0.6 ? cut.lastIndexOf(' ') : cut.length);
  return `${atWord.replace(/[\s,.;:،-]+$/, '')}…`;
}

const visible = sections => (Array.isArray(sections) ? sections.filter(s => s && s.isVisible !== false) : []);

/** The page's main heading in a language - the first visible section with a heading. */
function derivedHeading(sections, locale) {
  for (const s of visible(sections)) {
    const h = field(s.content, 'heading', locale);
    if (h) return h;
  }
  return '';
}

/** A description from the page's own visible copy (hero subheading/body, then about body...). */
function derivedDescription(sections, locale) {
  for (const s of visible(sections)) {
    const c = s.content || {};
    const text = field(c, 'subheading', locale) || field(c, 'body', locale);
    if (text) return summarize(text, DESCRIPTION_LIMIT);
  }
  return '';
}

function derivedImage(sections) {
  for (const s of visible(sections)) {
    const img = s.content && s.content.image;
    if (img && typeof img === 'object' && img.url) return img.url;
  }
  return null;
}

function applyTemplate(title, template, siteName) {
  if (!title) return siteName || '';
  if (!template || !template.includes('%s')) return title;
  if (siteName && title.includes(siteName)) return title; // never "Reservia | Reservia"
  return template.replace('%s', title);
}

/** Which languages a published page is actually available in (page AND site enabled). */
function pageLocales(page, settings) {
  const enabled = Array.isArray(settings?.enabledLocales) && settings.enabledLocales.length ? settings.enabledLocales : LOCALES;
  const own = Array.isArray(page.locales) && page.locales.length ? page.locales : LOCALES;
  return LOCALES.filter(l => own.includes(l) && enabled.includes(l));
}

/**
 * The plain (un-templated) title of a page in a language and where it came from.
 * @returns {{ value: string, source: 'custom'|'content'|'none' }}
 */
function baseTitle(page, sections, locale) {
  const custom = field(page.seo, 'title', locale);
  if (custom) return { value: custom, source: 'custom' };
  const heading = derivedHeading(sections, locale);
  if (heading) return { value: heading, source: 'content' };
  return { value: '', source: 'none' };
}

function baseDescription(page, sections, settings, locale) {
  const custom = field(page.seo, 'description', locale);
  if (custom) return { value: custom, source: 'custom' };
  const fromContent = derivedDescription(sections, locale);
  if (fromContent) return { value: fromContent, source: 'content' };
  const fallback = field(settings, 'defaultDescription', locale);
  if (fallback) return { value: fallback, source: 'site_default' };
  return { value: '', source: 'none' };
}

/** Breadcrumb trail for a page from the parentSlug hierarchy, Home first (brief 2.6). */
function breadcrumbsFor(page, bySlug, origin, locale) {
  if (page.isHomePage || page.seo?.showBreadcrumbs === false) return [];
  const chain = [];
  const seen = new Set();
  let current = page;
  while (current && !seen.has(current.slug)) {
    seen.add(current.slug);
    chain.unshift(current);
    current = current.parentSlug ? bySlug.get(current.parentSlug) : null;
  }
  // A parent that is unpublished, or not available in this language, breaks the trail there:
  // a breadcrumb never links to a page a visitor can't open.
  const usable = chain.filter((p, i) => i === chain.length - 1 || pageLocalesCache.get(p.slug)?.includes(locale));
  const crumbs = [{ name: HOME_LABEL[locale], url: localeUrl(origin, locale, '/') }];
  for (const p of usable) {
    if (p.isHomePage) continue;
    const label = field(p.seo, 'breadcrumbLabel', locale) || baseTitle(p, p.sections, locale).value || p.slug;
    crumbs.push({ name: label, url: localeUrl(origin, locale, p.path) });
  }
  return crumbs;
}
// Populated per resolveSite call - which locales each slug is published in.
let pageLocalesCache = new Map();

/**
 * Resolves the head metadata of one page in one language.
 * @param {object} page - a published page: { slug, path, isHomePage, parentSlug, locales, seo, sections }
 *   where `seo` and `sections` come from its PUBLISHED revision snapshot
 * @param {object} ctx - { settings, origin, locales (this page's available locales), bySlug }
 */
function resolvePageLocale(page, locale, ctx) {
  const { settings, origin } = ctx;
  const siteName = field(settings, 'siteName', locale);
  const title = baseTitle(page, page.sections, locale);
  const description = baseDescription(page, page.sections, settings, locale);
  const fullTitle = page.isHomePage && title.source !== 'custom' ? siteName || title.value : applyTemplate(title.value, field(settings, 'titleTemplate', locale), siteName);

  const selfUrl = localeUrl(origin, locale, page.path);
  const canonical = resolveCanonicalOverride(field(page.seo, 'canonical', locale), origin) || selfUrl;
  const noindex = !!page.seo?.noindex || NON_PUBLIC_PATH.test(normalizePath(page.path));
  const nofollow = !!page.seo?.nofollow;

  // hreflang (brief 2.2): only between languages this page is actually published in, reciprocal by
  // construction (every version lists the same set), x-default -> the default-language version.
  // A single-language page declares none. A noindex page declares none either.
  let alternates = [];
  if (!noindex && ctx.locales.length > 1) {
    alternates = ctx.locales.map(l => ({ hreflang: l, href: localeUrl(origin, l, page.path) }));
    const def = ctx.locales.includes(settings?.defaultLocale) ? settings.defaultLocale : ctx.locales[0];
    alternates.push({ hreflang: 'x-default', href: localeUrl(origin, def, page.path) });
  }

  const ogImage = page.seo?.ogImage?.url || derivedImage(page.sections) || settings?.defaultOgImage?.url || null;
  const ogTitle = field(page.seo, 'ogTitle', locale) || fullTitle;
  const ogDescription = field(page.seo, 'ogDescription', locale) || description.value;

  const warnings = [];
  if (title.source === 'none') warnings.push('missing_title');
  else if (title.source !== 'custom') warnings.push('title_generated');
  if (fullTitle.length > TITLE_LIMIT) warnings.push('title_too_long');
  if (description.source === 'none') warnings.push('missing_description');
  else if (description.source !== 'custom') warnings.push('description_generated');
  if (description.value && description.value.length > DESCRIPTION_LIMIT) warnings.push('description_too_long');
  if (description.value && description.value.length < DESCRIPTION_MIN) warnings.push('description_too_short');
  if (canonical !== selfUrl) warnings.push('canonical_overridden');

  return {
    locale,
    url: selfUrl,
    title: fullTitle,
    titleSource: title.source,
    description: description.value,
    descriptionSource: description.source,
    canonical,
    robots: `${noindex ? 'noindex' : 'index'},${nofollow ? 'nofollow' : 'follow'}`,
    indexable: !noindex,
    alternates,
    openGraph: {
      type: page.isHomePage ? 'website' : 'website',
      title: ogTitle,
      description: ogDescription,
      image: ogImage,
      url: canonical,
      locale: locale === 'ar' ? 'ar_EG' : 'en_US',
      siteName,
    },
    twitter: {
      card: page.seo?.twitterCard || (ogImage ? 'summary_large_image' : 'summary'),
      title: ogTitle,
      description: ogDescription,
      image: ogImage,
      site: settings?.twitterHandle ? `@${String(settings.twitterHandle).replace(/^@/, '')}` : null,
    },
    breadcrumbs: breadcrumbsFor(page, ctx.bySlug, origin, locale),
    warnings,
  };
}

/**
 * Resolves every published page in every language it exists in, plus site-level checks (duplicate
 * titles/descriptions across pages - brief Test D).
 * @param {object[]} pages - published pages (see resolvePageLocale)
 * @param {object} settings - WebsiteSettings (plain object)
 * @param {object} [opts] - { origin } overrides settings.publicSiteUrl
 */
function resolveSite(pages, settings, opts = {}) {
  const origin = trimOrigin(opts.origin || settings?.publicSiteUrl || '');
  const bySlug = new Map(pages.map(p => [p.slug, p]));
  pageLocalesCache = new Map(pages.map(p => [p.slug, pageLocales(p, settings)]));

  const resolved = pages.map(page => {
    const locales = pageLocalesCache.get(page.slug);
    const seo = {};
    for (const locale of locales) seo[locale] = resolvePageLocale(page, locale, { settings, origin, locales, bySlug });
    return { slug: page.slug, locales, seo };
  });

  // Duplicate titles / descriptions among INDEXABLE pages in the same language.
  for (const locale of LOCALES) {
    for (const key of ['title', 'description']) {
      const counts = new Map();
      for (const r of resolved) {
        const s = r.seo[locale];
        if (s && s.indexable && s[key]) counts.set(s[key], (counts.get(s[key]) || 0) + 1);
      }
      for (const r of resolved) {
        const s = r.seo[locale];
        if (s && s.indexable && counts.get(s[key]) > 1) s.warnings.push(`duplicate_${key}`);
      }
    }
  }
  return { origin, pages: resolved };
}

/**
 * Publish gate: every language the page is published in needs a usable title AND description -
 * typed by the editor or derivable from the page's own content. Returns problems, [] = OK.
 */
function publishProblems(page, sections, settings) {
  const problems = [];
  for (const locale of pageLocales(page, settings)) {
    const label = locale === 'ar' ? 'Arabic' : 'English';
    if (baseTitle(page, sections, locale).source === 'none') problems.push(`${label} SEO title (or a heading in the page content)`);
    if (baseDescription(page, sections, settings, locale).source === 'none') problems.push(`${label} meta description (or descriptive text in the page content)`);
  }
  return problems;
}

module.exports = {
  LOCALES,
  TITLE_LIMIT,
  DESCRIPTION_LIMIT,
  DESCRIPTION_MIN,
  NON_PUBLIC_PATH,
  normalizePath,
  localeUrl,
  resolveCanonicalOverride,
  summarize,
  pageLocales,
  resolvePageLocale,
  resolveSite,
  publishProblems,
};
