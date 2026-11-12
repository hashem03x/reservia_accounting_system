const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { WebsiteVisual, WebsiteVisualRevision } = require('../../models/website/websiteVisualModel');
const { normalizeVisual, assertAllowedChanges, EMPTY } = require('../../utils/website/visualConfig');
const { createVisualToken, verifyVisualToken } = require('../../utils/website/previewToken');
const { logWebsiteActivity } = require('../../utils/website/activityLog');
const { triggerPublishDeploy } = require('../../services/website/deployService');
const { loadSettings } = require('../../services/website/publishedSite');

// Website Management - Visual Editor API. The draft is edited (autosave + manual saves with
// conflict detection), previewed on the real website through a signed token, published (the live
// website's build reads the published configuration from the public feed), and every save/publish
// is kept as a version that can be restored to the draft or rolled back to the live site.
// Capabilities (middleware/websiteAccess.js): view = open the editor read-only; edit = change
// content and element styles; design.manage = design tokens and global component styles;
// code.manage = custom CSS and Custom HTML elements; publish = publish and roll back.

const AUTOSAVE_KEEP = 20;
const AUTOSAVE_EVERY_MS = 2 * 60 * 1000;

const parse = json => {
  try {
    return json ? JSON.parse(json) : EMPTY();
  } catch {
    return EMPTY();
  }
};

async function getDoc(id) {
  const doc = await WebsiteVisual.findById(id).lean();
  return doc ? { ...doc, config: parse(doc.configJson) } : { _id: id, config: EMPTY(), rev: 0, updatedAt: null, publishedAt: null };
}

/** The configuration from a request: a JSON string (the dashboard - survives mongo-sanitize) or an object. */
function bodyConfig(body) {
  if (typeof body?.configJson === 'string') {
    if (body.configJson.length > 2 * 1024 * 1024) throw new ApiError('config: is too large.', 400);
    try {
      return JSON.parse(body.configJson);
    } catch {
      throw new ApiError('config: is not valid JSON.', 400);
    }
  }
  return body?.config;
}

const same = (a, b) => JSON.stringify(a || EMPTY()) === JSON.stringify(b || EMPTY());

async function inTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out;
  } finally {
    await session.endSession();
  }
}

const getDraft = asyncHandler(async (req, res) => {
  const [draft, published] = await Promise.all([getDoc('draft'), getDoc('published')]);
  res.status(200).json(
    apiResponse('Visual draft', true, {
      config: draft.config,
      rev: draft.rev,
      updatedAt: draft.updatedAt,
      published: { publishedAt: published.publishedAt, revision: published.revision || null },
      hasUnpublishedChanges: !same(draft.config, published.config),
    })
  );
});

/** PUT /website/visual/draft { config, baseRev, autosave?, label? } */
const saveDraft = asyncHandler(async (req, res, next) => {
  const { baseRev, autosave, label } = req.body || {};
  const config = bodyConfig(req.body);
  if (!Number.isInteger(baseRev)) return next(new ApiError('baseRev (the version this change is based on) is required.', 400));
  const current = await getDoc('draft');
  if (current.rev !== baseRev) {
    return res.status(409).json({ success: false, message: 'Someone else saved changes in the meantime. Reload to get the latest version before saving again.', data: { rev: current.rev, config: current.config } });
  }
  const clean = normalizeVisual(config);
  assertAllowedChanges(clean, current.config, req.websiteCapabilities);

  const nextRev = current.rev + 1;
  const result = await WebsiteVisual.updateOne({ _id: 'draft', rev: baseRev }, { $set: { configJson: JSON.stringify(clean), rev: nextRev, updatedBy: req.user._id } }, { upsert: baseRev === 0 }).catch(err => {
    if (err.code === 11000) return { matchedCount: 0, upsertedCount: 0, modifiedCount: 0 };
    throw err;
  });
  if (!result.matchedCount && !result.upsertedCount) {
    const latest = await getDoc('draft');
    return res.status(409).json({ success: false, message: 'Someone else saved changes in the meantime. Reload to get the latest version before saving again.', data: { rev: latest.rev, config: latest.config } });
  }

  if (autosave) {
    const last = await WebsiteVisualRevision.findOne({ kind: 'autosave' }).sort({ createdAt: -1 }).select('createdAt').lean();
    if (!last || Date.now() - new Date(last.createdAt).getTime() > AUTOSAVE_EVERY_MS) {
      await WebsiteVisualRevision.create({ kind: 'autosave', configJson: JSON.stringify(clean), rev: nextRev, createdBy: req.user._id });
      const old = await WebsiteVisualRevision.find({ kind: 'autosave' }).sort({ createdAt: -1 }).skip(AUTOSAVE_KEEP).select('_id').lean();
      if (old.length) await WebsiteVisualRevision.deleteMany({ _id: { $in: old.map(o => o._id) } });
    }
  } else {
    await WebsiteVisualRevision.create({ kind: 'save', label: typeof label === 'string' ? label.slice(0, 120) : '', configJson: JSON.stringify(clean), rev: nextRev, createdBy: req.user._id });
    await logWebsiteActivity({ actor: req.user, action: 'visual.save', targetType: 'WebsiteVisual', targetLabel: label || 'Visual design saved' });
  }
  const published = await getDoc('published');
  res.status(200).json(apiResponse(autosave ? 'Draft autosaved' : 'Draft saved', true, { rev: nextRev, config: clean, hasUnpublishedChanges: !same(clean, published.config) }));
});

