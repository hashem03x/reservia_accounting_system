const asyncHandler = require('express-async-handler');
const WebsitePage = require('../../models/website/websitePageModel');
const WebsiteSection = require('../../models/website/websiteSectionModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { isSectionType, fieldsForType } = require('../../utils/website/sectionTypes');
const { logWebsiteActivity } = require('../../utils/website/activityLog');

// Website Management - Sections, the Visual Editor's real data. `content` is validated against
// utils/website/sectionTypes.js's registry for the section's own `type` - a client can never send
// an arbitrary shape (plan doc section 1).

async function findPageOr404(pageId, next) {
  const page = await WebsitePage.findById(pageId);
  if (!page || !page.isActive) {
    next(new ApiError('No page found with that id', 404));
    return null;
  }
  return page;
}

/** Validates `content` against the field list for `type` - required fields present, text fields within maxLength. Throws ApiError(400) on the first problem. */
function validateContent(type, content) {
  const fields = fieldsForType(type);
  if (!fields) throw new ApiError(`Unknown section type "${type}".`, 400);
  const value = content && typeof content === 'object' ? content : {};

  for (const field of fields) {
    const raw = value[field.key];
    if (field.required && (raw === undefined || raw === null || raw === '')) {
      throw new ApiError(`Section field "${field.key}" is required for a "${type}" section.`, 400);
    }
    if (field.kind === 'text' || field.kind === 'richtext') {
      if (raw != null && typeof raw !== 'string') throw new ApiError(`Section field "${field.key}" must be text.`, 400);
      if (raw != null && field.maxLength && raw.length > field.maxLength) throw new ApiError(`Section field "${field.key}" exceeds ${field.maxLength} characters.`, 400);
      if (field.pairKey) {
        const pairValue = value[field.pairKey];
        if (pairValue != null && typeof pairValue !== 'string') throw new ApiError(`Section field "${field.pairKey}" must be text.`, 400);
      }
    }
    if (field.kind === 'image' && raw != null && typeof raw === 'object' && raw.url != null && typeof raw.url !== 'string') {
      throw new ApiError(`Section field "${field.key}" has an invalid image reference.`, 400);
    }
    if (field.kind === 'list' && raw != null && !Array.isArray(raw)) {
      throw new ApiError(`Section field "${field.key}" must be a list.`, 400);
    }
  }
  return true;
}

const createSection = asyncHandler(async (req, res, next) => {
  const page = await findPageOr404(req.params.pageId, next);
  if (!page) return;

  const { type, content, isVisible } = req.body;
  if (!isSectionType(type)) return next(new ApiError(`Unknown section type "${type}".`, 400));
  validateContent(type, content);

  const lastSection = await WebsiteSection.findOne({ page: page._id }).sort({ sortOrder: -1 }).select('sortOrder').lean();
  const section = await WebsiteSection.create({
    page: page._id,
    type,
    content: content || {},
    isVisible: isVisible ?? true,
    sortOrder: (lastSection?.sortOrder ?? -1) + 1,
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

  const before = section.toObject();
  const { content, isVisible } = req.body;
  if (content !== undefined) {
    validateContent(section.type, content);
    section.content = content;
  }
  if (isVisible !== undefined) section.isVisible = isVisible;
  section.updatedBy = req.user._id;
  await section.save();

  await logWebsiteActivity({ actor: req.user, action: 'section.update', targetType: 'WebsiteSection', targetId: section._id, targetLabel: `${page.slug}:${section.type}`, before, after: section.toObject() });
  res.status(200).json(apiResponse('Section updated successfully', true, section));
});

// One bulkWrite, not N sequential saves - the task's own "drag and drop section ordering" lands
// here as a single request with the full new order.
const reorderSections = asyncHandler(async (req, res, next) => {
  const page = await findPageOr404(req.params.pageId, next);
  if (!page) return;

  const { order } = req.body;
  if (!Array.isArray(order) || !order.length) return next(new ApiError('An array of section ids in their new order is required.', 400));

  const sections = await WebsiteSection.find({ page: page._id }).select('_id').lean();
  const validIds = new Set(sections.map(s => String(s._id)));
  if (order.length !== sections.length || !order.every(id => validIds.has(String(id)))) {
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

  await WebsiteSection.updateMany({ page: page._id, sortOrder: { $gt: original.sortOrder } }, { $inc: { sortOrder: 1 } });
  const copy = await WebsiteSection.create({
    page: page._id,
    type: original.type,
    content: original.content,
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
  const section = await WebsiteSection.findOneAndDelete({ _id: req.params.id, page: page._id });
  if (!section) return next(new ApiError('No section found with that id on this page', 404));

  await logWebsiteActivity({ actor: req.user, action: 'section.delete', targetType: 'WebsiteSection', targetId: section._id, targetLabel: `${page.slug}:${section.type}`, before: section.toObject() });
  res.status(200).json(apiResponse('Section deleted successfully', true, section));
});

module.exports = { createSection, getSections, updateSection, reorderSections, duplicateSection, deleteSection, validateContent };
