const asyncHandler = require('express-async-handler');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const ApiFeatures = require('../../utils/apiFeatures');
const { getNextProjectCode } = require('../../services/commercial/projectCodeService');
const revisionService = require('../../services/commercial/revisionService');

// Matches handlersFactory.getAll()'s own response shape ({results, paginationResult, data}),
// which the frontend's PaginatedData<T> type expects.
exports.listProjects = asyncHandler(async (req, res) => {
  const filter = { archived: false };
  if (req.query.category) filter.category = req.query.category;
  const countDocuments = await CommercialProject.countDocuments(filter);
  const mongooseQuery = CommercialProject.find(filter);
  const { mongooseQuery: query, paginationResult } = new ApiFeatures(mongooseQuery, req.query).paginate(countDocuments).sort().filter(filter).limitFields();
  const projects = await query;
  res.status(200).json({ results: projects.length, paginationResult, data: projects });
});

exports.getProject = asyncHandler(async (req, res, next) => {
  const project = await CommercialProject.findById(req.params.id).populate('currentRevision');
  if (!project) return next(new ApiError('Commercial project not found.', 404));
  res.status(200).json(apiResponse('Project retrieved successfully', true, project));
});

/** Creates the project header and, if engineeringInput is supplied, its first revision in one call. */
exports.createProject = asyncHandler(async (req, res) => {
  const { engineeringInput, ...projectFields } = req.body;
  const projectCode = await getNextProjectCode(projectFields.category);
  const project = await CommercialProject.create({ ...projectFields, projectCode, createdBy: req.user._id });

  if (engineeringInput) {
    const revision = await revisionService.createRevision(project._id, engineeringInput, { userId: req.user._id });
    return res.status(201).json(apiResponse('Project and first revision created successfully', true, { project, revision }));
  }
  res.status(201).json(apiResponse('Project created successfully', true, { project }));
});

exports.updateProject = asyncHandler(async (req, res, next) => {
  const { engineeringInput, ...projectFields } = req.body;
  const project = await CommercialProject.findByIdAndUpdate(req.params.id, { $set: projectFields }, { new: true });
  if (!project) return next(new ApiError('Commercial project not found.', 404));
  res.status(200).json(apiResponse('Project updated successfully', true, project));
});

exports.duplicateProject = asyncHandler(async (req, res, next) => {
  const source = await CommercialProject.findById(req.params.id).populate('currentRevision');
  if (!source) return next(new ApiError('Commercial project not found.', 404));
  const projectCode = await getNextProjectCode(source.category);
  const project = await CommercialProject.create({
    projectCode, name: `${source.name} (copy)`, customer: source.customer, country: source.country, region: source.region,
    category: source.category, subCategory: source.subCategory, currency: source.currency, fxRate: source.fxRate, scope: source.scope,
    createdBy: req.user._id,
  });
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
  const revisions = await CommercialRevision.find({ project: req.params.id }).sort({ revisionNumber: -1 });
  res.status(200).json(apiResponse('Revisions retrieved successfully', true, revisions));
});
