const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const ApiError = require('../utils/apiError');

cloudinary.config(process.env.CLOUDINARY_URL);

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILES_PER_UPLOAD = 20;

// Website Management - Media Library image uploads. Mirrors
// middleware/documentUploadMiddleware.js's exact shape (CloudinaryStorage, belt-and-suspenders
// MIME+extension check, MulterError -> ApiError(400) translation) but for images
// (resource_type:'image', so Cloudinary applies its normal image pipeline - unlike the PDF
// pipeline's deliberate resource_type:'raw'), and supporting multiple files per request (the
// task's own "Multiple file upload" requirement).
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'website/media',
    resource_type: 'image',
    public_id: (req, file) => {
      const baseName = file.originalname.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      return `${baseName}-${Date.now()}`;
    },
  },
});

function isAllowedImage({ mimetype, originalname }) {
  return /^image\/(jpeg|png|webp|svg\+xml|gif)$/.test(mimetype) && /\.(jpe?g|png|webp|svg|gif)$/i.test(originalname || '');
}

function imageFileFilter(req, file, cb) {
  if (!isAllowedImage(file)) {
    return cb(new ApiError('Only JPEG, PNG, WEBP, GIF or SVG images are allowed.', 400));
  }
  cb(null, true);
}

function translateUploadError(err, next) {
  if (!err) return true;
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    next(new ApiError(`An image exceeds the maximum allowed size of ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)}MB.`, 400));
    return false;
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_UNEXPECTED_FILE') {
    next(new ApiError(`No more than ${MAX_FILES_PER_UPLOAD} images may be uploaded at once.`, 400));
    return false;
  }
  next(err instanceof ApiError ? err : new ApiError('Failed to upload image.', 400));
  return false;
}

/** A single-image upload (e.g. a Cloudinary-backed image field embedded directly on a document). */
exports.uploadSingleImage = field => {
  const upload = multer({ storage, fileFilter: imageFileFilter, limits: { fileSize: MAX_IMAGE_SIZE_BYTES } }).single(field);
  return (req, res, next) => upload(req, res, err => translateUploadError(err, next) && next());
};

/** Multiple images in one request, for the Media Library's bulk-upload action. */
exports.uploadMultipleImages = field => {
  const upload = multer({ storage, fileFilter: imageFileFilter, limits: { fileSize: MAX_IMAGE_SIZE_BYTES } }).array(field, MAX_FILES_PER_UPLOAD);
  return (req, res, next) => upload(req, res, err => translateUploadError(err, next) && next());
};

exports.destroyImage = async publicId => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  } catch (err) {
    // Best-effort cleanup - a Cloudinary-side failure to delete the asset shouldn't block removing
    // the WebsiteMedia record (isActive:false - see websiteMediaModel.js's own comment on why a
    // Cloudinary purge is a separate, manual maintenance action).
  }
};

exports.MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_BYTES;
exports.MAX_FILES_PER_UPLOAD = MAX_FILES_PER_UPLOAD;
exports.isAllowedImage = isAllowedImage;
