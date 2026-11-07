const ApiError = require('../../utils/apiError');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const CommercialApproval = require('../../models/commercial/commercialApprovalModel');

// Reservia Commercial - the two-stage-plus-MD approval workflow (Developer Brief section 4: a
// BUSINESS RULE, not something any of the three Excel workbooks define - none of them have an
// approval workflow at all). Server-enforced stage order (never trust a frontend-only restriction,
// per the project's own explicit rule): Stage 2 cannot be set until Stage 1 is Approved; MD cannot
// be set until Stage 2 is Approved when required.
//
// Role-to-stage mapping is a judgment call (the brief names roles descriptively, not as a fixed
// enum) - flagged in the implementation plan as configurable, same spirit as the brief's own
// "open decisions" table.
const STAGE_ROLES = {
  STAGE1: ['sales', 'technical', 'commercial_director', 'md'],
  STAGE2: ['commercial_director', 'md'],
  MD: ['md'],
};

const GP_FLOOR_DEFAULT = 0.15; // ASSUMPTION per the brief section 9 - confirm with Ahmed
const MD_THRESHOLD_EGP_DEFAULT = 1500000; // brief section 9 / CRM rule

function computeMdRequired(netExclVat, mdThreshold = MD_THRESHOLD_EGP_DEFAULT) {
  return netExclVat > mdThreshold;
}

function computeReleaseStatus(revision) {
  const gpOk = (revision.pricing.grossProfitPct ?? 0) >= GP_FLOOR_DEFAULT;
  const stage1Ok = revision.stage1.status === 'Approved' && gpOk;
  const stage2Ok = revision.stage2.status === 'Approved';
  const mdOk = !revision.mdRequired || revision.md.status === 'Approved';
  return stage1Ok && stage2Ok && mdOk ? 'APPROVED FOR ISSUE' : 'NOT RELEASED';
}

async function setStageStatus(revisionId, stage, status, { userId, userRole, note = '' } = {}) {
  if (!['STAGE1', 'STAGE2', 'MD'].includes(stage)) throw new ApiError(`Unknown approval stage "${stage}"`, 400);
  if (!STAGE_ROLES[stage].includes(userRole)) throw new ApiError(`Your Commercial role ("${userRole}") cannot decide on ${stage}.`, 403);

  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Commercial revision not found.', 404);
  if (!revision.isCurrent) throw new ApiError('This revision has been superseded and is read-only.', 400);

  revision.mdRequired = computeMdRequired(revision.pricing.netExclVat, revision.mdThresholdOverride ?? MD_THRESHOLD_EGP_DEFAULT);

  if (stage === 'STAGE2' && revision.stage1.status !== 'Approved') {
    throw new ApiError('Stage 2 cannot be decided until Stage 1 is Approved.', 400);
  }
  if (stage === 'MD' && revision.stage2.status !== 'Approved') {
    throw new ApiError('MD sign-off cannot be decided until Stage 2 is Approved.', 400);
  }

  const field = stage === 'STAGE1' ? 'stage1' : stage === 'STAGE2' ? 'stage2' : 'md';
  revision[field] = { status, approver: userId, decidedAt: new Date(), note };
  revision.releaseStatus = computeReleaseStatus(revision);
  await revision.save();

  await CommercialApproval.create({
    revision: revision._id, stage, status, approver: userId, note,
    valueSnapshot: { netExclVat: revision.pricing.netExclVat, grossProfitPct: revision.pricing.grossProfitPct },
  });

  return revision;
}

async function getApprovalLog(revisionId) {
  return CommercialApproval.find({ revision: revisionId }).sort({ createdAt: 1 }).populate({ path: 'approver', select: 'name' });
}

module.exports = { setStageStatus, getApprovalLog, computeMdRequired, computeReleaseStatus, STAGE_ROLES, GP_FLOOR_DEFAULT, MD_THRESHOLD_EGP_DEFAULT };
