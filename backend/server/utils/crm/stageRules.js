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
const MD_APPROVAL_THRESHOLD_EGP = 1_000_000;
// Follow-up becomes mandatory from 'qualified' onwards (index 2) - matches the brief's "Qualified
// and subsequent applicable stages require a follow-up date."
const FOLLOW_UP_REQUIRED_FROM_INDEX = 2;

const RULES = {
  SAME_STAGE: { message: 'The lead is already in that stage.', overridable: false },
  WON_IS_FINAL: { message: 'A won deal cannot change stage. Open a new lead for new work.', overridable: false },
  LOST_REOPEN_TARGET: { message: 'A lost lead can only be reopened to Contacted.', overridable: true },
  LOST_REOPEN_ROLE: { message: 'Only Admin or the MD can reopen a lost lead.', overridable: false },
  LOST_REASON_REQUIRED: { message: 'Choose a lost reason.', overridable: false },
  WON_REQUIRES_PROPOSAL: { message: 'Only a lead with a proposal can be marked won.', overridable: true },
  WON_VALUE_REQUIRED: { message: 'Enter the contract value.', overridable: false },
  MD_APPROVAL_REQUIRED: { message: 'Contracts above EGP 1M need MD approval.', overridable: false },
  STAGE_SKIP: { message: null, overridable: true }, // message built per transition, see below
  BACK_MORE_THAN_ONE: { message: 'A lead can only move back one stage at a time.', overridable: true },
  FOLLOW_UP_REQUIRED: { message: 'Set a follow-up date.', overridable: false },
  TECHNICAL_RESTRICTED: { message: 'Technical can move leads to Site survey or Proposal sent only.', overridable: false },
  // CRM Changes Required (12 Nov 2026), item 1: the Deal Engine handoff needs the governorate (it
  // decides the Rates region), so it is asked for at Qualified at the latest - never discovered as a
  // failed sync at Proposal sent. Data integrity: not overridable.
  GOVERNORATE_REQUIRED: { message: 'Set the governorate before moving the lead to Qualified or beyond (the Deal Engine needs it for the Rates region).', overridable: false },
  // Same item: "Block Won ... when the Commercial sync has failed. Keep the Retry button." A Won lead
  // must never be left without its Deal Engine deal. Message built per lead (the sync's own error).
  DEAL_SYNC_FAILED: { message: null, overridable: false },
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
  return { code, message: message || RULES[code].message, overridable: RULES[code].overridable };
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
  }

  if (toIndex !== -1 && toIndex >= FOLLOW_UP_REQUIRED_FROM_INDEX && !ctx.followUpAt) {
    violations.push(violation('FOLLOW_UP_REQUIRED'));
  }

  if (ctx.role === 'technical' && !['site_survey', 'proposal_sent'].includes(ctx.to)) {
    violations.push(violation('TECHNICAL_RESTRICTED'));
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

module.exports = {
  evaluateStageTransition,
  validateStageTransition,
  canOverride,
  STAGES,
  OPEN_STAGES,
  STAGE_LABELS,
  MD_APPROVAL_THRESHOLD_EGP,
  RULES,
};
