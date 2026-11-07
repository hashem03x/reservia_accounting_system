const asyncHandler = require('express-async-handler');
const MaterialItem = require('../../models/commercial/materialItemModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const ApiFeatures = require('../../utils/apiFeatures');

// Reservia Commercial - Material Price List admin. Price edits never overwrite history (the
// project's own explicit rule): updatePrice appends to priceHistory, archive is soft-delete only.

// Matches handlersFactory.getAll()'s own response shape ({results, paginationResult, data}),
// which the frontend's PaginatedData<T> type expects - NOT apiResponse()'s {success, message,
// data, pagination} shape, which uses a differently-named/shaped pagination field.
exports.listMaterials = asyncHandler(async (req, res) => {
  const filter = { archived: false, ...req.filterObject };
  if (req.query.category) filter.category = req.query.category;
  const countDocuments = await MaterialItem.countDocuments(filter);
  const mongooseQuery = MaterialItem.find(filter);
  const { mongooseQuery: query, paginationResult } = new ApiFeatures(mongooseQuery, req.query).paginate(countDocuments).sort().filter(filter).limitFields();
  const materials = await query;
  res.status(200).json({ results: materials.length, paginationResult, data: materials });
});

exports.getMaterial = asyncHandler(async (req, res, next) => {
  const material = await MaterialItem.findById(req.params.id);
  if (!material) return next(new ApiError('Material not found.', 404));
  res.status(200).json(apiResponse('Material retrieved successfully', true, material));
});

exports.createMaterial = asyncHandler(async (req, res) => {
  const { brand, model, spec = '' } = req.body;
  const key = `${brand} | ${model} | ${spec}`;
  const material = await MaterialItem.create({
    ...req.body, key,
    priceHistory: [{ price: req.body.unitPrice, currency: req.body.currency || 'EGP', effectiveDate: new Date(), changedBy: req.user._id }],
    createdBy: req.user._id,
  });
  res.status(201).json(apiResponse('Material created successfully', true, material));
});

/** Updates technical fields freely, but a unitPrice/currency CHANGE appends to priceHistory rather than silently overwriting it. */
exports.updateMaterial = asyncHandler(async (req, res, next) => {
  const material = await MaterialItem.findById(req.params.id);
  if (!material) return next(new ApiError('Material not found.', 404));

  const { unitPrice, currency } = req.body;
  if (unitPrice !== undefined && (unitPrice !== material.unitPrice || currency !== material.currency)) {
    material.priceHistory.push({ price: unitPrice, currency: currency || material.currency, effectiveDate: new Date(), changedBy: req.user._id });
    material.effectiveDate = new Date();
  }
  Object.assign(material, req.body);
  await material.save();
  res.status(200).json(apiResponse('Material updated successfully', true, material));
});

exports.archiveMaterial = asyncHandler(async (req, res, next) => {
  const material = await MaterialItem.findByIdAndUpdate(req.params.id, { archived: true, archivedAt: new Date(), archivedBy: req.user._id }, { new: true });
  if (!material) return next(new ApiError('Material not found.', 404));
  res.status(200).json(apiResponse('Material archived successfully', true, material));
});
