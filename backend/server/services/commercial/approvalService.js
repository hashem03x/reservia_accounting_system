const ApiError = require('../../utils/apiError');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const CommercialApproval = require('../../models/commercial/commercialApprovalModel');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const User = require('../../models/userModel');
const { roleLabel } = require('../../utils/commercial/dealEnginePermissions');
const { fingerprints, changedParts } = require('../../utils/commercial/approvalFingerprint');

// Reservia Deal Engine - the approval workflow. Everything is enforced HERE (server side, from the
// authenticated user's own Commercial roles) - the Approvals tab only reflects it.
//
// WORKFLOW 2 (26 Nov 2026, MD instruction) - strict, sequential, three stages:
//   Stage 1  Technical Approval            -> 'technical'
//   Stage 2  Sales / BDM Approval          -> 'sales' (on a deal they own - existing rule), 'bdm'
//   Stage 3  Final Commercial Approval     -> 'commercial_director' or 'md' (the MD only when the
//                                             deal is above the MD value threshold - existing rule)
//   Fully Approved = all three Approved, in that order -> APPROVED FOR ISSUE.
// Stage 3 is stored in the revision's `md` field (and API stage "MD"/"STAGE3") so existing data and
// links keep working.
//
// Rules: no stage before the previous one is Approved; only the stage's roles; one person decides
// at most one stage of a revision (segregation of duties - existing policy); a rejection needs a
// reason; a decision is one atomic conditional update (a duplicate or concurrent request finds the
// stage already decided and gets a 409, never a second record). A recalculation resets only the
// approvals whose underlying data changed (invalidateForChanges) - technical -> all three, customer
// inputs -> Stages 2-3, prices -> Stage 3 - and a fully approved revision that changes stops being
// approved. Every decision and reset is an append-only CommercialApproval record.
//
// WORKFLOW 1 (legacy): revisions priced before workflow 2 keep the earlier 2-stage + MD rules until
// their next recalculation, which resets their sign-offs and moves them to workflow 2.

const STAGE_FIELD = { STAGE1: 'stage1', STAGE2: 'stage2', MD: 'md' };
const STAGE_ORDER = ['STAGE1', 'STAGE2', 'MD'];

const STAGE_ROLES_V2 = { STAGE1: ['technical'], STAGE2: ['sales', 'bdm'], MD: ['commercial_director', 'md'] };
const STAGE_LABEL_V2 = { STAGE1: 'Stage 1 - Technical Approval', STAGE2: 'Stage 2 - Sales / BDM Approval', MD: 'Stage 3 - Final Commercial Approval' };

// Legacy (workflow 1) routing - unchanged.
const STAGE_ROLES = { STAGE1: ['sales', 'technical', 'bdm'], STAGE2: ['commercial_director'], MD: ['md'] };
const STAGE_LABEL = { STAGE1: 'Stage 1', STAGE2: 'Stage 2', MD: 'MD sign-off' };

const isV2 = revision => revision.approvalWorkflow === 2;
const rolesFor = (revision, stage) => (isV2(revision) ? STAGE_ROLES_V2 : STAGE_ROLES)[stage];
const labelFor = (revision, stage) => (isV2(revision) ? STAGE_LABEL_V2 : STAGE_LABEL)[stage];
const stageRoleLabel = (revision, stage) => rolesFor(revision, stage).map(roleLabel).join(' or ');

const GP_FLOOR_DEFAULT = 0.15; // ASSUMPTION per the brief section 9 - confirm with Ahmed
const MD_THRESHOLD_EGP_DEFAULT = 1500000; // brief section 9 / CRM rule

function computeMdRequired(netExclVat, mdThreshold = MD_THRESHOLD_EGP_DEFAULT) {
  return netExclVat > mdThreshold;
}

function computeReleaseStatus(revision) {
  if (revision.status === 'Draft') return 'NOT RELEASED';
  const gpOk = (revision.pricing?.grossProfitPct ?? 0) >= GP_FLOOR_DEFAULT;
  if (isV2(revision)) {
    return STAGE_ORDER.every(s => revision[STAGE_FIELD[s]]?.status === 'Approved') && gpOk ? 'APPROVED FOR ISSUE' : 'NOT RELEASED';
  }
  const stage1Ok = revision.stage1.status === 'Approved' && gpOk;
  const stage2Ok = revision.stage2.status === 'Approved';
  const mdOk = !revision.mdRequired || revision.md.status === 'Approved';
  return stage1Ok && stage2Ok && mdOk ? 'APPROVED FOR ISSUE' : 'NOT RELEASED';
}

