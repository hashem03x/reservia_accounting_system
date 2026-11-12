const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const ApiError = require('../../utils/apiError');
const WebsitePage = require('../../models/website/websitePageModel');
const WebsiteSection = require('../../models/website/websiteSectionModel');
const WebsiteNavigation = require('../../models/website/websiteNavigationModel');
const WebsiteIntegration = require('../../models/website/websiteIntegrationModel');
const WebsiteCustomCode = require('../../models/website/websiteCustomCodeModel');
const { loadSettings, loadPublishedPages } = require('../../services/website/publishedSite');
const { resolveSite, resolveDraft, normalizePath } = require('../../utils/website/seoResolver');
const { publicNavigation } = require('../../utils/website/navigation');
const { publicIntegrations } = require('./integrationController');
const { verifyPreviewToken } = require('../../utils/website/previewToken');

// Website Management - the public, read-only feed the website build reads (Reservia_Website's
// scripts/build-site.mjs fetches it once per build; a Publish triggers that build through the
// deploy hook - services/website/deployService.js). No authentication, so it exposes ONLY what is
// already public on the live website:
//   - published pages from their frozen revision snapshots (never a draft, never an unpublished,
//     archived or deleted page), with the head metadata already resolved by seoResolver.js;
//   - the menus, with links to anything that is not published removed;
//   - the public subset of the site settings (no staff ids, no secrets; contact details only when
//     an administrator chose to show them on the website - `publishOrgContacts`);
//   - enabled tracking ids and verification codes (never the Conversions API token), and enabled
//     custom code (page-specific code only for published pages) - all of which is on the public
//     website anyway once built.
//
// The draft preview (GET /website/public/preview/:token) is the one exception to "published
// only": it requires a signed, unexpired, single-page token minted by an authenticated dashboard
// user (utils/website/previewToken.js), is never cached and is marked noindex.

const imageUrl = img => (img && typeof img === 'object' && img.url ? img.url : null);
const plain = v => (v && typeof v.toObject === 'function' ? v.toObject() : v || {});

function publicSettings(s) {
  const header = plain(s.header);
  const footer = plain(s.footer);
  const cookie = plain(s.cookieConsent);
  const robots = plain(s.robots);
  const out = {
    siteNameEn: s.siteNameEn || '',
    siteNameAr: s.siteNameAr || '',
    taglineEn: s.taglineEn || '',
    taglineAr: s.taglineAr || '',
    descriptionEn: s.descriptionEn || '',
    descriptionAr: s.descriptionAr || '',
    defaultLocale: s.defaultLocale || 'ar',
    enabledLocales: Array.isArray(s.enabledLocales) && s.enabledLocales.length ? s.enabledLocales : ['ar', 'en'],
    publicSiteUrl: s.publicSiteUrl || '',
    twitterHandle: s.twitterHandle || '',
    logo: imageUrl(s.logo),
    logoDark: imageUrl(s.logoDark),
    favicon: imageUrl(s.favicon),
    defaultOgImage: imageUrl(s.defaultOgImage),
    footerCopyrightEn: s.footerCopyrightEn || '',
    footerCopyrightAr: s.footerCopyrightAr || '',
    socialLinks: Object.fromEntries(Object.entries(plain(s.socialLinks)).filter(([, v]) => typeof v === 'string' && v)),
    businessHours: Array.isArray(s.businessHours) ? s.businessHours.map(r => ({ day: r.day, open: r.open || '', close: r.close || '', closed: !!r.closed })) : [],
    businessHoursNoteEn: s.businessHoursNoteEn || '',
    businessHoursNoteAr: s.businessHoursNoteAr || '',
    header: { showCta: header.showCta !== false, ctaLabelEn: header.ctaLabelEn || '', ctaLabelAr: header.ctaLabelAr || '', ctaHref: header.ctaHref || '', showPhone: header.showPhone !== false, sticky: header.sticky !== false },
    footer: { showSocial: footer.showSocial !== false, showContact: footer.showContact !== false, showNewsletter: !!footer.showNewsletter },
    cookieConsent: cookie.enabled
      ? { enabled: true, messageEn: cookie.messageEn || '', messageAr: cookie.messageAr || '', acceptLabelEn: cookie.acceptLabelEn || '', acceptLabelAr: cookie.acceptLabelAr || '', policyUrl: cookie.policyUrl || '', blockTrackingUntilConsent: cookie.blockTrackingUntilConsent !== false }
      : { enabled: false },
    robots: { discourageIndexing: !!robots.discourageIndexing, disallowPaths: Array.isArray(robots.disallowPaths) ? robots.disallowPaths : [] },
  };
  if (s.publishOrgContacts) {
    const c = plain(s.contact);
    // salesEmail is an internal routing address - never published.
    out.contact = { businessEmail: c.businessEmail || '', officePhone: c.officePhone || '', mobilePhone: c.mobilePhone || '', whatsappNumber: c.whatsappNumber || '', addressEn: c.addressEn || '', addressAr: c.addressAr || '', mapEmbedUrl: c.mapEmbedUrl || '' };
  }
  return out;
}

