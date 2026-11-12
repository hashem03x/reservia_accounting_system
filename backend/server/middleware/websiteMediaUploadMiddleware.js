const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const ApiError = require('../utils/apiError');

cloudinary.config(process.env.CLOUDINARY_URL);

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_FILES_PER_UPLOAD = 20;

// Website Management - Media Library uploads (images and videos). The FILE goes to Cloudinary;
// MongoDB only ever stores its metadata and delivery URL (websiteMediaModel.js) - never bytes.
// Belt-and-suspenders type check (MIME + extension), per-kind size limits, MulterError ->
// ApiError(400) translation.
//
// Local development only: WEBSITE_MEDIA_DRIVER=local stores files on the backend's own disk
// (backend/uploads/website-media, served by app.js's static handler) so the library can be used
// and tested without Cloudinary credentials. It is refused in production.

const IMAGE_MIME = /^image\/(jpeg|png|webp|svg\+xml|gif|avif)$/;
const IMAGE_EXT = /\.(jpe?g|png|webp|svg|gif|avif)$/i;
const VIDEO_MIME = /^video\/(mp4|webm|quicktime)$/;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

const kindOf = ({ mimetype, originalname }) => {
  if (IMAGE_MIME.test(mimetype) && IMAGE_EXT.test(originalname || '')) return 'image';
  if (VIDEO_MIME.test(mimetype) && VIDEO_EXT.test(originalname || '')) return 'video';
  return null;
};
const isAllowedImage = file => kindOf(file) === 'image';

const useLocalDriver = () => process.env.WEBSITE_MEDIA_DRIVER === 'local' && process.env.NODE_ENV !== 'production';
const LOCAL_DIR = path.join(__dirname, '../../uploads/website-media');

const baseName = file => file.originalname.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'file';

const cloudinaryStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'website/media',
    resource_type: kindOf(file) === 'video' ? 'video' : 'image',
    public_id: `${baseName(file)}-${Date.now()}`,
  }),
});

const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    cb(null, LOCAL_DIR);
  },
  filename: (req, file, cb) => cb(null, `${baseName(file)}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
});

function fileFilter(req, file, cb) {
  if (!kindOf(file)) return cb(new ApiError('Only images (JPEG, PNG, WEBP, GIF, AVIF, SVG) or videos (MP4, WEBM, MOV) can be uploaded.', 400));
  cb(null, true);
}

function translateUploadError(err, next) {
  if (!err) return true;
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    next(new ApiError(`A file exceeds the maximum allowed size (images ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)} MB, videos ${MAX_VIDEO_SIZE_BYTES / (1024 * 1024)} MB).`, 400));
    return false;
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_UNEXPECTED_FILE') {
    next(new ApiError(`No more than ${MAX_FILES_PER_UPLOAD} files may be uploaded at once.`, 400));
    return false;
  }
  next(err instanceof ApiError ? err : new ApiError(`Failed to upload the file${err?.message ? `: ${err.message}` : '.'}`, 400));
  return false;
}

function makeUpload(kind, field, count) {
  const m = multer({ storage: useLocalDriver() ? localStorage : cloudinaryStorage, fileFilter, limits: { fileSize: MAX_VIDEO_SIZE_BYTES } });
  return kind === 'array' ? m.array(field, count) : m.single(field);
}

/** Per-kind size check after upload (multer has one global limit): oversize images are removed again. */
async function enforceKindLimits(files) {
  for (const f of files) {
    if (kindOf(f) === 'image' && f.size > MAX_IMAGE_SIZE_BYTES) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(
        files.map(x =>
          exports.destroyAsset(
            x.destination
              ? { publicId: `local:${x.filename}`, resourceType: 'local', localPath: path.join(x.destination, x.filename) }
              : { publicId: x.filename, resourceType: kindOf(x) === 'video' ? 'video' : 'image' }
          )
        )
      );
      throw new ApiError(`"${f.originalname}" is larger than ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)} MB - images must be smaller.`, 400);
    }
  }
}

const wrap = upload => (req, res, next) =>
  upload(req, res, async err => {
    if (!translateUploadError(err, next)) return;
    try {
      const files = req.files && req.files.length ? req.files : req.file ? [req.file] : [];
      await enforceKindLimits(files);
      next();
    } catch (e) {
      next(e);
    }
  });

/** A single file (Replace). */
exports.uploadSingleMedia = field => wrap(makeUpload('single', field));
/** Several files in one request (bulk upload). */
exports.uploadMultipleMedia = field => wrap(makeUpload('array', field, MAX_FILES_PER_UPLOAD));
// Back-compat names.
exports.uploadSingleImage = exports.uploadSingleMedia;
exports.uploadMultipleImages = exports.uploadMultipleMedia;

/**
 * Normalizes what the storage engine produced into WebsiteMedia fields, reading dimensions where
 * possible (Cloudinary's API for remote files - best effort; sharp for local images).
 */
async function describeUpload(file, req) {
  const kind = kindOf(file) || 'image';
  if (file.destination && file.filename && !file.path?.startsWith('http')) {
    const out = {
      kind,
      resourceType: 'local',
      url: req ? `${req.protocol}://${req.get('host')}/website-media/${file.filename}` : null,
      publicId: `local:${file.filename}`,
      localPath: path.join(file.destination, file.filename),
      bytes: file.size || null,
      format: path.extname(file.originalname).slice(1).toLowerCase() || null,
      mimeType: file.mimetype,
      originalName: file.originalname,
      width: null,
      height: null,
    };
    if (kind === 'image' && !/svg/.test(file.mimetype)) {
      try {
        // eslint-disable-next-line global-require
        const meta = await require('sharp')(out.localPath).metadata();
        out.width = meta.width || null;
        out.height = meta.height || null;
      } catch {
        /* dimensions are optional */
      }
    }
    return out;
  }
  const out = {
    kind,
    resourceType: kind === 'video' ? 'video' : 'image',
    url: file.path,
    publicId: file.filename,
    bytes: file.size || null,
    format: path.extname(file.originalname || '').slice(1).toLowerCase() || file.mimetype?.split('/')[1] || null,
    mimeType: file.mimetype,
    originalName: file.originalname,
    width: null,
    height: null,
    duration: null,
  };
  try {
    const r = await cloudinary.api.resource(out.publicId, { resource_type: out.resourceType });
    out.width = r.width || null;
    out.height = r.height || null;
    out.bytes = r.bytes || out.bytes;
    out.format = r.format || out.format;
    out.duration = r.duration || null;
  } catch {
    /* dimensions are optional - the upload itself succeeded */
  }
  return out;
}
exports.describeUpload = describeUpload;

/** Removes a stored file (Cloudinary asset or local file). Best effort - never throws. */
exports.destroyAsset = async ({ publicId, resourceType, localPath } = {}) => {
  if (!publicId) return;
  try {
    if (resourceType === 'local' || String(publicId).startsWith('local:')) {
      const file = localPath || path.join(LOCAL_DIR, String(publicId).replace(/^local:/, ''));
      if (path.resolve(file).startsWith(path.resolve(LOCAL_DIR))) await fs.promises.unlink(file);
      return;
    }
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType === 'video' ? 'video' : 'image' });
  } catch {
    /* best effort */
  }
};

exports.destroyImage = async publicId => exports.destroyAsset({ publicId, resourceType: 'image' });

exports.MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_BYTES;
exports.MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_BYTES;
exports.MAX_FILES_PER_UPLOAD = MAX_FILES_PER_UPLOAD;
exports.isAllowedImage = isAllowedImage;
exports.kindOf = kindOf;
exports.useLocalDriver = useLocalDriver;
