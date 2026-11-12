const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const supplierService = require('../../services/commercial/supplierService');
const uploads = require('../../services/commercial/priceListUploadService');

// Deal Engine C18-C24 - approved supplier list and supplier price list uploads. Role checks are in
// the services, from req.commercialRole (the DB-loaded Deal Engine membership).
const ctx = req => ({ user: req.user, role: req.commercialRole });

exports.listSuppliers = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Suppliers', true, await supplierService.listSuppliers({ status: req.query.status, q: req.query.q })));
});
exports.getSupplier = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Supplier', true, supplierService.shape(await supplierService.getSupplier(req.params.id))));
});
exports.createSupplier = asyncHandler(async (req, res) => {
  res.status(201).json(apiResponse('Supplier added as a Candidate', true, await supplierService.createSupplier(req.body || {}, ctx(req))));
});
exports.updateSupplier = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Supplier updated', true, await supplierService.updateSupplier(req.params.id, req.body || {}, ctx(req))));
});
exports.setStatus = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Supplier status changed', true, await supplierService.setStatus(req.params.id, req.body || {}, ctx(req))));
});
exports.addNote = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Note added', true, await supplierService.addNote(req.params.id, req.body || {}, ctx(req))));
});
exports.setScorecard = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Scorecard updated', true, await supplierService.setScorecard(req.params.id, req.body || {}, ctx(req))));
});
exports.upsertDocument = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Document recorded', true, await supplierService.upsertDocument(req.params.id, req.body || {}, ctx(req))));
});

exports.previewPriceList = asyncHandler(async (req, res) => {
  const upload = await uploads.previewUpload(req.params.id, { file: req.file, mapping: req.body?.mapping, validityDate: req.body?.validityDate }, ctx(req));
  res.status(201).json(apiResponse('Price list read - review the preview, then confirm', true, upload));
});
exports.listPriceLists = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Price list uploads', true, await uploads.listUploads(req.params.id)));
});
exports.getPriceList = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Price list upload', true, await uploads.getUpload(req.params.uploadId)));
});
exports.confirmPriceList = asyncHandler(async (req, res) => {
  const upload = await uploads.confirmUpload(req.params.uploadId, { createNew: req.body?.createNew || [] }, ctx(req));
  res.status(200).json(apiResponse(`Confirmed: ${upload.changes.length} price(s) written, ${upload.flaggedRevisions} open revision(s) flagged`, true, upload));
});
exports.rollbackPriceList = asyncHandler(async (req, res) => {
  const upload = await uploads.rollbackUpload(req.params.uploadId, ctx(req));
  res.status(200).json(apiResponse(`Rolled back: ${upload.changes.length} price(s) restored`, true, upload));
});
