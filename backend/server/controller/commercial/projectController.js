const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const User = require('../../models/userModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const ApiFeatures = require('../../utils/apiFeatures');
const { getNextProjectCode } = require('../../services/commercial/projectCodeService');
const revisionService = require('../../services/commercial/revisionService');
const { ensureDealIdentifiers } = require('../../services/commercial/dealNumberService');
const { waitingOn } = require('../../services/commercial/approvalService');
const { CATEGORIES, SCOPES } = require('../../utils/commercial/constants');
const { resolveProjectRegion, EGYPT_REGIONS, RATES_MATRIX_COUNTRIES } = require('../../utils/commercial/regions');
const sharedCustomers = require('../../services/customer/sharedCustomerService');

const STAGE_POPULATE = ['stage1.approver', 'stage2.approver', 'md.approver'].map(path => ({ path, select: 'name' }));

// Fields a project edit may change (QA B1: "Name, customer, country, region and scope"), plus the
// optional header details the New Project form also sets. Identifiers, rollups, CRM linkage and
// outcome are never writable through this endpoint.
const EDITABLE_FIELDS = ['name', 'customer', 'country', 'region', 'category', 'subCategory', 'scope', 'currency', 'fxRate', 'designerUser'];
// A change to any of these alters the figures of the current revision (rates, VAT, engine).
const RECALC_FIELDS = ['country', 'region', 'category'];

/**
 * Validates and normalizes a project header for create (all required fields) or edit (only the
 * fields supplied). Returns { values, errors }. Server-side and authoritative - the form's own
 * checks are a convenience only.
 */
async function validateHeader(body, { existing = null } = {}) {
  const errors = [];
  const values = {};
  const has = k => Object.prototype.hasOwnProperty.call(body, k);
  const creating = !existing;

  if (creating || has('name')) {
    const name = String(body.name ?? '').trim();
    if (!name) errors.push('Project name is required.');
    else if (name.length > 200) errors.push('Project name must be at most 200 characters.');
    else values.name = name;
  }
  if (creating || has('customer')) {
    const id = body.customer?._id || body.customer;
    if (!id) errors.push('Select a customer from the customer list (or create one).');
    else if (!mongoose.isValidObjectId(id)) errors.push('The selected customer is not valid.');
    else {
      const customer = await User.findOne({ _id: id, role: 'user', isDeleted: { $ne: true } }).select('_id').lean();
      if (!customer) errors.push('The selected customer does not exist in the customer list.');
      else values.customer = customer._id;
    }
  }
  if (creating || has('category')) {
    if (!CATEGORIES.includes(body.category)) errors.push(`Category must be one of: ${CATEGORIES.join(', ')}.`);
    else values.category = body.category;
  }
  if (creating || has('country')) {
    const country = String(body.country ?? '').trim();
    if (!country) errors.push('Country is required.');
    else values.country = country.slice(0, 80);
  }
  if (creating || has('region') || has('country')) {
    const country = values.country ?? existing?.country;
    const regionInput = has('region') ? body.region : existing?.region;
    const r = resolveProjectRegion(country, regionInput);
    if (r.error) errors.push(r.error);
    else values.region = r.region;
  }
  if (has('scope') || creating) {
    const scope = body.scope ?? 'Supply & Installation';
    if (!SCOPES.includes(scope)) errors.push(`Scope must be one of: ${SCOPES.join(', ')}.`);
    else values.scope = scope;
  }
  if (has('subCategory')) values.subCategory = body.subCategory ? String(body.subCategory).trim().slice(0, 100) : null;
  if (has('currency')) values.currency = String(body.currency || 'EGP').trim().slice(0, 10) || 'EGP';
  if (has('fxRate')) {
    if (body.fxRate === null || body.fxRate === '') values.fxRate = null;
    else if (!(Number(body.fxRate) >= 0)) errors.push('FX rate must be zero or a positive number.');
    else values.fxRate = Number(body.fxRate);
  }
  if (has('designerUser')) {
    if (!body.designerUser) values.designerUser = null;
    else if (!mongoose.isValidObjectId(body.designerUser)) errors.push('Designer is not valid.');
    else values.designerUser = body.designerUser;
  }
  return { values, errors };
}

// Matches handlersFactory.getAll()'s own response shape ({results, paginationResult, data}),
// which the frontend's PaginatedData<T> type expects.
exports.listProjects = asyncHandler(async (req, res) => {
  const filter = { archived: false };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.outcome) filter.outcome = req.query.outcome;
  const countDocuments = await CommercialProject.countDocuments(filter);
  const mongooseQuery = CommercialProject.find(filter);
  const { mongooseQuery: query, paginationResult } = new ApiFeatures(mongooseQuery, req.query).paginate(countDocuments).sort().filter(filter).limitFields();
  const projects = await query;
  res.status(200).json({ results: projects.length, paginationResult, data: projects });
});