/** The deal's place in the workflow, in words (also recorded before/after on every audit record). */
function workflowStatus(revision) {
  if (revision.status === 'Draft') return 'Draft - recalculation required';
  if (!isV2(revision)) {
    if (revision.stage1.status === 'Rejected' || revision.stage2.status === 'Rejected' || revision.md.status === 'Rejected') return 'Rejected (earlier workflow)';
    return revision.releaseStatus === 'APPROVED FOR ISSUE' ? 'Fully Approved' : 'Awaiting approval (earlier workflow)';
  }
  const [s1, s2, s3] = STAGE_ORDER.map(s => revision[STAGE_FIELD[s]]?.status);
  if (s1 === 'Rejected') return 'Returned for technical revisions';
  if (s1 !== 'Approved') return 'Awaiting Technical Approval';
  if (s2 === 'Rejected') return 'Returned for revisions (Sales / BDM)';
  if (s2 !== 'Approved') return 'Awaiting Sales / BDM Approval';
  if (s3 === 'Rejected') return 'Returned for revisions (Final Commercial)';
  if (s3 !== 'Approved') return 'Awaiting Final Commercial Approval';
  return 'Fully Approved';
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

/** The "Waiting on" line: the next sign-off this revision needs, or null when fully approved. */
function waitingOn(revision) {
  if (revision.status === 'Draft') return 'Recalculation (the revision is in Draft)';
  for (const stage of STAGE_ORDER) {
    if (!isV2(revision) && stage === 'MD' && !revision.mdRequired) continue;
    if (revision[STAGE_FIELD[stage]].status !== 'Approved') return `${labelFor(revision, stage)} - ${stageRoleLabel(revision, stage)}`;
  }
  return null;
}

/**
 * Why `user` (with these Commercial roles) can NOT decide `stage` of `revision` right now, or null if
 * they can. One function for the decision itself and for the Approvals tab's buttons, so the two
 * can never disagree. `ownerId` is the deal owner (for the Sales Engineer rule).
 */
function refusal(revision, stage, { userId, roles = [], ownerId = null }) {
  const no = (reason, code) => ({ reason, code });
  if (!STAGE_FIELD[stage]) return no(`Unknown approval stage "${stage}".`, 400);
  const allowed = rolesFor(revision, stage);
  const actingRole = roles.find(r => allowed.includes(r));
  if (!actingRole) return no(`${labelFor(revision, stage)} can only be signed by ${stageRoleLabel(revision, stage)}.`, 403);
  if (!revision.isCurrent) return no('This revision has been superseded and is read-only.', 400);
  if (revision.status === 'Draft') return no(`This revision is in Draft (${revision.invalidationReason || 'its inputs changed'}). Recalculate it on the Engineering Input tab before signing.`, 400);
  const field = STAGE_FIELD[stage];
  if (revision[field].status !== 'Pending') return no(`${labelFor(revision, stage)} has already been decided (${revision[field].status}). Change the pricing or inputs to reopen it.`, 409);
  const idx = STAGE_ORDER.indexOf(stage);
  for (const prev of STAGE_ORDER.slice(0, idx)) {
    if (!isV2(revision) && prev === 'MD') continue;
    if (revision[STAGE_FIELD[prev]].status !== 'Approved') return no(`${labelFor(revision, stage)} cannot be decided until ${labelFor(revision, prev)} is Approved.`, 400);
  }
  // Sales Engineer: only on a deal they own (existing policy; BDM is not owner-scoped).
  const ownerStage = isV2(revision) ? 'STAGE2' : 'STAGE1';
  if (stage === ownerStage && actingRole === 'sales' && !roles.some(r => r !== 'sales' && allowed.includes(r))) {
    if (!ownerId || String(ownerId) !== String(userId)) return no(`You can only sign ${labelFor(revision, stage)} on a deal you own. This deal has a different owner (or none set).`, 403);
  }
  // Segregation of duties: one person, one stage per revision (no exception).
  for (const other of STAGE_ORDER) {
    if (other === stage) continue;
    const o = revision[STAGE_FIELD[other]];
    if (o?.approver && String(o.approver._id || o.approver) === String(userId) && o.status !== 'Pending') {
      return no(`You already signed ${labelFor(revision, other)} of this revision - ${labelFor(revision, stage)} must be signed by a different person.`, 403);
    }
  }
  if (isV2(revision) && stage === 'MD') {
    const mdRequired = computeMdRequired(revision.pricing?.netExclVat ?? 0, revision.mdThresholdOverride ?? MD_THRESHOLD_EGP_DEFAULT);
    if (mdRequired && !roles.includes('md')) return no('This deal is above the MD approval threshold - the final commercial approval must be given by the MD.', 403);
  }
  if (!isV2(revision) && stage === 'MD') {
    const mdRequired = computeMdRequired(revision.pricing.netExclVat, revision.mdThresholdOverride ?? MD_THRESHOLD_EGP_DEFAULT);
    if (!mdRequired) return no('MD sign-off is not required for this revision (net price is not above the MD threshold).', 400);
  }
  return null;
}

/** Why the user can NOT decide the stage now (text), or null. */
function cannotDecideReason(revision, stage, ctx) {
  return refusal(revision, stage, ctx)?.reason || null;
}

function actingRoleFor(revision, stage, roles) {
  const allowed = rolesFor(revision, stage);
  // The most senior matching role is recorded (md before commercial_director).
  return ['md', 'commercial_director', 'bdm', 'sales', 'technical'].find(r => roles.includes(r) && allowed.includes(r)) || null;
}

/** An audit record (append-only). */
async function audit(revision, { stage, action, status, userId, userName, role, note, workflowBefore, workflowAfter }) {
  return CommercialApproval.create({
    revision: revision._id,
    project: revision.project?._id || revision.project,
    stage, status, action,
    approver: userId,
    approverName: userName || null,
    approverRole: role || null,
    decidedAt: new Date(),
    note: String(note || '').slice(0, 1000),
    revisionNumber: revision.revisionNumber,
    calculatedAt: revision.lastCalculatedAt || null,
    basis: revision.approvalBasis || null,
    workflowBefore, workflowAfter,
    workflowVersion: isV2(revision) ? 2 : 1,
    valueSnapshot: { netExclVat: revision.pricing?.netExclVat ?? null, grossProfitPct: revision.pricing?.grossProfitPct ?? null },
  });
}

/**
 * Decides one stage. `roles` = the authenticated user's active Commercial roles (never a value from
 * the request). `expectedCalculatedAt` (optional) = the calculation the approver was looking at; if
 * the revision was recalculated since, the decision is refused (409) instead of approving figures the
 * approver never saw.
 */
async function setStageStatus(revisionId, rawStage, status, { userId, userRole, roles, note = '', expectedCalculatedAt = null } = {}) {
  const stage = String(rawStage || '').toUpperCase() === 'STAGE3' ? 'MD' : String(rawStage || '').toUpperCase();
  const userRoles = Array.isArray(roles) && roles.length ? roles : userRole ? [userRole] : [];
  if (!STAGE_FIELD[stage]) throw new ApiError(`Unknown approval stage "${rawStage}"`, 400);
  if (!['Approved', 'Rejected'].includes(status)) throw new ApiError('Status must be Approved or Rejected.', 400);

  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Deal Engine revision not found.', 404);
  const project = await CommercialProject.findById(revision.project).select('owner').lean();
  const ownerId = project?.owner?._id || project?.owner || null;

  const refused = refusal(revision, stage, { userId, roles: userRoles, ownerId });
  if (refused) throw new ApiError(refused.reason, refused.code);
  if (status === 'Rejected' && isV2(revision) && !String(note || '').trim()) {
    throw new ApiError('Give the reason for returning the deal (it is recorded and shown to the team).', 400);
  }
  if (expectedCalculatedAt && revision.lastCalculatedAt && new Date(expectedCalculatedAt).getTime() !== new Date(revision.lastCalculatedAt).getTime()) {
    throw new ApiError('This revision was recalculated after you opened it - refresh and review the new figures before deciding.', 409);
  }
  if (isV2(revision) && stage === 'MD' && status === 'Approved' && (revision.pricing?.grossProfitPct ?? 0) < GP_FLOOR_DEFAULT) {
    throw new ApiError(`Gross profit is below the ${GP_FLOOR_DEFAULT * 100}% floor - the deal cannot be finally approved. Return it for revisions.`, 400);
  }

  const field = STAGE_FIELD[stage];
  const role = actingRoleFor(revision, stage, userRoles);
  const approver = await User.findById(userId).select('name').lean();
  const approverName = approver?.name || null;
  const decidedAt = new Date();
  const workflowBefore = workflowStatus(revision);

  // The decision as it will be stored, applied to a copy to compute the resulting statuses.
  const decided = {
    status, approver: userId, approverName, approverRole: role, decidedAt, note: String(note || '').slice(0, 1000),
    requiresReapproval: false, revisionNumber: revision.revisionNumber, calculatedAt: revision.lastCalculatedAt || null, basis: revision.approvalBasis || null,
  };
  revision[field] = decided;
  if (!isV2(revision)) revision.mdRequired = computeMdRequired(revision.pricing.netExclVat, revision.mdThresholdOverride ?? MD_THRESHOLD_EGP_DEFAULT);
  const releaseStatus = computeReleaseStatus(revision);
  const set = { [field]: decided, releaseStatus };
  if (!isV2(revision)) set.mdRequired = revision.mdRequired;
  if (isV2(revision) && stage === 'MD' && status === 'Approved') {
    set.finalApproval = { approvedAt: decidedAt, by: userId, byName: approverName, byRole: role, revisionNumber: revision.revisionNumber, calculatedAt: revision.lastCalculatedAt || null, basis: revision.approvalBasis || null };
  }

  // Atomic: only if the stage is still Pending, the earlier stages still Approved and the revision
  // was not recalculated meanwhile - a duplicate/concurrent request matches nothing.
  const guard = { _id: revision._id, isCurrent: true, status: { $ne: 'Draft' }, [`${field}.status`]: 'Pending' };
  for (const prev of STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage))) if (isV2(revision) || prev !== 'MD') guard[`${STAGE_FIELD[prev]}.status`] = 'Approved';
  guard.lastCalculatedAt = revision.lastCalculatedAt ?? null;
  const updated = await CommercialRevision.findOneAndUpdate(guard, { $set: set }, { new: true });
  if (!updated) throw new ApiError(`${labelFor(revision, stage)} was just decided by someone else, or the revision changed - refresh and try again.`, 409);

  await audit(updated, { stage, action: status, status, userId, userName: approverName, role, note, workflowBefore, workflowAfter: workflowStatus(updated) });
  await syncProjectRollups(updated);
  return updated;
}

