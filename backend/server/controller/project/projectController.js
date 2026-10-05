const asyncHandler = require('express-async-handler');
const factory = require('../handlersFactory');
const Project = require('../../models/project/projectModel');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { destroyDocument } = require('../../middleware/documentUploadMiddleware');
const { recalculateRemainingMoney, recalculateExecutedPercentage } = require('../../services/project/projectAccountingService');
const { logAccountingEvent } = require('../../utils/accountingLogger');

// Creating a project ONLY creates the Project document - it deliberately does NOT create any
// journal entry (an earlier version of this app automatically posted a Dr Accounts Receivable /
// Cr Unearned Revenue entry here; that automatic-accounting behavior was removed per a later
// requirement - see docs/entities/projects.md). No session/transaction is needed any more since
// this is a single-document write; manual journal entries for a project (if any accounting
// treatment is wanted) are created separately via the Journal Entries module, unaffected by this
// change.
const createProject = asyncHandler(async (req, res, next) => {
  // executedPercentage is deliberately never destructured/accepted here - it is always derived
  // (docs section "Project Executed % Calculation"), see projectAccountingService.js#
  // recalculateExecutedPercentage. A brand-new project has no Sales Orders yet, so it stays at the
  // schema's own default of 0 until one is created.
  const { projectNumber, name, description, contractValue, projectManager, startDate, deliveryDate, status, sector, customer, averageCostLines } = req.body;

  try {
    const project = await Project.create({
      projectNumber,
      name,
      description,
      contractValue,
      remainingMoney: contractValue,
      projectManager,
      startDate,
      deliveryDate,
      status,
      sector: sector || null,
      customer: customer || null,
      averageCostLines: averageCostLines || [],
      createdBy: req.user._id,
    });

    logAccountingEvent('PROJECT_CREATED', { projectId: project._id, projectNumber: project.projectNumber, requestId: req.id });

    res.status(201).json(apiResponse('Project created successfully', true, project));
  } catch (err) {
    if (err.code === 11000) {
      return next(new ApiError('Project number already exists.', 400));
    }
    throw err;
  }
});

const getProjects = factory.getAll(Project, 'Project');

const getProject = factory.getOne(Project);

const updateProject = asyncHandler(async (req, res, next) => {
  const project = await Project.findById(req.params.id);
  if (!project) return next(new ApiError('No project found with that id', 404));

  // projectNumber, remainingMoney and executedPercentage are never accepted from a client request
  // body - projectNumber is immutable business-key data (see master spec), remainingMoney and
  // executedPercentage are always derived (see projectAccountingService.js#
  // recalculateRemainingMoney / #recalculateExecutedPercentage). All three are silently ignored
  // rather than rejected, matching updateCustomer's existing partial-update convention.
  const { name, description, contractValue, projectManager, startDate, deliveryDate, status, sector, customer, averageCostLines } = req.body;
  if (name !== undefined) project.name = name;
  if (description !== undefined) project.description = description;
  if (projectManager !== undefined) project.projectManager = projectManager;
  if (startDate !== undefined) project.startDate = startDate;
  if (deliveryDate !== undefined) project.deliveryDate = deliveryDate;
  if (status !== undefined) project.status = status;
  if (sector !== undefined) project.sector = sector || null;
  if (customer !== undefined) project.customer = customer || null;
  // Replace semantics (matches journalEntryController.js's handling of `lines`) - the client always
  // sends the full intended set of Average Cost lines, not a delta.
  if (averageCostLines !== undefined) project.averageCostLines = averageCostLines;

  const contractValueChanged = contractValue !== undefined && contractValue !== project.contractValue;
  if (contractValue !== undefined) project.contractValue = contractValue;

  await project.save();

  // contractValue is the denominator of Executed % (docs section "Project Executed % Calculation")
  // - changing it changes the derived percentage even with no new Sales Orders, so both derived
  // figures are recomputed together. recalculateExecutedPercentage internally posts
  // PROJECT_REVENUE_RECOGNITION/PROJECT_COST_RECOGNITION if the recomputed percentage increased
  // (see accountingEventService.js), exactly as the old manual-entry path used to.
  if (contractValueChanged) {
    await recalculateRemainingMoney(project._id);
    await recalculateExecutedPercentage(project._id);
  }

  const updated = await Project.findById(project._id);
  res.status(200).json(apiResponse('Project updated successfully', true, updated));
});

const deleteProject = asyncHandler(async (req, res, next) => {
  const project = await Project.findById(req.params.id);
  if (!project) return next(new ApiError('No project found with that id', 404));

  project.isDeleted = true;
  await project.save();

  res.status(200).json(apiResponse('Project deleted successfully', true, project));
});

const uploadContract = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('No contract file was provided.', 400));

  const project = await Project.findById(req.params.id);
  if (!project) return next(new ApiError('No project found with that id', 404));

  if (project.contract?.publicId) {
    await destroyDocument(project.contract.publicId);
  }

  project.contract = {
    url: req.file.path,
    publicId: req.file.filename,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    uploadedAt: new Date(),
    uploadedBy: req.user._id,
  };
  await project.save();

  res.status(200).json(apiResponse('Contract uploaded successfully', true, project));
});

const getContract = asyncHandler(async (req, res, next) => {
  const project = await Project.findById(req.params.id);
  if (!project) return next(new ApiError('No project found with that id', 404));
  if (!project.contract) return next(new ApiError('This project has no contract attached.', 404));

  res.status(200).json(apiResponse('Contract retrieved successfully', true, project.contract));
});

const deleteContract = asyncHandler(async (req, res, next) => {
  const project = await Project.findById(req.params.id);
  if (!project) return next(new ApiError('No project found with that id', 404));
  if (!project.contract) return next(new ApiError('This project has no contract attached.', 404));

  await destroyDocument(project.contract.publicId);
  project.contract = null;
  await project.save();

  res.status(200).json(apiResponse('Contract removed successfully', true, project));
});

const getProjectJournalEntries = asyncHandler(async (req, res, next) => {
  const project = await Project.findById(req.params.id);
  if (!project) return next(new ApiError('No project found with that id', 404));

  const entries = await JournalEntry.find({ project: project._id }).sort({ date: 1, entryNumber: 1 });
  res.status(200).json(apiResponse('Project journal entries retrieved successfully', true, entries));
});

module.exports = {
  createProject,
  getProjects,
  getProject,
  updateProject,
  deleteProject,
  uploadContract,
  getContract,
  deleteContract,
  getProjectJournalEntries,
};
