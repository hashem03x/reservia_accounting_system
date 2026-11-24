const ApiError = require('../../utils/apiError');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const CommercialApproval = require('../../models/commercial/commercialApprovalModel');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const User = require('../../models/userModel');
const { roleLabel } = require('../../utils/commercial/dealEnginePermissions');

// Reservia Commercial - the two-stage-plus-MD approval workflow (Developer Brief section 4). Server-
// enforced stage order and role (never trust a frontend-only restriction): Stage 2 cannot be set
// until Stage 1 is Approved; MD cannot be set until Stage 2 is Approved when required.
//
// Production role routing - Developer Brief section 4.1 ("Only the role for a stage can set that
// stage status") and QA finding U6 ("The user who signed Stage 1 is offered Stage 2 and MD"):
//   Stage 1  Sales & Technical            -> Commercial roles 'sales', 'technical'
//   Stage 2  Sales & Commercial Director  -> 'commercial_director'
//   MD       Managing Director            -> 'md'
// On top of the role check, segregation of duties: a person who has already decided one stage of a
// revision can never decide another stage of the SAME revision, even if their role later changes.
// Go-live Developer Pack section 5.4/5.8: BDM may also sign Stage 1 ("BDM: Sign"), alongside the
// existing Sales/Technical roles - a Sales Engineer may still only sign a deal they OWN (checked
// separately in setStageStatus below via the project's `owner` field, not here).
const STAGE_ROLES = {
  STAGE1: ['sales', 'technical', 'bdm'],
  STAGE2: ['commercial_director'],
  MD: ['md'],
};
const STAGE_FIELD = { STAGE1: 'stage1', STAGE2: 'stage2', MD: 'md' };
const STAGE_LABEL = { STAGE1: 'Stage 1', STAGE2: 'Stage 2', MD: 'MD sign-off' };
// R1: "use one set of names everywhere" - these were three different spellings of the same two
// roles before (T7): this error message joined raw codes ("sales / technical"), while waitingOn()
// spelled them out by hand ("Sales & Technical"). Both now build the label from the SAME
// dealEnginePermissions.js#ROLE_LABELS map the rest of the Deal Engine uses, so a role rename never
// has to be repeated in three places again.
const stageRoleLabel = stage => STAGE_ROLES[stage].map(roleLabel).join(' or ');

const GP_FLOOR_DEFAULT = 0.15; // ASSUMPTION per the brief section 9 - confirm with Ahmed
const MD_THRESHOLD_EGP_DEFAULT = 1500000; // brief section 9 / CRM rule

function computeMdRequired(netExclVat, mdThreshold = MD_THRESHOLD_EGP_DEFAULT) {
  return netExclVat > mdThreshold;
}

function computeReleaseStatus(revision) {
  if (revision.status === 'Draft') return 'NOT RELEASED';
  const gpOk = (revision.pricing.grossProfitPct ?? 0) >= GP_FLOOR_DEFAULT;
  const stage1Ok = revision.stage1.status === 'Approved' && gpOk;
  const stage2Ok = revision.stage2.status === 'Approved';
  const mdOk = !revision.mdRequired || revision.md.status === 'Approved';
  return stage1Ok && stage2Ok && mdOk ? 'APPROVED FOR ISSUE' : 'NOT RELEASED';
}

/** Keeps the project's list-view rollups in step with its current revision (QA U5). */
async function syncProjectRollups(revision) {
  await CommercialProject.updateOne(
    { _id: revision.project, currentRevision: revision._id },
    {
      $set: {
        engineeringApprovalRollup: revision.stage1.status === 'Approved' ? 'APPROVED' : 'PENDING',
        commercialApprovalRollup: revision.releaseStatus === 'APPROVED FOR ISSUE' ? 'APPROVED' : 'PENDING',
      },
    }
  );
}

/** The "Waiting on" line of brief 4.1: the next sign-off this revision needs, or null when released. */
function waitingOn(revision) {
  if (revision.status === 'Draft') return 'Recalculation (the revision is in Draft)';
  if (revision.stage1.status !== 'Approved') return `Stage 1 - ${stageRoleLabel('STAGE1')}`;
  if (revision.stage2.status !== 'Approved') return `Stage 2 - ${stageRoleLabel('STAGE2')}`;
  if (revision.mdRequired && revision.md.status !== 'Approved') return 'MD sign-off';
  return null;
}

