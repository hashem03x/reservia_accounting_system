const asyncHandler = require('express-async-handler');
const WebsiteCustomCode = require('../../models/website/websiteCustomCodeModel');
const WebsiteIntegration = require('../../models/website/websiteIntegrationModel');
const WebsitePage = require('../../models/website/websitePageModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { logWebsiteActivity } = require('../../utils/website/activityLog');
const { validateCustomCode } = require('../../utils/website/customCode');

// Website Management - custom code snippets (HTML / CSS / JavaScript) for the PUBLIC website.
// Administrator-only (`code.manage`) for every operation, enforced by the route. The dashboard
// shows code as text in an editor - it never renders or runs it. Every change is audited with
// the full before/after code (websiteActivityLogModel.js).

const SAFE_FIELDS = ['name', 'description', 'kind', 'placement', 'scope', 'page', 'code', 'isEnabled', 'sortOrder'];

async function integrationsDoc() {
  return WebsiteIntegration.findById(WebsiteIntegration.SINGLETON_ID).lean();
}

async function checkPage(scope, page) {
  if (scope !== 'page') return null;
  if (!page) throw new ApiError('Choose the page this snippet belongs to.', 400);
  const exists = await WebsitePage.exists({ _id: page, isActive: true });
  if (!exists) throw new ApiError('The selected page does not exist.', 400);
  return page;
}

const listCustomCode = asyncHandler(async (req, res) => {
  const rows = await WebsiteCustomCode.find({}).sort({ placement: 1, sortOrder: 1, createdAt: 1 }).populate('page', 'slug titleEn titleAr').populate('updatedBy createdBy', 'name').lean();
  res.status(200).json(apiResponse('Custom code retrieved', true, rows));
});

/** POST /custom-code/validate - checks a snippet without saving it (the editor's "Check" button). */
const validateSnippet = asyncHandler(async (req, res) => {
  const { warnings } = validateCustomCode(req.body || {}, { integrations: await integrationsDoc() });
  res.status(200).json(apiResponse(warnings.length ? 'The code is valid, with warnings.' : 'The code is valid.', true, { valid: true, warnings }));
});

const createCustomCode = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const kind = body.kind || 'html';
  const placement = kind === 'css' ? 'head' : body.placement || (kind === 'js' ? 'body_end' : 'head');
  const { warnings } = validateCustomCode({ kind, placement, code: body.code }, { integrations: await integrationsDoc() });
  const scope = body.scope === 'page' ? 'page' : 'global';
  const page = await checkPage(scope, body.page);
  const name = String(body.name || '').trim();
  if (!name) throw new ApiError('Give the snippet a name so others know what it does.', 400);
  const doc = await WebsiteCustomCode.create({
    name: name.slice(0, 120),
    description: String(body.description || '').slice(0, 300),
    kind,
    placement,
    scope,
    page,
    code: body.code,
    isEnabled: body.isEnabled !== false,
    sortOrder: Number.isInteger(body.sortOrder) ? body.sortOrder : 0,
    createdBy: req.user._id,
  });
  await logWebsiteActivity({ actor: req.user, action: 'customCode.create', targetType: 'WebsiteCustomCode', targetId: doc._id, targetLabel: doc.name, after: doc.toObject() });
  res.status(201).json(apiResponse('Custom code saved. It reaches the live website on the next update.', true, { ...doc.toObject(), warnings }));
});

const updateCustomCode = asyncHandler(async (req, res, next) => {
  const doc = await WebsiteCustomCode.findById(req.params.id);
  if (!doc) return next(new ApiError('No custom code found with that id', 404));
  const before = doc.toObject();
  const body = req.body || {};
  for (const key of SAFE_FIELDS) if (body[key] !== undefined) doc[key] = body[key];
  if (doc.kind === 'css') doc.placement = 'head';
  doc.scope = doc.scope === 'page' ? 'page' : 'global';
  if (doc.scope === 'global') doc.page = null;
  await checkPage(doc.scope, doc.page);
  if (!String(doc.name || '').trim()) throw new ApiError('Give the snippet a name so others know what it does.', 400);
  const { warnings } = validateCustomCode({ kind: doc.kind, placement: doc.placement, code: doc.code }, { integrations: await integrationsDoc() });
  doc.updatedBy = req.user._id;
  await doc.save();
  await logWebsiteActivity({ actor: req.user, action: 'customCode.update', targetType: 'WebsiteCustomCode', targetId: doc._id, targetLabel: doc.name, before, after: doc.toObject() });
  res.status(200).json(apiResponse('Custom code updated. It reaches the live website on the next update.', true, { ...doc.toObject(), warnings }));
});

const deleteCustomCode = asyncHandler(async (req, res, next) => {
  const doc = await WebsiteCustomCode.findById(req.params.id);
  if (!doc) return next(new ApiError('No custom code found with that id', 404));
  await doc.deleteOne();
  await logWebsiteActivity({ actor: req.user, action: 'customCode.delete', targetType: 'WebsiteCustomCode', targetId: doc._id, targetLabel: doc.name, before: doc.toObject() });
  res.status(200).json(apiResponse('Custom code deleted', true, null));
});

module.exports = { listCustomCode, validateSnippet, createCustomCode, updateCustomCode, deleteCustomCode };
