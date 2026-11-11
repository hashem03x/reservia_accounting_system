// Website Management - the ONE place every SEO decision for the public website is made (SEO brief
// sections 2.1-2.6). Pure and DB-free: given the published pages, the site settings and a locale,
// it returns the final head metadata and breadcrumbs. Used by:
//   - the public site feed the website build reads (controller/website/publicSiteController.js),
//     so the website only RENDERS these values and never re-derives them;
//   - publish validation (a managed page can't go live without a usable title/description);
//   - the dashboard's live SEO preview (POST /website/pages/:id/seo-preview).
//
// Defaults are COMPUTED, never stored: an empty SEO field means "use the default", and nothing
// here writes back to the page - so an editor's own text is never overwritten automatically.
//
// Two kinds of page (websitePageModel.js#pageType):
//   - 'managed': the body is CMS sections, so a missing title/description is derived from the
//     page's own content (first heading, hero subheading...), then the site default.
//   - 'legacy':  the body is hand-written code in the website repo, which already carries its own
//     per-page title/description. An empty field here is NOT derived - it resolves to source
//     'website' with an empty value, and the website keeps its own text for that field. Only what
//     an editor actually typed overrides the code.

const LOCALES = ['ar', 'en'];
const SUFFIX = { ar: 'Ar', en: 'En' };
const HOME_LABEL = { ar: 'الرئيسية', en: 'Home' };
const TITLE_LIMIT = 60;
const DESCRIPTION_LIMIT = 160;
const DESCRIPTION_MIN = 50;
// Paths that must never be indexed or used as a canonical target.
const NON_PUBLIC_PATH = /^\/(admin|dashboard|api|website|portal|crm|commercial|login)(\/|$)/i;

const field = (obj, base, locale) => (obj ? String(obj[`${base}${SUFFIX[locale]}`] || '').trim() : '');
const isLegacy = page => page.pageType === 'legacy';

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

/**
 * An editor's canonical override, made absolute; '' when it is empty or unusable. A site path is
 * taken as language-agnostic ("/services") and prefixed with the page's own language, matching
 * how every URL on the site is built; an absolute https URL is used exactly as typed.
 */
function resolveCanonicalOverride(value, origin, locale) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https:\/\/[^/\s]+\.[^/\s]+/i.test(v)) return v.length > 8 ? v.replace(/(.)\/+$/, '$1') : v;
  if (v.startsWith('/') && !v.startsWith('//') && !NON_PUBLIC_PATH.test(v)) {
    const p = normalizePath(v);
    // Already language-prefixed ("/ar/services") - keep it.
    if (/^\/(ar|en)(\/|$)/.test(p)) return `${trimOrigin(origin)}${p}`;
    return locale ? localeUrl(origin, locale, p) : `${trimOrigin(origin)}${p}`;
  }
  return '';
}

/** Plain text, collapsed whitespace, cut at a word boundary with an ellipsis when too long. */
function summarize(text, limit) {
  const clean = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  const atWord = space > limit * 0.6 ? cut.slice(0, space) : cut;
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
  if (!title) return '';
  if (!template || !template.includes('%s')) return title;
  if (siteName && title.includes(siteName)) return title; // never "Reservia | Reservia"
  return template.replace('%s', title);
}

/** Which languages a page is available in: its own list AND the site's enabled languages. */
function pageLocales(page, settings) {
  const enabled = Array.isArray(settings?.enabledLocales) && settings.enabledLocales.length ? settings.enabledLocales : LOCALES;
  const own = Array.isArray(page.locales) && page.locales.length ? page.locales : LOCALES;
  return LOCALES.filter(l => own.includes(l) && enabled.includes(l));
}

/**
 * The plain (un-templated) title of a page in a language and where it came from.
 * @returns {{ value: string, source: 'custom'|'content'|'website'|'none' }}
 */
function baseTitle(page, sections, locale) {
  const custom = field(page.seo, 'title', locale);
  if (custom) return { value: custom, source: 'custom' };
  if (isLegacy(page)) return { value: '', source: 'website' };
  const heading = derivedHeading(sections, locale);
  if (heading) return { value: heading, source: 'content' };
  return { value: '', source: 'none' };
}