/**
 * Re-approval after a recalculation (workflow 2): resets the approvals whose underlying data changed
 * - technical -> all three stages; customer inputs -> Stages 2 and 3; prices -> Stage 3 - and keeps
 * the others. A Rejected stage whose data changed goes back to Pending (the correction is
 * resubmitted). An Approved stage that is reset is flagged "Requires Reapproval". Mutates `revision`
 * (the caller saves it); returns the audit rows to append after the save.
 */
function invalidateForChanges(revision, beforeBasis, afterBasis, { userId = null, userName = null, role = null } = {}) {
  const changed = changedParts(beforeBasis, afterBasis);
  const toReset = new Set();
  if (changed.technical) STAGE_ORDER.forEach(s => toReset.add(s));
  if (changed.customer) ['STAGE2', 'MD'].forEach(s => toReset.add(s));
  if (changed.commercial) toReset.add('MD');
  const what = [changed.technical && 'engineering / BOQ quantities', changed.customer && 'customer inputs', changed.commercial && 'prices'].filter(Boolean).join(', ');
  const rows = [];
  const workflowBefore = workflowStatus(revision);
  for (const stage of STAGE_ORDER) {
    if (!toReset.has(stage)) continue;
    const field = STAGE_FIELD[stage];
    const cur = revision[field];
    if (!cur || cur.status === 'Pending') continue;
    rows.push({ stage, previous: cur.status });
    revision[field] = {
      status: 'Pending', approver: null, approverName: null, approverRole: null, decidedAt: null,
      note: `Reset: ${what} changed after this stage was ${cur.status.toLowerCase()} (revision ${revision.revisionNumber}).`,
      requiresReapproval: cur.status === 'Approved' || !!cur.requiresReapproval,
      revisionNumber: null, calculatedAt: null, basis: null,
    };
  }
  if (rows.length && toReset.has('MD')) revision.finalApproval = { approvedAt: null, by: null, byName: null, byRole: null, revisionNumber: null, calculatedAt: null, basis: null };
  revision.releaseStatus = computeReleaseStatus(revision);
  const workflowAfter = workflowStatus(revision);
  return rows.map(r => ({ stage: r.stage, action: 'Reset', status: 'Pending', userId, userName, role, note: `Reset from ${r.previous}: ${what} changed.`, workflowBefore, workflowAfter }));
}

