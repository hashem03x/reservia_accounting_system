const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const factory = require('../handlersFactory');
const Project = require('../../models/project/projectModel');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { destroyDocument } = require('../../middleware/documentUploadMiddleware');
const { createProjectCreationJournalEntry, recalculateRemainingMoney } = require('../../services/project/projectAccountingService');
const { logAccountingEvent, logAccountingError } = require('../../utils/accountingLogger');

// Project creation + its automatic accounting entry are one logical operation (see master spec's
// "TRANSACTION ATOMICITY" section) - a session/transaction is used exactly like
// expenseController.js's createExpense, so a failure creating the journal entry (e.g. the
// required default accounts aren't seeded) rolls the Project creation back too, instead of
// leaving a project that exists with no accounting behind it.
const createProject = asyncHandler(async (req, res, next) => {
  const { projectNumber, name, description, projectAmount, executor, status } = req.body;

  const session = await mongoose.startSession();
  try {
    let project;
    let journalEntry;

    await session.withTransaction(async () => {
      const [createdProject] = await Project.create(
        [
          {
            projectNumber,
            name,
            description,
            projectAmount,
            remainingMoney: projectAmount,
            executor,
            status,
            createdBy: req.user._id,
          },
        ],
        { session }
      );
      project = createdProject;

      journalEntry = await createProjectCreationJournalEntry(project, session, req.user._id);
    });

    logAccountingEvent('PROJECT_CREATED', { projectId: project._id, projectNumber: project.projectNumber, requestId: req.id });

    res.status(201).json(
      apiResponse('Project created successfully. Journal entry created successfully.', true, {
        project,
        journalEntry,
      })
    );
  } catch (err) {
    if (err.code === 11000) {
      return next(new ApiError('Project number already exists.', 400));
    }
    logAccountingError('PROJECT_ACCOUNTING_ENTRY_FAILED', err, { projectNumber, requestId: req.id });
    return next(err instanceof ApiError ? err : new ApiError('Project could not be completed because its accounting entry could not be created.', 400));
  } finally {
    session.endSession();
  }
});

const getProjects = factory.getAll(Project, 'Project');

const getProject = factory.getOne(Project);

const updateProject = asyncHandler(async (req, res, next) => {
  const project = await Project.findById(req.params.id);
  if (!project) return next(new ApiError('No project found with that id', 404));

  // projectNumber and remainingMoney are never accepted from a client request body - projectNumber
  // is immutable business-key data (see master spec), remainingMoney is always derived (see
  // projectAccountingService.js#recalculateRemainingMoney). Both are silently ignored rather than
  // rejected, matching updateCustomer's existing partial-update convention.
  const { name, description, projectAmount, executor, status } = req.body;
  if (name !== undefined) project.name = name;
  if (description !== undefined) project.description = description;
  if (executor !== undefined) project.executor = executor;
  if (status !== undefined) project.status = status;

  const amountChanged = projectAmount !== undefined && projectAmount !== project.projectAmount;
  if (projectAmount !== undefined) project.projectAmount = projectAmount;

  await project.save();

  if (amountChanged) {
    await recalculateRemainingMoney(project._id);
  }

  res.status(200).json(apiResponse('Project updated successfully', true, project));
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
