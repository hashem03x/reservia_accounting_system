const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/apiError');
const apiResponse = require('../utils/apiResponse');
const { destroyDocument } = require('../middleware/documentUploadMiddleware');
const { DOCUMENT_TYPES } = require('../models/shared/businessPartnerSchemas');

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
      filename: req.file.originalname,
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

  return { uploadDocument, deleteDocument };
}

module.exports = { createDocumentHandlers };
