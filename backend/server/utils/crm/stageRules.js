// Stage-transition rule engine (Reservia CRM Developer Brief, section 7 "Rules that must not
// change" + the supplied reference sample's `validate()`, extended by Change Request 2, item 1).
// Pure, DB-free - the caller (services/crm/leadService.js#changeStage) resolves the lead's current
// state and the acting user's CRM role first, then this module is the single place every rule is
// checked, for both the real API and any future bulk/automation path, so the rules can never
// drift between callers.
//
// Change Request 2, item 1: "A lead moved from Contacted straight to Site survey. Dashboard showed
// Qualified 0 and Surveys 1... We prefer blocking, with an MD override and a logged reason." Open
// stages now advance strictly ONE stage at a time (New -> Contacted -> Qualified -> Site survey ->
// Proposal sent -> Negotiation), exactly mirroring the existing one-stage-back rule. Won/Lost keep
// their own rules below.
//
// Every rule carries a stable `code` and an `overridable` flag. Only PATH/ORDER rules are
// overridable by the MD (skipping a stage, moving back more than one stage, Won from a stage with
// no proposal, reopening a lost lead somewhere other than Contacted). Rules that protect DATA
// INTEGRITY never are: a won deal stays won, Lost needs a reason, Won needs a contract value, the
// follow-up date stays mandatory, and the technical role's restrictions stay in force.

const STAGES = ['new', 'contacted', 'qualified', 'site_survey', 'proposal_sent', 'negotiation', 'won', 'lost'];
// The six "working" stages a deal moves through before it is decided - 'won'/'lost' are terminal
// and follow their own separate rules below, never this list's adjacency checks.
const OPEN_STAGES = ['new', 'contacted', 'qualified', 'site_survey', 'proposal_sent', 'negotiation'];
// Go-live Developer Pack, section 3/5.1: one EGP 1,500,000 net threshold everywhere - was
// 1,000,000 here (F7). Keep this in sync with frontend/src/pages/crm/_shared/lead-display.ts's
// own copy and services/commercial/approvalService.js's (already-correct) Deal Engine threshold.
const MD_APPROVAL_THRESHOLD_EGP = 1_500_000;
// Go-live section 5.5: Sales and Technical Engineers' real CRM role (sales_viewer) can never move
// a lead to a different stage at all - view leads and edit only their own assigned tasks. This is
// a full block with no exception (unlike the legacy `technical` role's older, narrower
// site_survey/proposal_sent-only restriction below, left as-is for backward compatibility).
const STAGE_MOVE_BLOCKED_ROLES = ['sales_viewer'];
// Go-live section 5.5: Mark Won is never available to Sales/Technical Engineers (sales_viewer) or
// the Marketing Coordinator - only md/admin/bdm/commercial_director, subject to the MD threshold
// above. technical is already blocked structurally (TECHNICAL_RESTRICTED - 'won' is not one of
// its two allowed destinations).
const WON_BLOCKED_ROLES = ['sales_viewer', 'marketing'];
// Follow-up becomes mandatory from 'qualified' onwards (index 2) - matches the brief's "Qualified
// and subsequent applicable stages require a follow-up date."
const FOLLOW_UP_REQUIRED_FROM_INDEX = 2;

