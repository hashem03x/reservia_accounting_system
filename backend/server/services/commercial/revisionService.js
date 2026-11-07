const ApiError = require('../../utils/apiError');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const boqService = require('./boqService');

// Reservia Commercial - revision lifecycle. Mirrors services/crm/quotationService.js's
// versioning: creating a new revision never edits a previous one, it flips the previous
// `isCurrent` to false and inserts a fresh document. Only the current revision is ever
// recomputed; superseded ones are a frozen historical snapshot from here on.

async function computeAndSave(project, engineeringInput, { manualOverrides = {}, pricingOverrides = {}, userId } = {}) {
  const vatPct = project.country === 'Saudi Arabia' ? 0.15 : project.country === 'Egypt' ? 0.14 : pricingOverrides.vatPct;
  if (vatPct === undefined) throw new ApiError(`VAT rate is not known for country "${project.country}" - enter it explicitly.`, 400);

  const { engineeringResult, lines, boqTotal, kWp, feasibility, dieselComparison } = await boqService.buildBoq({
    category: project.category, engineeringInput, country: project.country, region: project.region, manualOverrides,
  });
  const pricing = await boqService.priceBoq({ category: project.category, boqTotal, kWp, vatPct, overrides: pricingOverrides });

  return {
    engineeringInput, engineeringResult, boqLines: lines, boqTotal, pricing,
    feasibility: feasibility || null, dieselComparison: dieselComparison || null, createdBy: userId,
  };
}

async function createRevision(projectId, engineeringInput, opts = {}) {
  const project = await CommercialProject.findById(projectId);
  if (!project) throw new ApiError('Commercial project not found.', 404);

  const computed = await computeAndSave(project, engineeringInput, opts);
  const previousCount = await CommercialRevision.countDocuments({ project: project._id });

  if (previousCount > 0) {
    await CommercialRevision.updateMany({ project: project._id, isCurrent: true }, { $set: { isCurrent: false } });
  }

  const revision = await CommercialRevision.create({
    project: project._id,
    revisionNumber: previousCount + 1,
    isCurrent: true,
    ...computed,
  });

  project.currentRevision = revision._id;
  await project.save();
  return revision;
}

/** Only the CURRENT revision may be recomputed. Re-approval rule: editing inputs after a sign-off resets that stage to Pending (the approval log keeps the earlier decision - see approvalService.js). */
async function recomputeCurrentRevision(revisionId, engineeringInput, opts = {}) {
  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Commercial revision not found.', 404);
  if (!revision.isCurrent) throw new ApiError('This revision has been superseded and is read-only. Create a new revision instead.', 400);

  const project = await CommercialProject.findById(revision.project);
  const computed = await computeAndSave(project, engineeringInput, opts);

  const resetStage = stage => (revision[stage].status === 'Approved' ? { status: 'Pending', approver: null, decidedAt: null, note: 'Reset: engineering input or pricing changed after sign-off.' } : revision[stage]);
  revision.stage1 = resetStage('stage1');
  revision.stage2 = resetStage('stage2');
  revision.md = resetStage('md');
  revision.releaseStatus = 'NOT RELEASED';

  Object.assign(revision, computed);
  await revision.save();
  return revision;
}

module.exports = { createRevision, recomputeCurrentRevision };
