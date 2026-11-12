const asyncHandler = require('express-async-handler');
const WebsiteMedia = require('../../models/website/websiteMediaModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const ApiFeatures = require('../../utils/apiFeatures');
const { describeUpload, destroyAsset } = require('../../middleware/websiteMediaUploadMiddleware');
const { logWebsiteActivity } = require('../../utils/website/activityLog');
const { buildUsageIndex, usageOf, summarize, replaceDraftReferences } = require('../../services/website/mediaUsage');

// Website Management - Media Library. The files live in Cloudinary (never in MongoDB - this
// collection is metadata + delivery URL only). "Remove" is a soft delete (isActive:false) so
// published history keeps resolving; a file used by LIVE content (a published page, a scheduled
// version, the site logo/favicon/share image) cannot be removed at all, and a file used only by
// drafts needs an explicit `?force=true` confirmation.

const escapeRegex = v => String(v).replace(/[.*+?^${}()|[\]\\]/g, ch => `\\${ch}`);
const cleanFolder = v => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, '-').slice(0, 40) || 'general' : 'general');
const defaultName = file => String(file.originalname || '').replace(/\.[^/.]+$/, '').slice(0, 120);

const uploadImages = asyncHandler(async (req, res, next) => {
  const files = req.files && req.files.length ? req.files : req.file ? [req.file] : [];
  if (!files.length) return next(new ApiError('No file was uploaded.', 400));

  const { folder, altEn, altAr } = req.body || {};
  const described = await Promise.all(files.map(f => describeUpload(f, req)));
  const created = await WebsiteMedia.create(
    described.map((d, i) => ({
      kind: d.kind,
      resourceType: d.resourceType,
      url: d.url,
      publicId: d.publicId,
      format: d.format,
      mimeType: d.mimeType,
      width: d.width,
      height: d.height,
      bytes: d.bytes,
      duration: d.duration || null,
      originalName: d.originalName || '',
      displayName: defaultName(files[i]),
      folder: cleanFolder(folder),
      altEn: altEn || '',
      altAr: altAr || '',
      uploadedBy: req.user._id,
    }))
  );

  for (const media of created) await logWebsiteActivity({ actor: req.user, action: 'media.upload', targetType: 'WebsiteMedia', targetId: media._id, targetLabel: media.displayName || media.url, after: media.toObject() });

  res.status(201).json(apiResponse(`${created.length} file(s) uploaded successfully`, true, created));
});

// ?q= (name/alt/original file name) ?kind=image|video ?folder= ?usage=used|unused ?sort=newest|oldest|name|size
const getMedia = asyncHandler(async (req, res) => {
  const query = { ...(req.query || {}) };
  const filter = { isActive: true };
  if (query.folder) filter.folder = String(query.folder);
  if (query.kind === 'image' || query.kind === 'video') filter.kind = query.kind === 'image' ? { $in: ['image', null] } : 'video';
  if (query.q) {
    const rx = new RegExp(escapeRegex(String(query.q).slice(0, 80)), 'i');
    filter.$or = [{ displayName: rx }, { originalName: rx }, { altEn: rx }, { altAr: rx }, { folder: rx }];
  }
  const sorts = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, name: { displayName: 1, createdAt: -1 }, size: { bytes: -1 } };
  const sort = sorts[query.sort] || sorts.newest;
  const usage = query.usage;
  ['folder', 'kind', 'q', 'sort', 'usage'].forEach(k => delete query[k]);

  let index = null;
  try {
    index = await buildUsageIndex();
  } catch {
    index = null; // usage is informational in the list; never fail the list over it
  }
  if (index && (usage === 'used' || usage === 'unused')) {
    const all = await WebsiteMedia.find(filter).select('_id url').lean();
    const ids = all.filter(m => (index.has(m.url) ? usage === 'used' : usage === 'unused')).map(m => m._id);
    filter._id = { $in: ids };
  }

  const countDocuments = await WebsiteMedia.countDocuments(filter);
  const features = new ApiFeatures(WebsiteMedia.find(filter), query).paginate(countDocuments).limitFields();
  const media = await features.mongooseQuery.sort(sort).lean();
  const data = media.map(m => ({ ...m, kind: m.kind || 'image', usage: index ? summarize(index.get(m.url) || []) : null }));
  res.status(200).json({ results: data.length, paginationResult: features.paginationResult, data });
});

const getFolders = asyncHandler(async (req, res) => {
  const rows = await WebsiteMedia.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$folder', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
  res.status(200).json(apiResponse('Folders', true, rows.map(r => ({ name: r._id || 'general', count: r.count }))));
});

const getStats = asyncHandler(async (req, res) => {
  const [row] = await WebsiteMedia.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: null, files: { $sum: 1 }, bytes: { $sum: { $ifNull: ['$bytes', 0] } }, videos: { $sum: { $cond: [{ $eq: ['$kind', 'video'] }, 1, 0] } } } },
  ]);
  res.status(200).json(apiResponse('Media stats', true, { files: row?.files || 0, bytes: row?.bytes || 0, videos: row?.videos || 0, images: (row?.files || 0) - (row?.videos || 0) }));
});

const getOneMedia = asyncHandler(async (req, res, next) => {
  const media = await WebsiteMedia.findById(req.params.id);
  if (!media || !media.isActive) return next(new ApiError('No media found with that id', 404));
  res.status(200).json(apiResponse('Media retrieved successfully', true, media));
});

const getMediaUsage = asyncHandler(async (req, res, next) => {
  const media = await WebsiteMedia.findById(req.params.id).lean();
  if (!media) return next(new ApiError('No media found with that id', 404));
  const uses = await usageOf(media.url);
  res.status(200).json(apiResponse('Media usage', true, { ...summarize(uses), uses }));
});