async function setStageStatus(revisionId, stage, status, { userId, userRole, note = '' } = {}) {
  if (!STAGE_ROLES[stage]) throw new ApiError(`Unknown approval stage "${stage}"`, 400);
  if (!['Approved', 'Rejected'].includes(status)) throw new ApiError('Status must be Approved or Rejected.', 400);
  const roleOk = STAGE_ROLES[stage].includes(userRole);
  // Go-live Developer Pack, section 3/4: "the platform administrator must not be able to
  // impersonate the MD approval authority simply by possessing administrator permissions."
  // Feature 5 used to let a Global Super Admin sign ANY stage regardless of role, logged as an
  // override - this was the exact mechanism behind the 23 Nov incident (a Commercial Director
  // account completing an approval stage that required the MD's explicit `md` role). Removed: a
  // super admin is now bound by the SAME role check as everyone else, with no waiver.
  if (!roleOk) {
    throw new ApiError(`${STAGE_LABEL[stage]} can only be signed by ${stageRoleLabel(stage)}. Your Deal Engine role is "${userRole ? roleLabel(userRole) : 'none'}".`, 403);
  }

  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Deal Engine revision not found.', 404);
  if (!revision.isCurrent) throw new ApiError('This revision has been superseded and is read-only.', 400);
  if (revision.status === 'Draft') {
    throw new ApiError(`This revision is in Draft (${revision.invalidationReason || 'its inputs changed'}). Recalculate it on the Engineering Input tab before signing.`, 400);
  }

  // Go-live Developer Pack section 5.4/5.8: "Sales Engineer who owns the deal" - a Sales Engineer
  // (role 'sales') may sign Stage 1 only on a deal they own (commercialProjectModel.js#owner,
  // copied from the CRM lead at handoff). BDM/Technical signing Stage 1 are NOT owner-scoped - the
  // matrix gives them unconditional Stage 1 rights.
  if (stage === 'STAGE1' && userRole === 'sales') {
    const project = await CommercialProject.findById(revision.project).select('owner').lean();
    // commercialProjectModel.js's own pre(/^find/) hook ALWAYS populates `owner` (even under this
    // .select('owner').lean() query - lean only skips hydrating the result into a Mongoose
    // document, it does not stop query-building middleware from running), so `project.owner` here
    // is a populated {_id, name, email} object, never a raw id - comparing it directly as a string
    // always produced "[object Object]", meaning NO Sales Engineer could ever sign Stage 1 on ANY
    // deal, including one they genuinely own. Caught by test/golive/acceptanceScenarios.test.js
    // (8.1.2 - the one test anywhere that actually signed Stage 1 as the deal's real owner).
    const ownerId = project?.owner?._id || project?.owner;
    if (!ownerId || String(ownerId) !== String(userId)) {
      throw new ApiError('You can only sign Stage 1 on a deal you own. This deal has a different owner (or none set).', 403);
    }
  }

  const field = STAGE_FIELD[stage];
  if (revision[field].status !== 'Pending') {
    throw new ApiError(`${STAGE_LABEL[stage]} has already been decided (${revision[field].status}). Change the pricing or inputs to reopen it.`, 400);
  }

  // Segregation of duties - one person, one stage per revision. Go-live Developer Pack section
  // 3D: "no person can sign two stages of the same deal revision" - no exception, including for a
  // Global Super Admin (removed; was the exact mechanism behind the 23 Nov incident).
  for (const [otherStage, otherField] of Object.entries(STAGE_FIELD)) {
    if (otherStage === stage) continue;
    const other = revision[otherField];
    if (other?.approver && String(other.approver) === String(userId) && other.status !== 'Pending') {
      throw new ApiError(`You already signed ${STAGE_LABEL[otherStage]} of this revision - ${STAGE_LABEL[stage]} must be signed by a different person.`, 403);
    }
  }

  revision.mdRequired = computeMdRequired(revision.pricing.netExclVat, revision.mdThresholdOverride ?? MD_THRESHOLD_EGP_DEFAULT);

  if (stage === 'STAGE2' && revision.stage1.status !== 'Approved') {
    throw new ApiError('Stage 2 cannot be decided until Stage 1 is Approved.', 400);
  }
  if (stage === 'MD' && !revision.mdRequired) {
    throw new ApiError('MD sign-off is not required for this revision (net price is not above the MD threshold).', 400);
  }
  if (stage === 'MD' && revision.stage2.status !== 'Approved') {
    throw new ApiError('MD sign-off cannot be decided until Stage 2 is Approved.', 400);
  }

  const approver = await User.findById(userId).select('name').lean();
  const approverName = approver?.name || null;
  const decidedAt = new Date();
  revision[field] = { status, approver: userId, approverName, approverRole: userRole, decidedAt, note: String(note || '').slice(0, 1000) };
  revision.releaseStatus = computeReleaseStatus(revision);
  await revision.save();

  await CommercialApproval.create({
    revision: revision._id, stage, status, approver: userId, decidedAt, note: String(note || '').slice(0, 1000),
    valueSnapshot: { netExclVat: revision.pricing.netExclVat, grossProfitPct: revision.pricing.grossProfitPct },
  });
  await syncProjectRollups(revision);

  return revision;
}

async function getApprovalLog(revisionId) {
  return CommercialApproval.find({ revision: revisionId }).sort({ createdAt: 1 }).populate({ path: 'approver', select: 'name' });
}

module.exports = {
  setStageStatus,
  getApprovalLog,
  computeMdRequired,
  computeReleaseStatus,
  syncProjectRollups,
  waitingOn,
  STAGE_ROLES,
  GP_FLOOR_DEFAULT,
  MD_THRESHOLD_EGP_DEFAULT,
};