async function loadNavigation(publishedPages) {
  const nav = await WebsiteNavigation.findById(WebsiteNavigation.SINGLETON_ID).lean();
  return publicNavigation(nav || {}, new Map(publishedPages.map(p => [p.slug, p])));
}

async function loadCustomCode(publishedPages) {
  const rows = await WebsiteCustomCode.find({ isEnabled: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  const slugById = new Map(publishedPages.map(p => [String(p._id), p.slug]));
  return rows
    .filter(r => r.scope === 'global' || slugById.has(String(r.page)))
    .map(r => ({ id: String(r._id), name: r.name, kind: r.kind || 'html', placement: r.kind === 'css' ? 'head' : r.placement, scope: r.scope, pageSlug: r.scope === 'page' ? slugById.get(String(r.page)) : null, code: r.code }));
}

const pageOutput = (p, resolved) => ({
  slug: p.slug,
  path: p.path,
  pageType: p.pageType,
  isHomePage: p.isHomePage,
  parentSlug: p.parentSlug,
  titleEn: p.titleEn || '',
  titleAr: p.titleAr || '',
  layout: p.layout || 'default',
  locales: resolved.locales,
  publishedAt: p.publishedAt,
  seo: resolved.seo,
  // Legacy pages render their own hand-written body; only managed pages carry sections.
  sections: p.pageType === 'managed' ? p.sections : [],
});

const getPublicSite = asyncHandler(async (req, res) => {
  const [settings, pages, integrationsDoc] = await Promise.all([loadSettings(), loadPublishedPages(), WebsiteIntegration.findById(WebsiteIntegration.SINGLETON_ID).lean()]);
  const site = resolveSite(pages, settings);
  const seoBySlug = new Map(site.pages.map(p => [p.slug, p]));
  const [navigation, customCode] = await Promise.all([loadNavigation(pages), loadCustomCode(pages)]);

  const data = {
    // Bumped only when the shape changes INCOMPATIBLY - every field added since v1 is optional,
    // so an older website build keeps working on a newer feed.
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    origin: site.origin,
    settings: publicSettings(settings),
    navigation,
    integrations: publicIntegrations(integrationsDoc),
    customCode,
    pages: pages.map(p => pageOutput(p, seoBySlug.get(p.slug))),
  };

  // Short shared cache: the build fetches this once; anything else reading it gets content at
  // most a minute old, and published data is public anyway.
  res.set('Cache-Control', 'public, max-age=60');
  res.status(200).json(apiResponse('Website content', true, data));
});

/** GET /website/public/preview/:token - ONE page's current draft, for the signed preview link. */
const getPublicPreview = asyncHandler(async (req, res, next) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.set('Referrer-Policy', 'no-referrer');
  const grant = verifyPreviewToken(req.params.token);
  if (!grant) return next(new ApiError('This preview link is invalid or has expired. Open a new preview from the dashboard.', 401));

  const page = await WebsitePage.findById(grant.pageId).lean();
  if (!page || !page.isActive) return next(new ApiError('This page no longer exists.', 404));
  const sections = (await WebsiteSection.find({ page: page._id }).sort({ sortOrder: 1 }).lean())
    .filter(s => s.isVisible !== false)
    .map(s => ({ type: s.type, sortOrder: s.sortOrder, content: s.content || {}, settings: s.settings || {} }));
  const [settings, published] = await Promise.all([loadSettings(), loadPublishedPages()]);
  const draft = { ...page, path: normalizePath(page.path), sections };
  const resolved = resolveDraft(draft, published, settings);
  // The preview's menus are the live menus (plus this page, so its own links resolve).
  const navigation = await loadNavigation([...published.filter(p => p.slug !== page.slug), { ...draft }]);

  res.status(200).json(
    apiResponse('Draft preview', true, {
      schemaVersion: 1,
      preview: true,
      expiresAt: new Date(grant.exp * 1000).toISOString(),
      origin: resolved.origin,
      settings: publicSettings(settings),
      navigation,
      page: { ...pageOutput({ ...draft, publishedAt: page.publishedAt }, resolved), sections: page.pageType === 'managed' ? sections : [], status: page.status, problems: resolved.problems },
    })
  );
});

module.exports = { getPublicSite, getPublicPreview, publicSettings };