const listRevisions = asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const rows = await WebsiteVisualRevision.find({}).select('-configJson').sort({ createdAt: -1 }).limit(limit).populate('createdBy', 'name').lean();
  const published = await getDoc('published');
  res.status(200).json(apiResponse('Versions', true, rows.map(r => ({ ...r, live: String(r._id) === String(published.revision) }))));
});

const getRevision = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return next(new ApiError('Invalid version id', 400));
  const r = await WebsiteVisualRevision.findById(req.params.id).populate('createdBy', 'name').lean();
  if (!r) return next(new ApiError('No version found with that id', 404));
  const { configJson, ...rest } = r;
  res.status(200).json(apiResponse('Version', true, { ...rest, config: parse(configJson) }));
});

/** Copies a version into the draft (nothing goes live). */
const restoreRevision = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return next(new ApiError('Invalid version id', 400));
  const r = await WebsiteVisualRevision.findById(req.params.id).lean();
  if (!r) return next(new ApiError('No version found with that id', 404));
  const current = await getDoc('draft');
  const clean = normalizeVisual(parse(r.configJson));
  assertAllowedChanges(clean, current.config, req.websiteCapabilities);
  const rev = current.rev + 1;
  await WebsiteVisual.updateOne({ _id: 'draft' }, { $set: { configJson: JSON.stringify(clean), rev, updatedBy: req.user._id } }, { upsert: true });
  await WebsiteVisualRevision.create({ kind: 'restore', label: `Restored version from ${new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' ')}`, configJson: JSON.stringify(clean), rev, createdBy: req.user._id });
  await logWebsiteActivity({ actor: req.user, action: 'visual.restore', targetType: 'WebsiteVisual', targetLabel: 'Version restored to the draft', after: { from: r._id } });
  res.status(200).json(apiResponse('Version restored to the draft. Publish to put it live.', true, { rev, config: clean }));
});

async function goLive(config, kind, label, user) {
  const revision = await inTransaction(async session => {
    const [rev] = await WebsiteVisualRevision.create([{ kind, label, configJson: JSON.stringify(config), createdBy: user._id }], { session });
    await WebsiteVisual.updateOne({ _id: 'published' }, { $set: { configJson: JSON.stringify(config), publishedAt: new Date(), publishedBy: user._id, revision: rev._id } }, { upsert: true, session });
    return rev;
  });
  const deploy = await triggerPublishDeploy();
  return { revision, deploy };
}

const publishDraft = asyncHandler(async (req, res) => {
  const draft = await getDoc('draft');
  const clean = normalizeVisual(draft.config);
  const { revision, deploy } = await goLive(clean, 'publish', typeof req.body?.label === 'string' ? req.body.label.slice(0, 120) : '', req.user);
  await logWebsiteActivity({ actor: req.user, action: 'visual.publish', targetType: 'WebsiteVisual', targetLabel: 'Visual design published', after: { revision: revision._id, draftRev: draft.rev } });
  res.status(200).json(apiResponse(deploy?.triggered ? 'Published. The live website is being rebuilt and shows the changes in a few minutes.' : 'Published. The live website rebuild is not connected (WEBSITE_PUBLISH_DEPLOY_HOOK_URL), so it updates on its next build.', true, { revision, deploy }));
});

/** Puts an earlier version back on the live website (the draft is not changed). */
const rollback = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return next(new ApiError('Invalid version id', 400));
  const r = await WebsiteVisualRevision.findById(req.params.id).lean();
  if (!r) return next(new ApiError('No version found with that id', 404));
  const clean = normalizeVisual(parse(r.configJson));
  const { revision, deploy } = await goLive(clean, 'rollback', `Rolled back to the version of ${new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' ')}`, req.user);
  await logWebsiteActivity({ actor: req.user, action: 'visual.rollback', targetType: 'WebsiteVisual', targetLabel: 'Live design rolled back', after: { to: r._id, revision: revision._id } });
  res.status(200).json(apiResponse('The live website is going back to that version.', true, { revision, deploy }));
});