/** Appends the reset rows produced by invalidateForChanges (after the revision is saved). */
async function recordResets(revision, rows) {
  for (const r of rows) {
    if (!r.userId) continue; // system resets without an actor are reflected on the stage itself
    // eslint-disable-next-line no-await-in-loop
    await audit(revision, r);
  }
}

/** The approval history of a revision (oldest first). */
async function getApprovalLog(revisionId) {
  return CommercialApproval.find({ revision: revisionId }).sort({ createdAt: 1 }).populate({ path: 'approver', select: 'name' });
}

/**
 * The Approvals tab: the three stages with status / approver / date / reason / revision, whether THIS
 * user may act on each (same rules as setStageStatus), and the deal's whole approval timeline across
 * its revisions (decisions, resets, revisions created).
 */
async function getWorkflowView(revisionId, { userId, roles = [] }) {
  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Deal Engine revision not found.', 404);
  const project = await CommercialProject.findById(revision.project).select('owner').lean();
  const ownerId = project?.owner?._id || project?.owner || null;
  const stages = STAGE_ORDER.filter(s => isV2(revision) || s !== 'MD' || revision.mdRequired || revision.md.status !== 'Pending').map((stage, i) => {
    const st = revision[STAGE_FIELD[stage]] || {};
    const why = cannotDecideReason(revision, stage, { userId, roles, ownerId });
    return {
      key: stage,
      apiStage: stage === 'MD' ? 'STAGE3' : stage,
      number: i + 1,
      label: labelFor(revision, stage),
      approvers: stageRoleLabel(revision, stage),
      status: st.status || 'Pending',
      displayStatus: st.status === 'Pending' && st.requiresReapproval ? 'Requires Reapproval' : st.status || 'Pending',
      approverName: st.approverName || null,
      approverRole: st.approverRole ? roleLabel(st.approverRole) : null,
      decidedAt: st.decidedAt || null,
      note: st.note || '',
      revisionNumber: st.revisionNumber ?? null,
      canAct: !why,
      // Only explained to someone holding the stage's role (others just see it read-only).
      cannotActReason: why && rolesFor(revision, stage).some(r => roles.includes(r)) ? why : null,
    };
  });
  const revisions = await CommercialRevision.find({ project: revision.project }).select('revisionNumber createdAt isCurrent').sort({ revisionNumber: 1 }).lean();
  const records = await CommercialApproval.find({ revision: { $in: revisions.map(r => r._id) } }).sort({ createdAt: 1 }).lean();
  const timeline = [
    ...revisions.map(r => ({ at: r.createdAt, kind: 'revision', revisionNumber: r.revisionNumber, text: `Revision ${r.revisionNumber} created${r.isCurrent ? ' (current)' : ''}` })),
    ...records.map(a => ({
      at: a.decidedAt || a.createdAt, kind: 'approval', stage: a.stage, stageLabel: (a.workflowVersion === 2 ? STAGE_LABEL_V2 : STAGE_LABEL)[a.stage] || a.stage,
      action: a.action || a.status, revisionNumber: a.revisionNumber ?? revisions.find(r => String(r._id) === String(a.revision))?.revisionNumber ?? null,
      byName: a.approverName || null, byRole: a.approverRole ? roleLabel(a.approverRole) : null, note: a.note || '', workflowBefore: a.workflowBefore, workflowAfter: a.workflowAfter,
    })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
  return {
    revisionId: revision._id,
    revisionNumber: revision.revisionNumber,
    isCurrent: revision.isCurrent,
    workflowVersion: isV2(revision) ? 2 : 1,
    workflowStatus: workflowStatus(revision),
    fullyApproved: revision.releaseStatus === 'APPROVED FOR ISSUE',
    finalApproval: revision.finalApproval?.approvedAt ? { approvedAt: revision.finalApproval.approvedAt, byName: revision.finalApproval.byName, byRole: roleLabel(revision.finalApproval.byRole), revisionNumber: revision.finalApproval.revisionNumber, calculatedAt: revision.finalApproval.calculatedAt } : null,
    stages,
    timeline,
  };
}

module.exports = {
  setStageStatus,
  getApprovalLog,
  getWorkflowView,
  invalidateForChanges,
  recordResets,
  cannotDecideReason,
  computeMdRequired,
  computeReleaseStatus,
  syncProjectRollups,
  waitingOn,
  workflowStatus,
  fingerprints,
  STAGE_ROLES,
  STAGE_ROLES_V2,
  GP_FLOOR_DEFAULT,
  MD_THRESHOLD_EGP_DEFAULT,
};