const updateMedia = asyncHandler(async (req, res, next) => {
  const media = await WebsiteMedia.findById(req.params.id);
  if (!media || !media.isActive) return next(new ApiError('No media found with that id', 404));

  const before = media.toObject();
  const { altEn, altAr, folder, displayName } = req.body || {};
  if (altEn !== undefined) media.altEn = altEn;
  if (altAr !== undefined) media.altAr = altAr;
  if (folder !== undefined) media.folder = cleanFolder(folder);
  if (displayName !== undefined) {
    const name = String(displayName || '').trim().slice(0, 120);
    if (!name) return next(new ApiError('A file name cannot be empty.', 400));
    media.displayName = name;
  }
  await media.save();

  await logWebsiteActivity({ actor: req.user, action: 'media.update', targetType: 'WebsiteMedia', targetId: media._id, targetLabel: media.displayName || media.url, before, after: media.toObject() });
  res.status(200).json(apiResponse('Media updated successfully', true, media));
});

/**
 * POST /media/:id/replace (one file) - swaps the file behind a library entry. Every DRAFT
 * reference is rewritten to the new URL; published snapshots are frozen history, so the old file
 * is kept while anything live still uses it (republishing picks up the new one).
 */
const replaceMedia = asyncHandler(async (req, res, next) => {
  const media = await WebsiteMedia.findById(req.params.id);
  const file = req.file || (req.files && req.files[0]);
  if (!media || !media.isActive) {
    if (file) await destroyAsset(await describeUpload(file, req));
    return next(new ApiError('No media found with that id', 404));
  }
  if (!file) return next(new ApiError('Choose the new file to upload.', 400));
  const d = await describeUpload(file, req);
  if ((media.kind || 'image') !== d.kind) {
    await destroyAsset(d);
    return next(new ApiError(`Replace a ${media.kind || 'image'} with another ${media.kind || 'image'}.`, 400));
  }
  const before = media.toObject();
  const oldUrl = media.url;
  const oldAsset = { publicId: media.publicId, resourceType: media.resourceType };
  Object.assign(media, { url: d.url, publicId: d.publicId, resourceType: d.resourceType, format: d.format, mimeType: d.mimeType, width: d.width, height: d.height, bytes: d.bytes, duration: d.duration || null, originalName: d.originalName || media.originalName });
  await media.save();

  const updatedReferences = await replaceDraftReferences(oldUrl, { url: d.url, publicId: d.publicId });
  const stillLive = (await usageOf(oldUrl)).filter(u => u.scope === 'live');
  if (!stillLive.length) await destroyAsset(oldAsset);

  await logWebsiteActivity({ actor: req.user, action: 'media.replace', targetType: 'WebsiteMedia', targetId: media._id, targetLabel: media.displayName || media.url, before, after: { ...media.toObject(), updatedReferences } });
  res.status(200).json(
    apiResponse(stillLive.length ? `File replaced. ${updatedReferences} draft reference(s) updated - republish ${[...new Set(stillLive.map(u => u.pageSlug).filter(Boolean))].join(', ') || 'the affected pages'} to use it on the live site.` : `File replaced. ${updatedReferences} reference(s) updated.`, true, { media, updatedReferences, livePagesToRepublish: [...new Set(stillLive.map(u => u.pageSlug).filter(Boolean))] })
  );
});

// Soft-remove from the library (isActive:false). Refused while live content uses the file;
// draft-only usage needs ?force=true (the dashboard asks first).
const deleteMedia = asyncHandler(async (req, res, next) => {
  const media = await WebsiteMedia.findById(req.params.id);
  if (!media) return next(new ApiError('No media found with that id', 404));
  const uses = await usageOf(media.url);
  const live = uses.filter(u => u.scope === 'live');
  if (live.length) {
    const where = [...new Set(live.map(u => (u.pageSlug ? `${u.where} "${u.pageSlug}"` : u.where)))].join(', ');
    return next(new ApiError(`This file is used on the live website (${where}). Replace it there and publish before deleting it.`, 409));
  }
  const force = req.query?.force === 'true' || req.body?.force === true;
  if (uses.length && !force) return next(new ApiError(`This file is used in ${uses.length} draft place(s). Confirm to delete it anyway - those drafts will show an empty image.`, 409));

  media.isActive = false;
  await media.save();
  await logWebsiteActivity({ actor: req.user, action: 'media.delete', targetType: 'WebsiteMedia', targetId: media._id, targetLabel: media.displayName || media.url, after: { draftUsesAtDeletion: uses.length } });
  res.status(200).json(apiResponse('Media removed from the library successfully', true, media));
});

// A genuinely permanent purge (stored file + document) - only for a file nothing references.
const purgeMedia = asyncHandler(async (req, res, next) => {
  const media = await WebsiteMedia.findById(req.params.id);
  if (!media) return next(new ApiError('No media found with that id', 404));
  const uses = await usageOf(media.url);
  if (uses.length) return next(new ApiError('This file is still referenced by website content and cannot be permanently deleted.', 409));

  await destroyAsset({ publicId: media.publicId, resourceType: media.resourceType });
  await media.deleteOne();
  await logWebsiteActivity({ actor: req.user, action: 'media.delete', targetType: 'WebsiteMedia', targetId: media._id, targetLabel: media.displayName || media.url, before: media.toObject() });
  res.status(200).json(apiResponse('Media permanently deleted successfully', true, null));
});

module.exports = { uploadImages, getMedia, getFolders, getStats, getOneMedia, getMediaUsage, updateMedia, replaceMedia, deleteMedia, purgeMedia };
