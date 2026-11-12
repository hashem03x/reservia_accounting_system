const asyncHandler = require('express-async-handler');
const WebsitePage = require('../../models/website/websitePageModel');
const WebsiteSection = require('../../models/website/websiteSectionModel');
const WebsiteMedia = require('../../models/website/websiteMediaModel');
const WebsiteActivityLog = require('../../models/website/websiteActivityLogModel');
const WebsiteIntegration = require('../../models/website/websiteIntegrationModel');
const WebsiteCustomCode = require('../../models/website/websiteCustomCodeModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const ApiFeatures = require('../../utils/apiFeatures');
const { logWebsiteActivity } = require('../../utils/website/activityLog');
const { triggerPublishDeploy } = require('../../services/website/deployService');
const { loadSettings, loadDraftPages } = require('../../services/website/publishedSite');
const { publishProblems } = require('../../utils/website/seoResolver');
const { displayStatus } = require('./pageController');
const { buildPublicFeed } = require('./publicSiteController');

// Website Management - Overview (real numbers from the database, nothing sampled or invented),
// the activity log, and "Update live website" (rebuild for site-wide changes: settings,
// navigation, integrations, custom code - page content goes live through Publish).

const getOverview = asyncHandler(async (req, res) => {
  const pages = await WebsitePage.find({ isActive: true }).select('slug path titleEn titleAr status scheduledPublishAt publishedAt updatedAt pageType seo.noindex').lean();
  const counts = { total: pages.length, published: 0, draft: 0, scheduled: 0, archived: 0 };
  for (const p of pages) counts[displayStatus(p)] += 1;

  const [sectionCount, mediaAgg, recentActivity, integrations, customCodeCount, settings, drafts] = await Promise.all([
    WebsiteSection.countDocuments({ page: { $in: pages.map(p => p._id) } }),
    WebsiteMedia.aggregate([{ $match: { isActive: true } }, { $group: { _id: null, files: { $sum: 1 }, bytes: { $sum: { $ifNull: ['$bytes', 0] } } } }]),
    WebsiteActivityLog.find({}).sort({ createdAt: -1 }).limit(8).select('actorName action targetType targetLabel createdAt').lean(),
    WebsiteIntegration.findById(WebsiteIntegration.SINGLETON_ID).lean(),
    WebsiteCustomCode.countDocuments({ isEnabled: true }),
    loadSettings(),
    loadDraftPages(),
  ]);

  const lastPublished = pages.filter(p => p.publishedAt).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0] || null;
  const upcoming = pages.filter(p => p.scheduledPublishAt).sort((a, b) => new Date(a.scheduledPublishAt) - new Date(b.scheduledPublishAt)).slice(0, 5);
  const needsAttention = drafts
    .filter(d => d.status !== 'archived')
    .map(d => ({ pageId: d._id, slug: d.slug, problems: publishProblems(d, d.sections, settings) }))
    .filter(x => x.problems.length)
    .slice(0, 10);
  const enabledIntegrations = ['ga4', 'gtm', 'metaPixel', 'googleAds'].filter(k => integrations?.[k]?.enabled);

  res.status(200).json(
    apiResponse('Website overview', true, {
      pages: counts,
      sections: sectionCount,
      media: { files: mediaAgg[0]?.files || 0, bytes: mediaAgg[0]?.bytes || 0 },
      lastPublished: lastPublished ? { slug: lastPublished.slug, title: lastPublished.titleEn || lastPublished.titleAr || lastPublished.slug, at: lastPublished.publishedAt } : null,
      upcoming: upcoming.map(p => ({ pageId: p._id, slug: p.slug, title: p.titleEn || p.titleAr || p.slug, at: p.scheduledPublishAt })),
      recentlyEdited: pages.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5).map(p => ({ pageId: p._id, slug: p.slug, title: p.titleEn || p.titleAr || p.slug, updatedAt: p.updatedAt, status: displayStatus(p) })),
      needsAttention,
      recentActivity,
      integrations: { enabled: enabledIntegrations, customCodeSnippets: customCodeCount },
      site: {
        publicSiteUrl: settings.publicSiteUrl || '',
        languages: settings.enabledLocales || ['ar', 'en'],
        deployConfigured: !!process.env.WEBSITE_PUBLISH_DEPLOY_HOOK_URL,
        previewConfigured: !!(process.env.WEBSITE_PUBLIC_URL || settings.publicSiteUrl),
      },
    })
  );
});

// Values with code in them are only shown to administrators.
const SENSITIVE_TARGETS = new Set(['WebsiteCustomCode', 'WebsiteIntegration']);

// ?action= ?targetType= ?targetId= ?actor= ?from= ?to=
const getActivity = asyncHandler(async (req, res, next) => {
  const query = { ...(req.query || {}) };
  const filter = {};
  if (query.action) filter.action = String(query.action);
  if (query.targetType) filter.targetType = String(query.targetType);
  if (query.targetId) {
    if (!/^[a-f0-9]{24}$/i.test(String(query.targetId))) return next(new ApiError('Invalid target id', 400));
    filter.targetId = query.targetId;
  }
  if (query.actor && /^[a-f0-9]{24}$/i.test(String(query.actor))) filter.actor = query.actor;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from && !Number.isNaN(Date.parse(query.from))) filter.createdAt.$gte = new Date(query.from);
    if (query.to && !Number.isNaN(Date.parse(query.to))) filter.createdAt.$lte = new Date(query.to);
  }
  ['action', 'targetType', 'targetId', 'actor', 'from', 'to'].forEach(k => delete query[k]);
  const countDocuments = await WebsiteActivityLog.countDocuments(filter);
  const features = new ApiFeatures(WebsiteActivityLog.find(filter), query).paginate(countDocuments);
  const rows = await features.mongooseQuery.sort({ createdAt: -1 }).lean();
  const canSeeCode = (req.websiteCapabilities || []).includes('code.manage');
  const data = rows.map(r => (SENSITIVE_TARGETS.has(r.targetType) && !canSeeCode ? { ...r, before: null, after: null, redacted: true } : r));
  res.status(200).json({ results: data.length, paginationResult: features.paginationResult, data });
});