// Global Super Admin (Feature 5) - testing needs to reopen a Won deal, reopen a lost lead
// regardless of role, and bypass the technical role's restricted destinations, none of which a
// real MD can do today. `superAdminOverridable` marks exactly those three as ALSO overridable by
// a globalSuperAdmin actor (utils/systemAccess.js#isGlobalSuperAdmin), still only with an explicit
// overrideReason (same requirement as the MD path) so the audit trail is never silent. Every other
// non-overridable rule here protects DATA the automatic Won -> ERP financial handoff depends on
// (a real value, a real reason, a real follow-up date, the governorate the Rates region needs, a
// deal that is actually in sync and ready) - per the explicit instruction "unrestricted business
// permissions do NOT mean... bypassing... accounting invariants", these stay hard-blocked for
// EVERY actor, super admin included.
const RULES = {
  SAME_STAGE: { message: 'The lead is already in that stage.', overridable: false },
  WON_IS_FINAL: { message: 'A won deal cannot change stage. Open a new lead for new work.', overridable: false, superAdminOverridable: true },
  LOST_REOPEN_TARGET: { message: 'A lost lead can only be reopened to Contacted.', overridable: true },
  LOST_REOPEN_ROLE: { message: 'Only Admin or the MD can reopen a lost lead.', overridable: false, superAdminOverridable: true },
  LOST_REASON_REQUIRED: { message: 'Choose a lost reason.', overridable: false },
  WON_REQUIRES_PROPOSAL: { message: 'Only a lead with a proposal can be marked won.', overridable: true },
  WON_VALUE_REQUIRED: { message: 'Enter the contract value.', overridable: false },
  MD_APPROVAL_REQUIRED: { message: 'Contracts above EGP 1,500,000 need MD approval.', overridable: false },
  WON_ROLE_RESTRICTED: { message: 'This role cannot mark a lead Won.', overridable: false },
  STAGE_MOVE_ROLE_RESTRICTED: { message: 'This role cannot move a lead to a different stage - view only, plus your own assigned tasks.', overridable: false },
  STAGE_SKIP: { message: null, overridable: true }, // message built per transition, see below
  BACK_MORE_THAN_ONE: { message: 'A lead can only move back one stage at a time.', overridable: true },
  FOLLOW_UP_REQUIRED: { message: 'Set a follow-up date.', overridable: false },
  TECHNICAL_RESTRICTED: { message: 'Technical can move leads to Site survey or Proposal sent only.', overridable: false, superAdminOverridable: true },
  // CRM Changes Required (12 Nov 2026), item 1: the Deal Engine handoff needs the governorate (it
  // decides the Rates region), so it is asked for at Qualified at the latest - never discovered as a
  // failed sync at Proposal sent. Data integrity: not overridable.
  GOVERNORATE_REQUIRED: { message: 'Set the governorate before moving the lead to Qualified or beyond (the Deal Engine needs it for the Rates region).', overridable: false },
  // Same item: "Block Won ... when the Commercial sync has failed. Keep the Retry button." A Won lead
  // must never be left without its Deal Engine deal. Message built per lead (the sync's own error).
  DEAL_SYNC_FAILED: { message: null, overridable: false },
  // Won to ERP Handover, Changes Required (19 Nov 2026), W1-W3 / CRM Pending Fixes item 12: Won
  // must not be reachable while the linked deal has no ISSUED proposal, or Stage 1/Stage 2/MD
  // sign-off are still pending, or any BOQ line is unpriced / site costs (installation,
  // transport) are missing. Deliberately a SEPARATE code from DEAL_SYNC_FAILED above - that one's
  // fixed message ("press Retry on the Deal Engine card") would be actively wrong guidance here;
  // the actual fix is to finish the deal's approvals/pricing, not retry a sync. Not overridable -
  // the whole point of requiring MD sign-off is that the MD cannot wave past needing it.
  WON_GATE_NOT_READY: { message: null, overridable: false },
};

const STAGE_LABELS = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  site_survey: 'Site survey',
  proposal_sent: 'Proposal sent',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};

function violation(code, message) {
  return { code, message: message || RULES[code].message, overridable: RULES[code].overridable, superAdminOverridable: !!RULES[code].superAdminOverridable };
}

/**
 * Evaluates a transition and returns every rule it breaks, with codes.
 *
 * @param {object} ctx
 * @param {string} ctx.from - current stage
 * @param {string} ctx.to - requested stage
 * @param {string} ctx.role - the acting user's CRM role ('md'|'admin'|'sales'|'technical')
 * @param {number|null} ctx.valueEgp - the deal value that WOULD apply after this move
 * @param {string|null} ctx.lostReason
 * @param {string|Date|null} ctx.followUpAt - the follow-up date that WOULD apply after this move
 * @param {boolean} ctx.mdApproved - an MD approval already on the lead, or the actor being the MD
 * @param {string|null} [ctx.governorate] - the governorate that WOULD apply after this move. Checked
 *   only when the key is present (the lead service always passes it; older pure callers did not).
 * @param {string|null} [ctx.dealBlocker] - why the lead's Deal Engine deal is missing or out of
 *   sync (null when it is fine). Only consulted for a move to Won.
 * @param {string|null} [ctx.wonGateBlocker] - W1-W3: why the deal is not ready to be marked Won
 *   even though it IS in sync - no issued proposal, approvals pending, or the BOQ is not fully
 *   priced (null when it is ready). Only consulted for a move to Won, and only when dealBlocker is
 *   itself null (a sync failure is reported as that, more specific, problem first).
 * @returns {{code: string, message: string, overridable: boolean}[]} empty means allowed
 */
