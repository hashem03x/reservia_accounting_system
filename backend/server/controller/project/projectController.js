const asyncHandler = require('express-async-handler');
const factory = require('../handlersFactory');
const Project = require('../../models/project/projectModel');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const mongoose = require('mongoose');
const apiResponse = require('../../utils/apiResponse');
const { destroyDocument } = require('../../middleware/documentUploadMiddleware');
const { sendStoredDocument } = require('../documentController');
const { decodeUploadName } = require('../../utils/uploadFileName');
const { recalculateRemainingMoney, recalculateExecutedPercentage } = require('../../services/project/projectAccountingService');
const { getNextProjectNumber } = require('../../services/project/projectNumberService');
const { resolveProjectSector } = require('../../services/project/sectorService');
const { logAccountingEvent } = require('../../utils/accountingLogger');
const { normalizeDocumentPaymentTerms, validateDocumentPaymentTerms } = require('../../utils/documentPaymentTerms');

/**
 * BOQ lines from a request (replace semantics, like averageCostLines): every line a real physical
 * product, once per BOQ, quantity > 0, unit price >= 0, currency a configured active currency (EGP
 * when omitted). A clear 400 for anything else.
 */
async function checkedBoqLines(lines) {
  if (lines === undefined) return undefined;
  if (!Array.isArray(lines)) throw new ApiError('BOQ lines must be a list.', 400);
  const Product = require('../../models/inventory/productModel'); // eslint-disable-line global-require
  const Currency = require('../../models/accounting/currencyModel'); // eslint-disable-line global-require
  const ids = lines.map(l => String(l?.product || ''));
  const products = new Map((await Product.find({ _id: { $in: ids.filter(id => mongoose.isValidObjectId(id)) } }).select('type title').lean()).map(pr => [String(pr._id), pr]));
  const seen = new Set();
  const result = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || {};
    const label = `BOQ line ${i + 1}`;
    const product = products.get(String(line.product));
    if (!product) throw new ApiError(`${label}: select a product from the catalog.`, 400);
    if (product.type === 'service') throw new ApiError(`${label}: the BOQ material breakdown is for physical products - "${product.title?.en}" is a service.`, 400);
    if (seen.has(String(line.product))) throw new ApiError(`${label}: "${product.title?.en}" is already in the BOQ - each product can appear once.`, 400);
    seen.add(String(line.product));
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    if (!(quantity > 0)) throw new ApiError(`${label}: the BOQ quantity must be greater than 0.`, 400);
    if (line.unitPrice === '' || line.unitPrice === null || line.unitPrice === undefined || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new ApiError(`${label}: the BOQ unit price is required and cannot be negative.`, 400);
    }
    const currency = (typeof line.currency === 'string' && line.currency.trim().toUpperCase()) || 'EGP';
    if (currency !== 'EGP') {
      const configured = await Currency.findOne({ code: currency }).select('isActive').lean();
      if (!configured) throw new ApiError(`${label}: "${currency}" is not a configured currency.`, 400);
      if (!configured.isActive) throw new ApiError(`${label}: the currency ${currency} is inactive.`, 400);
    }
    result.push({ product: line.product, quantity, unit: (line.unit || '').trim() || null, unitPrice, currency, notes: (line.notes || '').trim() || null });
  }
  return result;
}

// Customer payment terms of a project, checked against its contract value and start date (the
// installments' tenor is counted from the start date) - a clear 400 here; projectModel.js has the
// same rule as backstop. null/undefined = no terms.
function checkedCustomerTerms(input, { contractValue, startDate }) {
  const terms = normalizeDocumentPaymentTerms(input);
  if (!terms) return terms;
  if (terms.mode !== 'immediate' && !(Number(contractValue) > 0)) throw new ApiError('Customer payment terms need the project contract value.', 400);
  const error = validateDocumentPaymentTerms(terms, { total: contractValue, issueDate: startDate });
  if (error) throw new ApiError(`Customer payment terms: ${error}`, 400);
  return terms;
}