/** POST /website/deploy - rebuild the live website now (site-wide changes). */
const deployLiveSite = asyncHandler(async (req, res) => {
  const deploy = await triggerPublishDeploy();
  await logWebsiteActivity({ actor: req.user, action: 'deploy.publish', targetType: 'WebsiteSettings', targetLabel: 'Live website update' });
  const reasons = {
    not_configured: 'The live website rebuild is not connected yet (WEBSITE_PUBLISH_DEPLOY_HOOK_URL is not set on the server), so nothing was rebuilt. Your changes are saved.',
    request_failed: 'The website host could not be reached, so nothing was rebuilt. Your changes are saved - try again in a moment.',
  };
  const message = deploy?.triggered ? 'The live website is being updated - changes appear within a few minutes.' : reasons[deploy?.reason] || `The website host refused the rebuild (${deploy?.reason}). Your changes are saved.`;
  res.status(200).json(apiResponse(message, true, deploy));
});

// Actions that start a rebuild of the live website (services/website/deployService.js).
const REBUILD_ACTIONS = ['page.publish', 'page.unpublish', 'page.archive', 'page.delete', 'visual.publish', 'visual.rollback', 'deploy.publish', 'code.deploy'];
// How long a Vercel build normally takes, with margin; after this a missing update means it failed.
const REBUILD_GRACE_MS = 15 * 60 * 1000;

/** The build stamp the live website serves (written by the website's scripts/build-site.mjs). */
async function fetchLiveStamp(siteUrl) {
  let base;
  try {
    base = new URL(siteUrl);
  } catch {
    return { error: 'bad_url' };
  }
  if (!/^https?:$/.test(base.protocol)) return { error: 'bad_url' };
  try {
    const res = await fetch(new URL('/cms-build.json', base.origin), { cache: 'no-store', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (res.status === 404) return { error: 'no_stamp' };
    if (!res.ok) return { error: `http_${res.status}` };
    const body = await res.json().catch(() => null);
    return body && typeof body === 'object' ? { stamp: body } : { error: 'no_stamp' };
  } catch {
    return { error: 'unreachable' };
  }
}

/**
 * GET /website/live-status - is the live website built from what is published right now?
 * Compares the stamp of the live build (/cms-build.json: the hash of the CMS content it was built
 * from) with the hash of the current published content. A Deploy Hook only QUEUES a build; this is
 * how the dashboard learns whether that build actually went live (or failed, or never ran).
 */
const getLiveStatus = asyncHandler(async (req, res) => {
  const settings = await loadSettings();
  const siteUrl = String(process.env.WEBSITE_PUBLIC_URL || settings.publicSiteUrl || '').trim().replace(/\/+$/, '');
  const [feed, lastAction, lastPage] = await Promise.all([
    buildPublicFeed(),
    WebsiteActivityLog.findOne({ action: { $in: REBUILD_ACTIONS } }).sort({ createdAt: -1 }).select('createdAt').lean(),
    // Scheduled publishes go live without an activity entry; their publishedAt is the moment.
    WebsitePage.findOne({ isActive: true, publishedAt: { $ne: null } }).sort({ publishedAt: -1 }).select('publishedAt').lean(),
  ]);
  const times = [lastAction?.createdAt, lastPage?.publishedAt].filter(Boolean).map(t => new Date(t).getTime());
  const lastRequestedAt = times.length ? new Date(Math.max(...times)) : null;
  const out = { siteUrl: siteUrl || null, deployConfigured: !!process.env.WEBSITE_PUBLISH_DEPLOY_HOOK_URL, publishedHash: feed.contentHash, lastRequestedAt, liveHash: null, liveBuiltAt: null };

  if (!siteUrl) return res.status(200).json(apiResponse('Live website status', true, { ...out, state: 'not_configured' }));
  const { stamp, error } = await fetchLiveStamp(siteUrl);
  if (error) return res.status(200).json(apiResponse('Live website status', true, { ...out, state: error === 'no_stamp' ? 'no_stamp' : 'unreachable', detail: error }));

  out.liveHash = typeof stamp.contentHash === 'string' ? stamp.contentHash : null;
  out.liveBuiltAt = typeof stamp.builtAt === 'string' ? stamp.builtAt : null;
  let state;
  if (stamp.cms === false) state = 'no_cms';
  else if (out.liveHash && out.liveHash === feed.contentHash) state = 'up_to_date';
  else if (lastRequestedAt && Date.now() - lastRequestedAt.getTime() < REBUILD_GRACE_MS && out.deployConfigured) state = 'updating';
  else state = 'behind';
  res.status(200).json(apiResponse('Live website status', true, { ...out, state }));
});

module.exports = { getOverview, getActivity, deployLiveSite, getLiveStatus };