function evaluateStageTransition(ctx) {
  if (ctx.from === ctx.to) return [violation('SAME_STAGE')];
  const violations = [];

  if (ctx.from === 'won') violations.push(violation('WON_IS_FINAL'));
  if (ctx.from === 'lost' && ctx.to !== 'contacted') violations.push(violation('LOST_REOPEN_TARGET'));
  if (ctx.from === 'lost' && !['admin', 'md'].includes(ctx.role)) violations.push(violation('LOST_REOPEN_ROLE'));

  const fromIndex = OPEN_STAGES.indexOf(ctx.from);
  const toIndex = OPEN_STAGES.indexOf(ctx.to);

  if (ctx.to === 'lost') {
    if (!ctx.lostReason) violations.push(violation('LOST_REASON_REQUIRED'));
  } else if (ctx.to === 'won') {
    if (!['proposal_sent', 'negotiation'].includes(ctx.from)) violations.push(violation('WON_REQUIRES_PROPOSAL'));
    if (!ctx.valueEgp || ctx.valueEgp <= 0) violations.push(violation('WON_VALUE_REQUIRED'));
    if (WON_BLOCKED_ROLES.includes(ctx.role)) violations.push(violation('WON_ROLE_RESTRICTED'));
    if ((ctx.valueEgp || 0) > MD_APPROVAL_THRESHOLD_EGP && !ctx.mdApproved && ctx.role !== 'md') {
      violations.push(violation('MD_APPROVAL_REQUIRED'));
    }
  } else if (fromIndex !== -1 && toIndex !== -1) {
    if (toIndex > fromIndex + 1) {
      const skipped = OPEN_STAGES.slice(fromIndex + 1, toIndex).map(s => STAGE_LABELS[s]);
      violations.push(
        violation(
          'STAGE_SKIP',
          `A lead must pass through every stage in order - move it to ${STAGE_LABELS[OPEN_STAGES[fromIndex + 1]]} first (skipping: ${skipped.join(', ')}).`
        )
      );
    } else if (toIndex < fromIndex - 1) {
      violations.push(violation('BACK_MORE_THAN_ONE'));
    }
  }

  if ('governorate' in ctx && (ctx.to === 'won' || (toIndex !== -1 && toIndex >= FOLLOW_UP_REQUIRED_FROM_INDEX)) && !String(ctx.governorate || '').trim()) {
    violations.push(violation('GOVERNORATE_REQUIRED'));
  }
  if (ctx.to === 'won' && ctx.dealBlocker) {
    violations.push(
      violation('DEAL_SYNC_FAILED', `The Deal Engine deal for this lead is not in sync: ${ctx.dealBlocker} Fix it, press Retry on the Deal Engine card, then mark the lead Won.`)
    );
  } else if (ctx.to === 'won' && ctx.wonGateBlocker) {
    violations.push(violation('WON_GATE_NOT_READY', ctx.wonGateBlocker));
  }

  if (toIndex !== -1 && toIndex >= FOLLOW_UP_REQUIRED_FROM_INDEX && !ctx.followUpAt) {
    violations.push(violation('FOLLOW_UP_REQUIRED'));
  }

  if (ctx.role === 'technical' && !['site_survey', 'proposal_sent'].includes(ctx.to)) {
    violations.push(violation('TECHNICAL_RESTRICTED'));
  }
  if (STAGE_MOVE_BLOCKED_ROLES.includes(ctx.role)) {
    violations.push(violation('STAGE_MOVE_ROLE_RESTRICTED'));
  }

  return violations;
}

/**
 * Backward-compatible string form (every existing caller and test): an array of error messages,
 * empty when the transition is allowed.
 */
function validateStageTransition(ctx) {
  return evaluateStageTransition(ctx).map(v => v.message);
}

/**
 * Whether an MD override can make this transition valid: every violation must be overridable.
 * (A transition with no violations needs no override; one with any data-integrity violation can
 * never be overridden.)
 */
function canOverride(violations) {
  return violations.length > 0 && violations.every(v => v.overridable);
}

/**
 * Global Super Admin (Feature 5) only - every violation must be EITHER MD-overridable OR one of
 * the three testing-specific rules marked superAdminOverridable above. Still never includes a
 * data-integrity rule (WON_VALUE_REQUIRED, GOVERNORATE_REQUIRED, DEAL_SYNC_FAILED,
 * WON_GATE_NOT_READY, ...) - those have neither flag set, so they stay hard blocks here too.
 */
function canSuperAdminOverride(violations) {
  return violations.length > 0 && violations.every(v => v.overridable || v.superAdminOverridable);
}

module.exports = {
  evaluateStageTransition,
  validateStageTransition,
  canOverride,
  canSuperAdminOverride,
  STAGES,
  OPEN_STAGES,
  STAGE_LABELS,
  MD_APPROVAL_THRESHOLD_EGP,
  STAGE_MOVE_BLOCKED_ROLES,
  WON_BLOCKED_ROLES,
  RULES,
};