/** @returns {{ value: string, source: 'custom'|'content'|'site_default'|'website'|'none' }} */
function baseDescription(page, sections, settings, locale) {
  const custom = field(page.seo, 'description', locale);
  if (custom) return { value: custom, source: 'custom' };
  if (isLegacy(page)) return { value: '', source: 'website' };
  const fromContent = derivedDescription(sections, locale);
  if (fromContent) return { value: fromContent, source: 'content' };
  const fallback = field(settings, 'defaultDescription', locale);
  if (fallback) return { value: fallback, source: 'site_default' };
  return { value: '', source: 'none' };
}

/** Breadcrumb trail for a page from the parentSlug hierarchy, Home first (brief 2.6). */
function breadcrumbsFor(page, locale, ctx) {
  if (page.isHomePage || page.seo?.showBreadcrumbs === false) return [];
  const chain = [];
  const seen = new Set();
  let current = page;
  while (current && !seen.has(current.slug)) {
    seen.add(current.slug);
    chain.unshift(current);
    current = current.parentSlug ? ctx.bySlug.get(current.parentSlug) : null;
  }
  // An ancestor that is unpublished, or not available in this language, is left out: a
  // breadcrumb never links to a page a visitor can't open.
  const usable = chain.filter((p, i) => i === chain.length - 1 || (ctx.localesBySlug.get(p.slug) || []).includes(locale));
  const crumbs = [{ name: HOME_LABEL[locale], url: localeUrl(ctx.origin, locale, '/') }];
  for (const p of usable) {
    if (p.isHomePage) continue;
    // A legacy page's label is only ever the explicit breadcrumb label (empty = the website keeps
    // its own short navigation label - an SEO title is usually far too long for a breadcrumb).
    const label = field(p.seo, 'breadcrumbLabel', locale) || (isLegacy(p) ? '' : baseTitle(p, p.sections, locale).value);
    crumbs.push({ name: label, url: localeUrl(ctx.origin, locale, p.path), path: normalizePath(p.path) });
  }
  return crumbs;
}

/**
 * Resolves the head metadata of one page in one language.
 * @param {object} page - { slug, path, pageType, isHomePage, parentSlug, locales, seo, sections }
 *   where `seo`, `locales` and `sections` come from its PUBLISHED revision snapshot (or the draft,
 *   for the dashboard preview)
 * @param {object} ctx - { settings, origin, locales (this page's available locales), bySlug, localesBySlug }
 */
function resolvePageLocale(page, locale, ctx) {
  const { settings, origin } = ctx;
  const siteName = field(settings, 'siteName', locale);
  const title = baseTitle(page, page.sections, locale);
  const description = baseDescription(page, page.sections, settings, locale);
  // The home page's default title is the site name; any other page gets the title template.
  let fullTitle;
  if (page.isHomePage && title.source !== 'custom' && !isLegacy(page)) fullTitle = siteName || title.value;
  else fullTitle = applyTemplate(title.value, field(settings, 'titleTemplate', locale), siteName);

  const selfUrl = localeUrl(origin, locale, page.path);
  const canonical = resolveCanonicalOverride(field(page.seo, 'canonical', locale), origin, locale) || selfUrl;
  const noindex = !!page.seo?.noindex || NON_PUBLIC_PATH.test(normalizePath(page.path));
  const nofollow = !!page.seo?.nofollow;

  // hreflang alternates are filled in by resolveOne once every language version is known.
  const alternates = [];

  const ogImage = page.seo?.ogImage?.url || derivedImage(page.sections) || settings?.defaultOgImage?.url || null;
  const ogTitle = field(page.seo, 'ogTitle', locale) || fullTitle;
  const ogDescription = field(page.seo, 'ogDescription', locale) || description.value;

  const warnings = [];
  if (title.source === 'none') warnings.push('missing_title');
  else if (title.source === 'content') warnings.push('title_generated');
  if (fullTitle.length > TITLE_LIMIT) warnings.push('title_too_long');
  if (description.source === 'none') warnings.push('missing_description');
  else if (description.source === 'content' || description.source === 'site_default') warnings.push('description_generated');
  if (description.value && description.value.length > DESCRIPTION_LIMIT) warnings.push('description_too_long');
  if (description.value && description.value.length < DESCRIPTION_MIN) warnings.push('description_too_short');
  if (canonical !== selfUrl) warnings.push('canonical_overridden');
  if (noindex) warnings.push('noindex');

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
      type: 'website',
      title: ogTitle,
      description: ogDescription,
      image: ogImage,
      url: canonical,
      locale: locale === 'ar' ? 'ar_EG' : 'en_US',
      siteName,
    },
    twitter: {
      card: page.seo?.twitterCard || (ogImage ? 'summary_large_image' : 'summary'),
      // 'custom' = an editor chose the card; 'auto' = derived from whether there is an image.
      cardSource: page.seo?.twitterCard ? 'custom' : 'auto',
      title: ogTitle,
      description: ogDescription,
      image: ogImage,
      site: settings?.twitterHandle ? `@${String(settings.twitterHandle).replace(/^@/, '')}` : null,
    },
    breadcrumbs: breadcrumbsFor(page, locale, ctx),
    warnings,
  };
}