exports.getProject = asyncHandler(async (req, res, next) => {
  const project = await CommercialProject.findById(req.params.id).populate({ path: 'currentRevision', populate: STAGE_POPULATE });
  if (!project) return next(new ApiError('Commercial project not found.', 404));
  const data = project.toObject();
  if (data.currentRevision) data.currentRevision.waitingOn = waitingOn(project.currentRevision);
  res.status(200).json(apiResponse('Project retrieved successfully', true, data));
});

/** Creates the project header (validated) with its deal identifiers and, if engineeringInput is supplied, its first revision. */
exports.createProject = asyncHandler(async (req, res, next) => {
  const { engineeringInput, ...body } = req.body;
  const { values, errors } = await validateHeader(body);
  if (errors.length) return next(new ApiError(errors.join(' '), 400));

  const projectCode = await getNextProjectCode(values.category);
  const project = new CommercialProject({ currency: 'EGP', ...values, projectCode, createdBy: req.user._id });
  await ensureDealIdentifiers(project);
  await project.save();

  if (engineeringInput) {
    const revision = await revisionService.createRevision(project._id, engineeringInput, { userId: req.user._id });
    return res.status(201).json(apiResponse('Project and first revision created successfully', true, { project, revision }));
  }
  res.status(201).json(apiResponse('Project created successfully', true, { project }));
});

/**
 * QA finding B1 - edits the EXISTING project (never creates a new one). Identifiers, revisions,
 * approvals and CRM linkage are preserved. A change to region / country / category invalidates the
 * current revision: it goes to Draft, every sign-off resets, and it must be recalculated with the
 * new region's rates before it can be approved or issued. Every edit is recorded in editHistory.
 */
exports.updateProject = asyncHandler(async (req, res, next) => {
  const project = await CommercialProject.findById(req.params.id);
  if (!project) return next(new ApiError('Commercial project not found.', 404));
  if (project.archived) return next(new ApiError('This project is archived and cannot be edited.', 400));

  const body = {};
  for (const k of EDITABLE_FIELDS) if (Object.prototype.hasOwnProperty.call(req.body, k)) body[k] = req.body[k];
  const { values, errors } = await validateHeader(body, { existing: project });
  if (errors.length) return next(new ApiError(errors.join(' '), 400));

  if (values.category && values.category !== project.category && project.currentRevision) {
    return next(new ApiError('The category cannot change once a revision exists - the engineering inputs belong to the original category. Duplicate the project into the new category instead.', 400));
  }

  const changes = [];
  for (const [field, to] of Object.entries(values)) {
    const from = project[field] && project[field]._id ? project[field]._id : project[field];
    if (String(from ?? '') !== String(to ?? '')) changes.push({ field, from: from ?? null, to: to ?? null });
  }
  const identifiersAdded = await ensureDealIdentifiers(project);
  if (!changes.length && !identifiersAdded) return res.status(200).json(apiResponse('No changes.', true, project));

  for (const { field, to } of changes) project[field] = to;
  const needsRecalc = changes.some(c => RECALC_FIELDS.includes(c.field));
  let invalidated = null;
  if (needsRecalc && project.currentRevision) {
    const what = changes.filter(c => RECALC_FIELDS.includes(c.field)).map(c => `${c.field} "${c.from ?? '-'}" -> "${c.to ?? '-'}"`).join(', ');
    invalidated = await revisionService.invalidateCurrentRevision(project, `project ${what}; site costs and rates must be recalculated`, { userId: req.user._id });
    project.engineeringApprovalRollup = 'PENDING';
    project.commercialApprovalRollup = 'PENDING';
  }
  if (changes.length) {
    project.editHistory.push({ at: new Date(), by: req.user._id, byName: req.user.name || null, changes, revisionReset: !!invalidated });
  }
  await project.save();

  const fresh = await CommercialProject.findById(project._id).populate({ path: 'currentRevision', populate: STAGE_POPULATE });
  res.status(200).json(
    apiResponse(invalidated ? 'Project updated. The current revision was reset to Draft - recalculate it on the Engineering Input tab.' : 'Project updated successfully', true, fresh)
  );
});

