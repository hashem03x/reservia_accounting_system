const asyncHandler = require('express-async-handler');
const WebsiteMedia = require('../../models/website/websiteMediaModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const ApiFeatures = require('../../utils/apiFeatures');
const { destroyImage } = require('../../middleware/websiteMediaUploadMiddleware');
const { logWebsiteActivity } = require('../../utils/website/activityLog');

// Website Management - Media Library. Mirrors chartOfAccountController.js's CRUD conventions.
// "Remove from the library" never hard-deletes (isActive:false) - see websiteMediaModel.js.

const uploadImages = asyncHandler(async (req, res, next) => {
  const files = req.files && req.files.length ? req.files : req.file ? [req.file] : [];
  if (!files.length) return next(new ApiError('No image was uploaded.', 400));

  const { folder, altEn, altAr } = req.body;
  const created = await WebsiteMedia.create(
    files.map(file => ({
      url: file.path,
      publicId: file.filename,
      format: file.mimetype?.split('/')[1] || null,
      bytes: file.size || null,
      folder: folder || 'general',
      altEn: altEn || '',
      altAr: altAr || '',
      uploadedBy: req.user._id,
    }))
  );

  for (const media of created) await logWebsiteActivity({ actor: req.user, action: 'media.upload', targetType: 'WebsiteMedia', targetId: media._id, targetLabel: media.url, after: media.toObject() });

  res.status(201).json(apiResponse('Image(s) uploaded successfully', true, created));
});

const getMedia = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.query.folder) filter.folder = req.query.folder;
  const countDocuments = await WebsiteMedia.countDocuments(filter);
  const features = new ApiFeatures(WebsiteMedia.find(filter), req.query).paginate(countDocuments).limitFields();
  const media = await features.mongooseQuery.sort({ createdAt: -1 });
  res.status(200).json({ results: media.length, paginationResult: features.paginationResult, data: media });
});

const getOneMedia = asyncHandler(async (req, res, next) => {
  const media = await WebsiteMedia.findById(req.params.id);
  if (!media || !media.isActive) return next(new ApiError('No media found with that id', 404));
  res.status(200).json(apiResponse('Media retrieved successfully', true, media));
});

const updateMedia = asyncHandler(async (req, res, next) => {
  const media = await WebsiteMedia.findById(req.params.id);
  if (!media || !media.isActive) return next(new ApiError('No media found with that id', 404));

  const before = media.toObject();
  const { altEn, altAr, folder } = req.body;
  if (altEn !== undefined) media.altEn = altEn;
  if (altAr !== undefined) media.altAr = altAr;
  if (folder !== undefined) media.folder = folder;
  await media.save();

  await logWebsiteActivity({ actor: req.user, action: 'media.update', targetType: 'WebsiteMedia', targetId: media._id, targetLabel: media.url, before, after: media.toObject() });
  res.status(200).json(apiResponse('Media updated successfully', true, media));
});

// Soft-remove from the library (isActive:false) - never a hard delete, and never purges the
// Cloudinary asset either (a section may still reference the URL - see websiteMediaModel.js).
const deleteMedia = asyncHandler(async (req, res, next) => {
  const media = await WebsiteMedia.findById(req.params.id);
  if (!media) return next(new ApiError('No media found with that id', 404));

  media.isActive = false;
  await media.save();
  await logWebsiteActivity({ actor: req.user, action: 'media.delete', targetType: 'WebsiteMedia', targetId: media._id, targetLabel: media.url });
  res.status(200).json(apiResponse('Media removed from the library successfully', true, media));
});

// A genuinely permanent purge (Cloudinary asset + document) - a separate, explicit action from
// the soft "remove from library" above, for an admin who has confirmed nothing references it.
const purgeMedia = asyncHandler(async (req, res, next) => {
  const media = await WebsiteMedia.findById(req.params.id);
  if (!media) return next(new ApiError('No media found with that id', 404));

  await destroyImage(media.publicId);
  await media.deleteOne();
  await logWebsiteActivity({ actor: req.user, action: 'media.delete', targetType: 'WebsiteMedia', targetId: media._id, targetLabel: media.url, before: media.toObject() });
  res.status(200).json(apiResponse('Media permanently deleted successfully', true, null));
});

module.exports = { uploadImages, getMedia, getOneMedia, updateMedia, deleteMedia, purgeMedia };
