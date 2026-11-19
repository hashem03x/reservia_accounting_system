const asyncHandler = require('express-async-handler');
const MaterialItem = require('../../models/commercial/materialItemModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const ApiFeatures = require('../../utils/apiFeatures');
const { canonicalMaterialKey } = require('../../utils/commercial/materialKey');
const { assertCanAccessEnginePage } = require('../../utils/commercial/dealEnginePermissions');

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

// R12/R2: "procurement owns Materials, Suppliers and price list uploads" (section 3) - md and
// procurement may edit; commercial_director is read-only (section 4.2); sales/technical/member
// have no business writing to the Price Book, matching T2's finding that nothing enforces this
// today. Reads stay open to every Commercial-access role - see dealEnginePermissions.js's own
// comment on why (BOQ lines reference materialItemKey).
exports.createMaterial = asyncHandler(async (req, res, next) => {
  assertCanAccessEnginePage(req.commercialRoles, 'materials', 'edit');
  const { category, brand, model, spec = '', unit } = req.body;
  if (!category) return next(new ApiError('Category is required.', 400));
  if (!brand || !model) return next(new ApiError('Brand and model are required.', 400));
  if (!unit) return next(new ApiError('Unit is required.', 400));
  if (!(Number(req.body.unitPrice) > 0)) return next(new ApiError('Unit price must be a positive number.', 400));

  // 2026 QA fix: this endpoint has no preview step (unlike the supplier price-list upload), so a
  // near-duplicate (different case/whitespace/unit formatting of the same brand+model+spec) must
  // be rejected explicitly here - the canonical key alone (utils/commercial/materialKey.js) is
  // what the unique `keyNorm` index ultimately enforces, but a clear 400 here is far more useful
  // to the admin than a raw duplicate-key database error.
  const keyNorm = canonicalMaterialKey({ brand, model, spec });
  const existing = await MaterialItem.findOne({ keyNorm, archived: false }).select('_id brand model spec category').lean();
  if (existing) {
    throw new ApiError(
      `This matches an existing Price Book item: "${existing.brand} ${existing.model}${existing.spec ? ` (${existing.spec})` : ''}" in "${existing.category}" (id ${existing._id}). Edit that item instead of creating a duplicate.`,
      409
    );
  }

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
  assertCanAccessEnginePage(req.commercialRoles, 'materials', 'edit');
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
  assertCanAccessEnginePage(req.commercialRoles, 'materials', 'edit');
  const material = await MaterialItem.findByIdAndUpdate(req.params.id, { archived: true, archivedAt: new Date(), archivedBy: req.user._id }, { new: true });
  if (!material) return next(new ApiError('Material not found.', 404));
  res.status(200).json(apiResponse('Material archived successfully', true, material));
});