const DEFAULT_DASHBOARD = 'https://reserviafrontend.vercel.app';
function dashboardOrigin(req) {
  const origin = (req.get('origin') || '').replace(/\/+$/, '');
  const allowed = [(process.env.FRONTEND_URL || DEFAULT_DASHBOARD).replace(/\/+$/, '')];
  if (process.env.NODE_ENV !== 'production') allowed.push('http://localhost:5173', 'http://127.0.0.1:5173');
  return allowed.includes(origin) ? origin : null;
}

const trimUrl = u => String(u || '').trim().replace(/\/+$/, '');
function editorSiteBase(settings) {
  return trimUrl(process.env.WEBSITE_EDITOR_URL || process.env.WEBSITE_PUBLIC_URL || settings.publicSiteUrl);
}
/** The website origins the editor canvas may run on (the dashboard's message check). */
function siteOrigins(settings) {
  const out = new Set();
  for (const raw of [process.env.WEBSITE_EDITOR_URL, process.env.WEBSITE_PUBLIC_URL, settings && settings.publicSiteUrl]) {
    let u;
    try {
      u = new URL(trimUrl(raw));
    } catch {
      continue;
    }
    out.add(u.origin);
    const host = u.hostname;
    if (host.includes('.') && !/^\d+(\.\d+){3}$/.test(host)) {
      const twin = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
      out.add(`${u.protocol}//${twin}${u.port ? `:${u.port}` : ''}`);
    }
  }
  return [...out];
}

/** POST /website/visual/preview-token { mode: 'edit'|'preview', path, lang } */
const createToken = asyncHandler(async (req, res, next) => {
  const mode = req.body?.mode === 'edit' ? 'edit' : 'preview';
  const origin = dashboardOrigin(req);
  if (mode === 'edit' && !origin) return next(new ApiError('The editor can only be opened from the Reservia dashboard.', 403));
  const lang = req.body?.lang === 'en' ? 'en' : 'ar';
  const path = typeof req.body?.path === 'string' && /^\/[a-z0-9\-/]*$/.test(req.body.path) ? req.body.path : '/';
  const { token, expiresAt } = createVisualToken({ userId: req.user._id, mode, origin });
  const settings = await loadSettings();
  // The canvas must be a website build that CONTAINS the editor runtime (this branch's build): a
  // dedicated WEBSITE_EDITOR_URL (e.g. the website's preview deployment) wins over the public address.
  const site = editorSiteBase(settings);
  const url = site ? `${site}/${lang}${path === '/' ? '' : path}?${mode === 'edit' ? '__ve' : '__vp'}=${encodeURIComponent(token)}` : null;
  res.status(200).json(
    apiResponse(url ? 'Preview link created' : 'Set the website address for the editor (WEBSITE_EDITOR_URL on the server, or Website Settings > public website address).', true, {
      token,
      expiresAt,
      url,
      siteOrigin: site || null,
      // Origins the canvas may legitimately answer from (the address itself and its www/apex twin).
      allowedOrigins: siteOrigins(settings),
      source: process.env.WEBSITE_EDITOR_URL ? 'WEBSITE_EDITOR_URL' : process.env.WEBSITE_PUBLIC_URL ? 'WEBSITE_PUBLIC_URL' : settings.publicSiteUrl ? 'Website Settings' : null,
    })
  );
});

/** GET /website/public/visual-preview/:token - the DRAFT configuration, for a valid signed token only. */
const getVisualPreview = asyncHandler(async (req, res, next) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.set('Referrer-Policy', 'no-referrer');
  const grant = verifyVisualToken(req.params.token);
  if (!grant) return next(new ApiError('This editor or preview link is invalid or has expired. Open it again from the dashboard.', 401));
  const draft = await getDoc('draft');
  res.status(200).json(apiResponse('Visual draft', true, { config: draft.config, rev: draft.rev, mode: grant.mode, editorOrigin: grant.mode === 'edit' ? grant.origin : null, expiresAt: new Date(grant.exp * 1000).toISOString() }));
});

/** The published configuration, for the public feed. */
async function publishedVisual() {
  const doc = await getDoc('published');
  return doc.config || EMPTY();
}

module.exports = { siteOrigins, getDraft, saveDraft, listRevisions, getRevision, restoreRevision, publishDraft, rollback, createToken, getVisualPreview, publishedVisual };
