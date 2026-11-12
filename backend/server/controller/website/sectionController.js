const asyncHandler = require('express-async-handler');
const WebsitePage = require('../../models/website/websitePageModel');
const WebsiteSection = require('../../models/website/websiteSectionModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { isSectionType, SECTION_TYPE_FIELDS, publicRegistry } = require('../../utils/website/sectionTypes');
const { validateContent: validateTypedContent, validateSettings } = require('../../utils/website/sectionValidation');
const { logWebsiteActivity } = require('../../utils/website/activityLog');

// Website Management - Sections, the page builder's real data. `content` is validated and
// normalized against utils/website/sectionTypes.js for the section's own `type`, `settings`
// (devices/background/spacing/alignment) by sectionValidation.js - a client can never send an
// arbitrary shape, an unsafe link, or (without the admin-only 'code.manage' capability) HTML.
// Edits change the DRAFT only: the public site reads published revision snapshots.

async function findPageOr404(pageId, next) {
  const page = await WebsitePage.findById(pageId);
  if (!page || !page.isActive) {
    next(new ApiError('No page found with that id', 404));
    return null;
  }
  return page;
}

const canWriteCode = req => (req.websiteCapabilities || []).includes('code.manage');

/** Restricted section types (custom HTML) may only be touched by a role holding that capability. */
function assertTypeAllowed(req, type) {
  const restricted = SECTION_TYPE_FIELDS[type]?.restricted;
  if (restricted && !(req.websiteCapabilities || []).includes(restricted)) {
    throw new ApiError('Only a website administrator can add or change this kind of section.', 403);
  }
}

/** Back-compat export (tests and callers): throws on invalid content, returns true. */
function validateContent(type, content, opts) {
  validateTypedContent(type, content, opts);
  return true;
}

const getSectionTypes = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Section types', true, publicRegistry()));
});

const createSection = asyncHandler(async (req, res, next) => {
  const page = await findPageOr404(req.params.pageId, next);
  if (!page) return;

  const { type, content, isVisible, settings, adminLabel, position } = req.body;
  if (!isSectionType(type)) return next(new ApiError(`Unknown section type "${type}".`, 400));
  assertTypeAllowed(req, type);
  // A new section may start empty; its required fields are enforced when it is saved and published.
  const cleanContent = validateTypedContent(type, content || {}, { allowHtml: canWriteCode(req), partial: true });
  const cleanSettings = validateSettings(settings);

  let sortOrder;
  if (Number.isInteger(position) && position >= 0) {
    // Insert at a position: shift everything at or after it down by one.
    await WebsiteSection.updateMany({ page: page._id, sortOrder: { $gte: position } }, { $inc: { sortOrder: 1 } });
    sortOrder = position;
  } else {
    const last = await WebsiteSection.findOne({ page: page._id }).sort({ sortOrder: -1 }).select('sortOrder').lean();
    sortOrder = (last?.sortOrder ?? -1) + 1;
  }
  const section = await WebsiteSection.create({
    page: page._id,
    type,
    content: cleanContent,
    settings: cleanSettings,
    adminLabel: typeof adminLabel === 'string' ? adminLabel.slice(0, 80) : '',
    isVisible: isVisible ?? true,
    sortOrder,
    createdBy: req.user._id,
  });

  await logWebsiteActivity({ actor: req.user, action: 'section.create', targetType: 'WebsiteSection', targetId: section._id, targetLabel: `${page.slug}:${type}`, after: section.toObject() });
  res.status(201).json(apiResponse('Section created successfully', true, section));
});

const getSections = asyncHandler(async (req, res, next) => {
  const page = await findPageOr404(req.params.pageId, next);
  if (!page) return;
  const sections = await WebsiteSection.find({ page: page._id }).sort({ sortOrder: 1 });
  res.status(200).json(apiResponse('Sections retrieved successfully', true, sections));
});

