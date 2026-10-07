const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const ApiError = require('../utils/apiError');

cloudinary.config(process.env.CLOUDINARY_URL);

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// PDF-only upload pipeline for customer/vendor business documents (commercial registration, tax
// card, etc.). Deliberately separate from fileUploadMiddleware.js's image pipeline: that one
// applies image transformations (auto quality/format) that don't make sense for a PDF, and never
// restricts mimetype at all. Cloudinary must store these as `resource_type: 'raw'` (not 'image' or
// 'auto') - PDFs uploaded as 'image' get Cloudinary's image-transformation pipeline applied, which
// is unnecessary here and can fail/rasterize unexpectedly for non-image PDF content.
const createPdfStorage = folder =>
  new CloudinaryStorage({
    cloudinary,
    params: {
      folder: `uploads/${folder}`,
      resource_type: 'raw',
      public_id: (req, file) => {
        const baseName = file.originalname.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
        return `${baseName}-${Date.now()}`;
      },
    },
  });

// Belt-and-suspenders: both the MIME type (can be spoofed by the client) and the file extension
// must say PDF. Neither check alone is trustworthy, but together they catch the common
// mislabeling/renaming mistakes without needing to sniff the actual file bytes. Exported as a
// pure function (no multer/Express types) so it's unit-testable in isolation - see
// server/test/documentUpload.test.js.
function isPdfFile({ mimetype, originalname }) {
  return mimetype === 'application/pdf' && /\.pdf$/i.test(originalname || '');
}

function pdfFileFilter(req, file, cb) {
  if (!isPdfFile(file)) {
    return cb(new ApiError('Only PDF files are allowed for this document.', 400));
  }
  cb(null, true);
}

/**
 * @param {string} folder - Cloudinary folder (e.g. "customers", "vendors")
 * @param {string} field - multipart field name for the file (e.g. "document")
 *
 * Returns an Express middleware (not the raw multer instance) so multer/Cloudinary errors -
 * oversized file, wrong mimetype from pdfFileFilter, a Cloudinary upload failure - all reach the
 * app's global error handler as a clean 400 instead of multer's default behavior of passing its
 * own untranslated error through or, for some error classes, hanging the request.
 */
exports.uploadSingleDocument = (folder, field) => {
  const upload = multer({
    storage: createPdfStorage(folder),
    fileFilter: pdfFileFilter,
    limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
  }).single(field);

  return (req, res, next) => {
    upload(req, res, err => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(`The document exceeds the maximum allowed size of ${MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)}MB.`, 400));
      }
      if (err instanceof ApiError) return next(err);
      return next(new ApiError('Failed to upload document.', 400));
    });
  };
};

exports.destroyDocument = async publicId => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
  } catch (err) {
    // Best-effort cleanup - a Cloudinary-side failure to delete the orphaned asset shouldn't
    // block removing the document reference from the customer/vendor record.
  }
};

exports.MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_BYTES;
exports.isPdfFile = isPdfFile;
