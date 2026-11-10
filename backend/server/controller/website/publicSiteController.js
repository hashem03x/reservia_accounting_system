const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const { loadSettings, loadPublishedPages } = require('../../services/website/publishedSite');
const { resolveSite } = require('../../utils/website/seoResolver');

// Website Management - the public, read-only feed the website build reads (Reservia_Website's
// scripts/build-site.mjs fetches it once per build; a Publish triggers that build through the
// deploy hook - services/website/deployService.js). No authentication, so it exposes ONLY what is
// already public on the live website:
//   - published pages from their frozen revision snapshots (never a draft, never an unpublished
//     or deleted page), with the head metadata already resolved by seoResolver.js;
//   - the public subset of the site settings (no staff ids, no integration secrets, no internal
//     contact fields that the website does not show).

const imageUrl = img => (img && typeof img === 'object' && img.url ? img.url : null);

function publicSettings(s) {
  return {
    siteNameEn: s.siteNameEn || '',
    siteNameAr: s.siteNameAr || '',
    taglineEn: s.taglineEn || '',
    taglineAr: s.taglineAr || '',
    defaultLocale: s.defaultLocale || 'ar',
    enabledLocales: Array.isArray(s.enabledLocales) && s.enabledLocales.length ? s.enabledLocales : ['ar', 'en'],
    publicSiteUrl: s.publicSiteUrl || '',
    twitterHandle: s.twitterHandle || '',
    logo: imageUrl(s.logo),
    defaultOgImage: imageUrl(s.defaultOgImage),
  };
}

const getPublicSite = asyncHandler(async (req, res) => {
  const [settings, pages] = await Promise.all([loadSettings(), loadPublishedPages()]);
  const site = resolveSite(pages, settings);
  const seoBySlug = new Map(site.pages.map(p => [p.slug, p]));

  const data = {
    // Bumped whenever the shape changes incompatibly, so an older website build can refuse a feed
    // it doesn't understand instead of rendering it wrongly.
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    origin: site.origin,
    settings: publicSettings(settings),
    pages: pages.map(p => {
      const resolved = seoBySlug.get(p.slug);
      return {
        slug: p.slug,
        path: p.path,
        pageType: p.pageType,
        isHomePage: p.isHomePage,
        parentSlug: p.parentSlug,
        locales: resolved.locales,
        publishedAt: p.publishedAt,
        seo: resolved.seo,
        // Legacy pages render their own hand-written body; only managed pages carry sections.
        sections: p.pageType === 'managed' ? p.sections : [],
      };
    }),
  };

  // Short shared cache: the build fetches this once; anything else reading it gets content at
  // most a minute old, and published data is public anyway.
  res.set('Cache-Control', 'public, max-age=60');
  res.status(200).json(apiResponse('Website content', true, data));
});

module.exports = { getPublicSite };