const updateSection = asyncHandler(async (req, res, next) => {
  const page = await findPageOr404(req.params.pageId, next);
  if (!page) return;
  const section = await WebsiteSection.findOne({ _id: req.params.id, page: page._id });
  if (!section) return next(new ApiError('No section found with that id on this page', 404));
  assertTypeAllowed(req, section.type);

  const before = section.toObject();
  const { content, isVisible, settings, adminLabel } = req.body;
  if (content !== undefined) section.content = validateTypedContent(section.type, content, { allowHtml: canWriteCode(req) });
  if (settings !== undefined) section.settings = validateSettings(settings);
  if (isVisible !== undefined) section.isVisible = isVisible;
  if (adminLabel !== undefined) section.adminLabel = String(adminLabel || '').slice(0, 80);
  section.markModified('content');
  section.markModified('settings');
  section.updatedBy = req.user._id;
  await section.save();

  await logWebsiteActivity({ actor: req.user, action: 'section.update', targetType: 'WebsiteSection', targetId: section._id, targetLabel: `${page.slug}:${section.type}`, before, after: section.toObject() });
  res.status(200).json(apiResponse('Section updated successfully', true, section));
});

// One bulkWrite, not N sequential saves - drag-and-drop ordering lands here as one request.
const reorderSections = asyncHandler(async (req, res, next) => {
  const page = await findPageOr404(req.params.pageId, next);
  if (!page) return;

  const { order } = req.body;
  if (!Array.isArray(order) || !order.length) return next(new ApiError('An array of section ids in their new order is required.', 400));

  const sections = await WebsiteSection.find({ page: page._id }).select('_id').lean();
  const validIds = new Set(sections.map(s => String(s._id)));
  if (order.length !== sections.length || new Set(order.map(String)).size !== order.length || !order.every(id => validIds.has(String(id)))) {
    return next(new ApiError('The reorder list must contain exactly the sections that belong to this page, each exactly once.', 400));
  }

  await WebsiteSection.bulkWrite(order.map((id, index) => ({ updateOne: { filter: { _id: id, page: page._id }, update: { $set: { sortOrder: index, updatedBy: req.user._id } } } })));

  await logWebsiteActivity({ actor: req.user, action: 'section.reorder', targetType: 'WebsitePage', targetId: page._id, targetLabel: page.slug, after: { order } });
  const updated = await WebsiteSection.find({ page: page._id }).sort({ sortOrder: 1 });
  res.status(200).json(apiResponse('Sections reordered successfully', true, updated));
});

const duplicateSection = asyncHandler(async (req, res, next) => {
  const page = await findPageOr404(req.params.pageId, next);
  if (!page) return;
  const original = await WebsiteSection.findOne({ _id: req.params.id, page: page._id });
  if (!original) return next(new ApiError('No section found with that id on this page', 404));
  assertTypeAllowed(req, original.type);

  await WebsiteSection.updateMany({ page: page._id, sortOrder: { $gt: original.sortOrder } }, { $inc: { sortOrder: 1 } });
  const copy = await WebsiteSection.create({
    page: page._id,
    type: original.type,
    content: original.content,
    settings: original.settings || {},
    adminLabel: original.adminLabel ? `${original.adminLabel} (copy)`.slice(0, 80) : '',
    isVisible: original.isVisible,
    sortOrder: original.sortOrder + 1,
    createdBy: req.user._id,
  });

  await logWebsiteActivity({ actor: req.user, action: 'section.duplicate', targetType: 'WebsiteSection', targetId: copy._id, targetLabel: `${page.slug}:${copy.type}`, after: { duplicatedFrom: original._id } });
  res.status(201).json(apiResponse('Section duplicated successfully', true, copy));
});

const deleteSection = asyncHandler(async (req, res, next) => {
  const page = await findPageOr404(req.params.pageId, next);
  if (!page) return;
  const existing = await WebsiteSection.findOne({ _id: req.params.id, page: page._id });
  if (!existing) return next(new ApiError('No section found with that id on this page', 404));
  assertTypeAllowed(req, existing.type);
  await existing.deleteOne();
  // Keep sortOrder dense so later inserts/reorders stay predictable.
  await WebsiteSection.updateMany({ page: page._id, sortOrder: { $gt: existing.sortOrder } }, { $inc: { sortOrder: -1 } });

  await logWebsiteActivity({ actor: req.user, action: 'section.delete', targetType: 'WebsiteSection', targetId: existing._id, targetLabel: `${page.slug}:${existing.type}`, before: existing.toObject() });
  res.status(200).json(apiResponse('Section deleted successfully', true, existing));
});

module.exports = { getSectionTypes, createSection, getSections, updateSection, reorderSections, duplicateSection, deleteSection, validateContent };