// `averageCostLines[].recognizedAmount` (projectModel.js) is internal bookkeeping - only ever
// advanced by accountingEventService.js#postProjectCostRecognitionJE once a posting actually
// commits, never accepted from a request body (the same "never trust a client-submitted derived
// value" rule as projectNumber/executedPercentage above). On create it always starts at 0; on
// update (replace semantics) it is carried forward from the EXISTING line with the same account,
// so editing a line's budgeted `amount` never erases how much of it has already been recognized.
function sanitizeAverageCostLines(incomingLines, existingLines = []) {
  const existingByAccount = new Map((existingLines || []).map(line => [String(line.account?._id || line.account), line.recognizedAmount || 0]));
  return (incomingLines || []).map(line => ({
    account: line.account,
    amount: line.amount,
    recognizedAmount: existingByAccount.get(String(line.account)) || 0,
  }));
}

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
  //
  // `projectNumber` is no longer accepted from the client at all (docs section "Automatic Project
  // ID Generation") - it is always server-generated via the atomic Counter-based
  // projectNumberService.js, the same mechanism journalEntryNumberService.js uses, so concurrent
  // creates can never collide. Historical projects keep whatever number they already have; this
  // only changes how a NEW project's number is populated.
  const { name, description, contractValue, projectManager, startDate, deliveryDate, status, sector, customer, averageCostLines, customerPaymentTerms, boqLines } = req.body;

  try {
    // The project number's prefix is derived from the project's SECTOR (docs section "Automatic
    // Project ID Generation" - sector-based numbering), so a sector is now required to create a
    // project - validated & resolved to its canonical, real Sector name HERE (never trusted as a
    // raw frontend string) before anything is generated or written. The fast pre-check lives in
    // projectValidators.js; this is the real backstop.
    if (!sector) {
      return next(new ApiError('A sector is required to create a project.', 400));
    }
    const canonicalSector = await resolveProjectSector(sector);

    const projectNumber = await getNextProjectNumber(canonicalSector);
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
      sector: canonicalSector,
      customer: customer || null,
      averageCostLines: sanitizeAverageCostLines(averageCostLines),
      customerPaymentTerms: checkedCustomerTerms(customerPaymentTerms, { contractValue, startDate }),
      boqLines: (await checkedBoqLines(boqLines)) || [],
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
  const { name, description, contractValue, projectManager, startDate, deliveryDate, status, sector, customer, averageCostLines, customerPaymentTerms, boqLines } = req.body;
  if (boqLines !== undefined) project.boqLines = await checkedBoqLines(boqLines);
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
  if (averageCostLines !== undefined) project.averageCostLines = sanitizeAverageCostLines(averageCostLines, project.averageCostLines);

  const contractValueChanged = contractValue !== undefined && contractValue !== project.contractValue;
  if (contractValue !== undefined) project.contractValue = contractValue;
  // After contractValue/startDate above, so the terms are checked against the values being saved; a
  // contract value change alone re-checks the existing terms too (fixed amounts cannot exceed it).
  if (customerPaymentTerms !== undefined) {
    project.customerPaymentTerms = checkedCustomerTerms(customerPaymentTerms, { contractValue: project.contractValue, startDate: project.startDate });
  } else if (project.customerPaymentTerms && (contractValueChanged || startDate !== undefined)) {
    checkedCustomerTerms(project.customerPaymentTerms.toObject(), { contractValue: project.contractValue, startDate: project.startDate });
  }

  await project.save();

  // contractValue is the denominator of Executed % (docs section "Project Executed % Calculation")
  // - changing it changes the derived percentage even with no new Sales Orders, so both derived
  // figures are recomputed together. recalculateExecutedPercentage internally posts
  // PROJECT_REVENUE_RECOGNITION if the recomputed percentage increased
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
    filename: decodeUploadName(req.file.originalname),
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


// GET /projects/:id/contract/download[?inline=1] - the contract file through the API, with its real
// name, type and .pdf extension.
const downloadContract = asyncHandler(async (req, res, next) => {
  const project = await Project.findById(req.params.id).select('contract').lean();
  if (!project) return next(new ApiError('No project found with that id', 404));
  if (!project.contract) return next(new ApiError('This project has no contract attached.', 404));
  return sendStoredDocument(res, next, { ...project.contract, documentType: 'contract' }, req.query.inline === '1');
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
  downloadContract,
  getProjectJournalEntries,
};
