const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const ApiError = require('../utils/apiError');
const apiResponse = require('../utils/apiResponse');
const { destroyDocument } = require('../middleware/documentUploadMiddleware');

/**
 * Add/remove PDF documents on an existing Sales Order or Purchase Order (both embed
 * `documents: [orderDocumentSchema]`). The file itself is uploaded by
 * documentUploadMiddleware.uploadSingleDocument (PDF only, 10 MB) before these handlers run.
 *
 * Writes are atomic `$push`/`$pull` updates rather than load-and-save, so attaching a document
 * never re-runs the order's own save logic (totals, status, stock, accounting).
 *
 * @param {import('mongoose').Model} Model - SalesOrder or PurchaseOrder
 * @param {string} label - "Sales order" / "Purchase order", for messages only
 */
function createOrderDocumentHandlers(Model, label) {
  const notFound = () => new ApiError(`No ${label.toLowerCase()} found with that ID`, 404);

  const uploadOrderDocument = asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      await destroyDocument(req.file?.filename);
      return next(new ApiError(`Invalid ${label.toLowerCase()} id`, 400));
    }
    if (!req.file) return next(new ApiError('No PDF file was provided.', 400));

    const entry = {
      _id: new mongoose.Types.ObjectId(),
      url: req.file.path,
      publicId: req.file.filename,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedAt: new Date(),
      uploadedBy: req.user?._id || null,
    };

    const updated = await Model.findByIdAndUpdate(id, { $push: { documents: entry } }, { new: true, runValidators: true }).select('documents');
    if (!updated) {
      await destroyDocument(entry.publicId); // don't leave an orphaned file behind
      return next(notFound());
    }
    res.status(201).json(apiResponse(`${label} document uploaded successfully`, true, { documents: updated.documents }));
  });

  const deleteOrderDocument = asyncHandler(async (req, res, next) => {
    const { id, documentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(documentId)) {
      return next(new ApiError('Invalid id', 400));
    }

    const order = await Model.findById(id).select('documents');
    if (!order) return next(notFound());
    const document = (order.documents || []).find(doc => String(doc._id) === documentId);
    if (!document) return next(new ApiError('No document with that ID exists on this order.', 404));

    const updated = await Model.findByIdAndUpdate(id, { $pull: { documents: { _id: document._id } } }, { new: true }).select('documents');
    await destroyDocument(document.publicId);
    res.status(200).json(apiResponse(`${label} document deleted successfully`, true, { documents: updated?.documents || [] }));
  });

  return { uploadOrderDocument, deleteOrderDocument };
}

module.exports = { createOrderDocumentHandlers };
