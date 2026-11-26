const asyncHandler = require('express-async-handler');
const MaterialItem = require('../../models/commercial/materialItemModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const ApiFeatures = require('../../utils/apiFeatures');
const { canonicalMaterialKey } = require('../../utils/commercial/materialKey');
const { assertCanAccessEnginePage } = require('../../utils/commercial/dealEnginePermissions');
const { ENGINE_SPECS, missingSpecs, cleanSpecPatch } = require('../../utils/commercial/engineSpecs');
const workbookImport = require('../../services/commercial/workbookImport/importService');
const erpProductSync = require('../../services/commercial/workbookImport/erpProductSync');

/** Adds `missingSpecs` (labels of the technical data the design engines still need; [] = usable). */
function withSpecStatus(doc) {
  const m = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  if (m.category === undefined || m.attrs === undefined) return m;
  return { ...m, missingSpecs: missingSpecs(m.category, m.attrs) };
}

// Reservia Commercial - Material Price List admin. Price edits never overwrite history (the
// project's own explicit rule): updatePrice appends to priceHistory, archive is soft-delete only.

// Matches handlersFactory.getAll()'s own response shape ({results, paginationResult, data}),
// which the frontend's PaginatedData<T> type expects - NOT apiResponse()'s {success, message,
// data, pagination} shape, which uses a differently-named/shaped pagination field.
// Rev 01 open item: the keyword search box never filtered anything - listMaterials built its own
// filter object but never called ApiFeatures#search(), so every query returned the same unfiltered
// first page (the category filter "worked" because it is applied separately, directly below).
exports.listMaterials = asyncHandler(async (req, res) => {
  const filter = { archived: false, ...req.filterObject };
  if (req.query.category) filter.category = req.query.category;
  const countDocuments = await MaterialItem.countDocuments(filter);
  const mongooseQuery = MaterialItem.find(filter);
  const { mongooseQuery: query, paginationResult } = new ApiFeatures(mongooseQuery, req.query).paginate(countDocuments).sort().filter(filter).search('MaterialItem').limitFields();
  const materials = await query;
  res.status(200).json({ results: materials.length, paginationResult, data: materials.map(withSpecStatus) });
});

// ---------------------------------------------------------------- workbook import + ERP products

const options = body => {
  if (!body?.options) return {};
  try {
    return typeof body.options === 'string' ? JSON.parse(body.options) : body.options;
  } catch {
    throw new ApiError('Import options are not valid JSON.', 400);
  }
};

exports.previewWorkbookImport = asyncHandler(async (req, res) => {
  const data = await workbookImport.previewImport(req.file || {}, { user: req.user, roles: req.commercialRoles });
  res.status(200).json(apiResponse('Workbook preview', true, data));
});

exports.applyWorkbookImport = asyncHandler(async (req, res) => {
  const data = await workbookImport.applyImport(req.file || {}, options(req.body), { user: req.user, roles: req.commercialRoles });
  res.status(200).json(apiResponse('Workbook imported', true, data));
});

exports.erpProductsStatus = asyncHandler(async (req, res) => {
  assertCanAccessEnginePage(req.commercialRoles, 'materials', 'view');
  res.status(200).json(apiResponse('ERP products', true, await erpProductSync.status(req.user)));
});

exports.createErpProducts = asyncHandler(async (req, res) => {
  assertCanAccessEnginePage(req.commercialRoles, 'materials', 'edit');
  const st = await erpProductSync.status(req.user);
  if (!st.canApply) throw new ApiError(st.reason, 403);
  res.status(200).json(apiResponse('ERP products created and linked', true, await erpProductSync.apply(req.user)));
});

/** The technical fields each engine category needs (utils/commercial/engineSpecs.js) - drives the Materials editor. */
exports.getSpecFields = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Spec fields', true, ENGINE_SPECS));
});

exports.getMaterial = asyncHandler(async (req, res, next) => {
  const material = await MaterialItem.findById(req.params.id);
  if (!material) return next(new ApiError('Material not found.', 404));
  res.status(200).json(apiResponse('Material retrieved successfully', true, withSpecStatus(material)));
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

  const { unitPrice, currency, attrs: attrsPatch, status, ...rest } = req.body;
  if (unitPrice !== undefined && (unitPrice !== material.unitPrice || currency !== material.currency)) {
    material.priceHistory.push({ price: unitPrice, currency: currency || material.currency, effectiveDate: new Date(), changedBy: req.user._id });
    material.effectiveDate = new Date();
  }
  Object.assign(material, rest);
  if (unitPrice !== undefined) material.unitPrice = unitPrice;
  if (currency !== undefined) material.currency = currency;

  // Technical data (Deal Engine "PV module not found in the Price Book"): an item a supplier upload
  // created carries its rated value only and stays PLACEHOLDER - out of the engine catalogs - until
  // the rest is entered here. Values are merged into attrs (never replacing unrelated keys) and
  // checked against utils/commercial/engineSpecs.js.
  if (attrsPatch !== undefined) {
    if (!attrsPatch || typeof attrsPatch !== 'object' || Array.isArray(attrsPatch)) return next(new ApiError('Technical data must be an object.', 400));
    const { attrs: clean, errors } = cleanSpecPatch(material.category, attrsPatch);
    if (errors.length) return next(new ApiError(errors.join(' '), 400));
    material.attrs = { ...(material.attrs || {}), ...clean };
    // A module's per-watt price is what the engines bill (pmaxW x pricePerWatt); derived from its
    // unit (per-piece) price, and re-derived from the supplier price at lookup (priceBookLookup.js).
    if (material.category === 'PV Modules' && material.attrs.pmaxW > 0) {
      material.attrs.pricePerWatt = Math.round((material.unitPrice / material.attrs.pmaxW) * 1e6) / 1e6;
      if (material.n1 == null) material.n1 = material.attrs.pmaxW;
    }
    material.markModified('attrs');
  }
  const missing = missingSpecs(material.category, material.attrs);
  if (status !== undefined) {
    if (status === 'Available' && missing.length) return next(new ApiError(`${material.brand} ${material.model} cannot be made available yet - missing: ${missing.join(', ')}.`, 400));
    material.status = status;
  } else if (material.status === 'PLACEHOLDER' && attrsPatch !== undefined && ENGINE_SPECS[material.category] && !missing.length) {
    // Completed: the engines can now size with it.
    material.status = 'Available';
  }
  await material.save();
  res.status(200).json(apiResponse('Material updated successfully', true, withSpecStatus(material)));
});

exports.archiveMaterial = asyncHandler(async (req, res, next) => {
  assertCanAccessEnginePage(req.commercialRoles, 'materials', 'edit');
  const material = await MaterialItem.findByIdAndUpdate(req.params.id, { archived: true, archivedAt: new Date(), archivedBy: req.user._id }, { new: true });
  if (!material) return next(new ApiError('Material not found.', 404));
  res.status(200).json(apiResponse('Material archived successfully', true, material));
});