function buildContext(pages, settings, opts) {
  const origin = trimOrigin(opts.origin || settings?.publicSiteUrl || '');
  return {
    settings: settings || {},
    origin,
    bySlug: new Map(pages.map(p => [p.slug, p])),
    localesBySlug: new Map(pages.map(p => [p.slug, pageLocales(p, settings)])),
  };
}

function resolveOne(page, ctx) {
  const locales = ctx.localesBySlug.get(page.slug) || pageLocales(page, ctx.settings);
  const seo = {};
  for (const locale of locales) seo[locale] = resolvePageLocale(page, locale, { ...ctx, locales });

  // hreflang (brief 2.2): declared only between the language versions that are indexable AND
  // their own canonical - a noindex version, or one canonicalised to another URL, is never named
  // as an alternate (that would contradict its own robots/canonical), and lists none itself.
  // Reciprocal by construction: every eligible version lists exactly the same set. x-default ->
  // the site's default language when that version is eligible, else the first eligible one. One
  // eligible version (e.g. an Arabic-only page) declares none.
  const eligible = locales.filter(l => seo[l].indexable && seo[l].canonical === seo[l].url);
  if (eligible.length > 1) {
    const def = eligible.includes(ctx.settings?.defaultLocale) ? ctx.settings.defaultLocale : eligible[0];
    const set = [...eligible.map(l => ({ hreflang: l, href: seo[l].url })), { hreflang: 'x-default', href: seo[def].url }];
    for (const l of eligible) seo[l].alternates = set.map(a => ({ ...a }));
  }
  return { slug: page.slug, locales, seo };
}

/** Adds duplicate_title / duplicate_description among INDEXABLE pages in the same language (brief Test D). */
function flagDuplicates(resolved) {
  for (const locale of LOCALES) {
    for (const key of ['title', 'description']) {
      const counts = new Map();
      for (const r of resolved) {
        const s = r.seo[locale];
        if (s && s.indexable && s[key]) counts.set(s[key], (counts.get(s[key]) || 0) + 1);
      }
      for (const r of resolved) {
        const s = r.seo[locale];
        if (s && s.indexable && s[key] && counts.get(s[key]) > 1) s.warnings.push(`duplicate_${key}`);
      }
    }
  }
}

/**
 * Resolves every published page in every language it exists in, plus site-level checks.
 * @param {object[]} pages - published pages (see resolvePageLocale)
 * @param {object} settings - WebsiteSettings (plain object)
 * @param {object} [opts] - { origin } overrides settings.publicSiteUrl
 */
function resolveSite(pages, settings, opts = {}) {
  const ctx = buildContext(pages, settings, opts);
  const resolved = pages.map(page => resolveOne(page, ctx));
  flagDuplicates(resolved);
  return { origin: ctx.origin, pages: resolved };
}

/**
 * The dashboard preview: resolves ONE page's draft in the context of the published site (so its
 * breadcrumbs and duplicate checks are against what is actually live). The draft replaces the
 * page's own published version, if any.
 */
function resolveDraft(draft, publishedPages, settings, opts = {}) {
  const others = publishedPages.filter(p => p.slug !== draft.slug);
  const all = [...others, draft];
  const ctx = buildContext(all, settings, opts);
  const resolved = all.map(page => resolveOne(page, ctx));
  flagDuplicates(resolved);
  return { origin: ctx.origin, ...resolved[resolved.length - 1], problems: publishProblems(draft, draft.sections, settings) };
}

/**
 * Publish gate: every language a MANAGED page is available in needs a usable title AND
 * description - typed by the editor or derivable from the page's own content. A legacy page has
 * the website's own text to fall back on, so it has no such requirement. Returns problems, [] = OK.
 */
function publishProblems(page, sections, settings) {
  const problems = [];
  const locales = pageLocales(page, settings);
  if (!locales.length) problems.push('at least one language that is enabled for the site');
  for (const locale of locales) {
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
  resolveDraft,
  publishProblems,
};