exports.duplicateProject = asyncHandler(async (req, res, next) => {
  const source = await CommercialProject.findById(req.params.id).populate('currentRevision');
  if (!source) return next(new ApiError('Commercial project not found.', 404));
  const projectCode = await getNextProjectCode(source.category);
  const project = new CommercialProject({
    projectCode, name: `${source.name} (copy)`, customer: source.customer, country: source.country, region: source.region,
    category: source.category, subCategory: source.subCategory, currency: source.currency, fxRate: source.fxRate, scope: source.scope,
    createdBy: req.user._id,
  });
  await ensureDealIdentifiers(project);
  await project.save();
  if (source.currentRevision) {
    const revision = await revisionService.createRevision(project._id, source.currentRevision.engineeringInput, { userId: req.user._id });
    return res.status(201).json(apiResponse('Project duplicated successfully', true, { project, revision }));
  }
  res.status(201).json(apiResponse('Project duplicated successfully', true, { project }));
});

exports.archiveProject = asyncHandler(async (req, res, next) => {
  const project = await CommercialProject.findByIdAndUpdate(req.params.id, { archived: true, archivedAt: new Date(), archivedBy: req.user._id }, { new: true });
  if (!project) return next(new ApiError('Commercial project not found.', 404));
  res.status(200).json(apiResponse('Project archived successfully', true, project));
});

exports.listRevisions = asyncHandler(async (req, res) => {
  const revisions = await CommercialRevision.find({ project: req.params.id }).sort({ revisionNumber: -1 }).populate(STAGE_POPULATE);
  res.status(200).json(apiResponse('Revisions retrieved successfully', true, revisions));
});

// ---------------------------------------------------------------- form options + shared customers

/** The controlled vocabularies the New/Edit Project form offers (QA B2: region is a dropdown). */
exports.getFormOptions = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Form options', true, { categories: CATEGORIES, scopes: SCOPES, regionsByCountry: { Egypt: EGYPT_REGIONS }, regionRequiredCountries: RATES_MATRIX_COUNTRIES }));
});

/** QA U1 - customer lookup against the SHARED customer list, for any Commercial user. */
exports.searchCustomers = asyncHandler(async (req, res) => {
  const data = await sharedCustomers.searchCustomers(req.query.keyword, Number(req.query.limit) || 10);
  res.status(200).json(apiResponse('Customers', true, data));
});

/** QA U1 - inline "create customer" from the project form. Same rules as the ERP customer screen (name + valid unique phone). */
exports.createCustomer = asyncHandler(async (req, res) => {
  const { customer, created } = await sharedCustomers.findOrCreateCustomer({ name: req.body.name, phone: req.body.phone, email: req.body.email }, { createdBy: req.user._id });
  res.status(created ? 201 : 200).json(apiResponse(created ? 'Customer created.' : 'A customer with this phone number already exists - it has been selected.', true, { customer, created }));
});
