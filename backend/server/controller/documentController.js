const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/apiError');
const apiResponse = require('../utils/apiResponse');
const { destroyDocument } = require('../middleware/documentUploadMiddleware');
const { DOCUMENT_TYPES } = require('../models/shared/businessPartnerSchemas');
const { setFileHeaders } = require('../utils/contentDisposition');
const cloudinaryFiles = require('../services/files/cloudinaryFiles');
const { decodeUploadName } = require('../utils/uploadFileName');

/**
 * Shared upload/delete handlers for the optional PDF business documents embedded on Customer
 * (User) and Vendor records - one source of truth instead of duplicating this logic per entity
 * (both entities use the exact same `documents: [businessDocumentSchema]` shape).
 *
 * @param {import('mongoose').Model} Model - the owning model (User or Vendor)
 * @param {string} notFoundLabel - e.g. "Customer" / "Vendor", for error messages only
 */
function createDocumentHandlers(Model, notFoundLabel) {
  const uploadDocument = asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const { documentType } = req.body;

    if (!DOCUMENT_TYPES.includes(documentType)) {
      return next(new ApiError(`documentType must be one of: ${DOCUMENT_TYPES.join(', ')}`, 400));
    }
    if (!req.file) {
      return next(new ApiError('No PDF file was provided.', 400));
    }

    const record = await Model.findById(id);
    if (!record) {
      return next(new ApiError(`No ${notFoundLabel.toLowerCase()} found with that ID`, 404));
    }

    const newEntry = {
      documentType,
      url: req.file.path,
      publicId: req.file.filename,
      filename: decodeUploadName(req.file.originalname),
      mimeType: req.file.mimetype,
      uploadedAt: new Date(),
    };

    // Replace semantics: uploading a document of a type that already exists on this record
    // overwrites it (the "Replace" action in the UI), instead of accumulating duplicates of the
    // same document type.
    const existingIndex = record.documents.findIndex(doc => doc.documentType === documentType);
    if (existingIndex >= 0) {
      await destroyDocument(record.documents[existingIndex].publicId);
      record.documents[existingIndex] = newEntry;
    } else {
      record.documents.push(newEntry);
    }

    await record.save();
    res.status(200).json(apiResponse(`${notFoundLabel} document uploaded successfully`, true, record));
  });

  const deleteDocument = asyncHandler(async (req, res, next) => {
    const { id, documentType } = req.params;

    const record = await Model.findById(id);
    if (!record) {
      return next(new ApiError(`No ${notFoundLabel.toLowerCase()} found with that ID`, 404));
    }

    const existingIndex = record.documents.findIndex(doc => doc.documentType === documentType);
    if (existingIndex < 0) {
      return next(new ApiError(`No "${documentType}" document exists on this ${notFoundLabel.toLowerCase()}.`, 404));
    }

    await destroyDocument(record.documents[existingIndex].publicId);
    record.documents.splice(existingIndex, 1);
    await record.save();

    res.status(200).json(apiResponse(`${notFoundLabel} document deleted successfully`, true, record));
  });

  // GET /:id/documents/:documentType/download[?inline=1] - the document through the API, with its
  // real name, type and .pdf extension (the stored Cloudinary URL of an older upload has none).
  const downloadDocument = asyncHandler(async (req, res, next) => {
    const { id, documentType } = req.params;
    const record = await Model.findById(id).select('documents').lean();
    if (!record) return next(new ApiError(`No ${notFoundLabel.toLowerCase()} found with that ID`, 404));
    const document = (record.documents || []).find(doc => doc.documentType === documentType);
    if (!document) return next(new ApiError(`No "${documentType}" document exists on this ${notFoundLabel.toLowerCase()}.`, 404));
    return sendStoredDocument(res, next, document, req.query.inline === '1');
  });

  return { uploadDocument, deleteDocument, downloadDocument };
}

/**
 * Streams a Cloudinary-stored PDF ({ url, publicId, filename, mimeType }) to the client with the
 * headers a browser needs to name and open it correctly.
 */
async function sendStoredDocument(res, next, document, inline = false) {
  let file;
  try {
    file = await cloudinaryFiles.openRead({ url: document.url, publicId: document.publicId });
  } catch (err) {
    return next(new ApiError(`The document file ${err.message}.`, 502));
  }
  const contentType = document.mimeType || 'application/pdf';
  setFileHeaders(res, { fileName: document.filename || `${documentLabel(document)}.pdf`, contentType, size: file.size ?? undefined, inline });
  file.stream.on('error', err => (res.headersSent ? res.destroy(err) : next(new ApiError('Could not read the document.', 502))));
  return file.stream.pipe(res);
}
const documentLabel = document => String(document.documentType || 'document').replace(/[^a-zA-Z0-9_-]/g, '_');

module.exports = { createDocumentHandlers, sendStoredDocument };
