'use strict';

// Website Management - blog post SEO resolution. A deliberately simpler sibling of
// utils/website/seoResolver.js (pages'): no section-derived title/heading, no breadcrumb chain, no
// cross-post duplicate-title audit - a blog post's title/excerpt are always directly authored
// fields, never derived from body content. Reuses the generic (not page-specific) helpers from
// seoResolver.js rather than duplicating them.
const { localeUrl, resolveCanonicalOverride, summarize, pageLocales, DESCRIPTION_LIMIT, TITLE_LIMIT, DESCRIPTION_MIN } = require('./seoResolver');

const SUFFIX = { ar: 'Ar', en: 'En' };
const field = (obj, base, locale) => (obj ? String(obj[`${base}${SUFFIX[locale]}`] || '').trim() : '');
const stripHtml = html => String(html || '').replace(/<[^>]*>/g, ' ');

function applyTemplate(title, template, siteName) {
  if (!title) return '';
  if (!template || !template.includes('%s')) return title;
  if (siteName && title.includes(siteName)) return title;
  return template.replace('%s', title);
}

/** @returns {{ value: string, source: 'custom'|'content' }} */
function baseTitle(post, locale) {
  const custom = field(post.seo, 'title', locale);
  if (custom) return { value: custom, source: 'custom' };
  return { value: field(post, 'title', locale), source: 'content' };
}

/** @returns {{ value: string, source: 'custom'|'content'|'none' }} */
function baseDescription(post, locale) {
  const custom = field(post.seo, 'description', locale);
  if (custom) return { value: custom, source: 'custom' };
  const excerpt = field(post, 'excerpt', locale);
  if (excerpt) return { value: excerpt, source: 'content' };
  const body = post[`body${SUFFIX[locale]}`];
  const fromBody = summarize(stripHtml(body), DESCRIPTION_LIMIT);
  if (fromBody) return { value: fromBody, source: 'content' };
  return { value: '', source: 'none' };
}

/** Resolves one blog post's head metadata for one language - the sibling of resolvePageLocale. */
function resolveBlogPostLocale(post, locale, { origin, settings }) {
  const siteName = field(settings, 'siteName', locale);
  const title = baseTitle(post, locale);
  const description = baseDescription(post, locale);
  const fullTitle = applyTemplate(title.value, field(settings, 'titleTemplate', locale), siteName);

  const selfUrl = localeUrl(origin, locale, `/blog/${post.slug}`);
  const canonical = resolveCanonicalOverride(field(post.seo, 'canonical', locale), origin, locale) || selfUrl;
  const noindex = !!post.seo?.noindex;
  const nofollow = !!post.seo?.nofollow;

  const ogImage = post.seo?.ogImage?.url || post.featuredImage?.url || settings?.defaultOgImage?.url || null;
  const ogTitle = field(post.seo, 'ogTitle', locale) || fullTitle;
  const ogDescription = field(post.seo, 'ogDescription', locale) || description.value;

  const warnings = [];
  if (title.source === 'content' && !title.value) warnings.push('missing_title');
  if (fullTitle.length > TITLE_LIMIT) warnings.push('title_too_long');
  if (description.source === 'none') warnings.push('missing_description');
  else if (description.source === 'content') warnings.push('description_generated');
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
    datePublished: post.publishedAt ? new Date(post.publishedAt).toISOString() : null,
    openGraph: {
      type: 'article',
      title: ogTitle,
      description: ogDescription,
      image: ogImage,
      url: canonical,
      locale: locale === 'ar' ? 'ar_EG' : 'en_US',
      siteName,
    },
    twitter: {
      card: post.seo?.twitterCard || (ogImage ? 'summary_large_image' : 'summary'),
      cardSource: post.seo?.twitterCard ? 'custom' : 'auto',
      title: ogTitle,
      description: ogDescription,
      image: ogImage,
      site: settings?.twitterHandle ? `@${String(settings.twitterHandle).replace(/^@/, '')}` : null,
    },
    warnings,
  };
}

/** Resolves a blog post in every language it's available in. @returns {{ar?, en?}} */
function resolveBlogPost(post, origin, settings) {
  const locales = pageLocales(post, settings);
  const out = {};
  for (const locale of locales) out[locale] = resolveBlogPostLocale(post, locale, { origin, settings });
  return out;
}

/** Publish gate: at least one enabled language needs a usable title AND description. */
function blogPublishProblems(post, settings) {
  const problems = [];
  const locales = pageLocales(post, settings);
  if (!locales.length) problems.push('at least one language that is enabled for the site');
  const usable = locales.some(l => baseTitle(post, l).value && baseDescription(post, l).value);
  if (locales.length && !usable) problems.push('a title and description (or body text) in at least one language');
  return problems;
}

module.exports = { resolveBlogPost, resolveBlogPostLocale, blogPublishProblems };
