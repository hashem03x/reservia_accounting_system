// Stage-transition rule engine (Reservia CRM Developer Brief, section 7 "Rules that must not
// change" + the supplied reference sample's `validate()`, which this ports line-for-line since the
// brief says the rules in the spec/reference must not change). Pure, DB-free - the caller
// (services/crm/stageService.js) resolves the lead's current state and the acting user's CRM role
// first, then this function is the single place every rule is checked, for both the real API and
// any future bulk/automation path, so the rules can never drift between callers.
//
// Returns an array of error message strings (empty = the transition is allowed).

const STAGES = ['new', 'contacted', 'qualified', 'site_survey', 'proposal_sent', 'negotiation', 'won', 'lost'];
// The six "working" stages a deal can be forward/backward-moved between before it is decided -
// 'won'/'lost' are terminal and follow their own separate rules below, never this list's
// adjacency check.
const OPEN_STAGES = ['new', 'contacted', 'qualified', 'site_survey', 'proposal_sent', 'negotiation'];
const MD_APPROVAL_THRESHOLD_EGP = 1_000_000;
// Follow-up becomes mandatory from 'qualified' onwards (index 2) - matches the brief's "Qualified
// and subsequent applicable stages require a follow-up date."
const FOLLOW_UP_REQUIRED_FROM_INDEX = 2;

/**
 * @param {object} ctx
 * @param {string} ctx.from - current stage
 * @param {string} ctx.to - requested stage
 * @param {string} ctx.role - the acting user's CRM role ('md'|'admin'|'sales'|'technical')
 * @param {number|null} ctx.valueEgp - the deal value that WOULD apply after this move
 * @param {string|null} ctx.lostReason
 * @param {string|Date|null} ctx.followUpAt - the follow-up date that WOULD apply after this move
 * @param {boolean} ctx.mdApproved - an explicit MD approval flag already on the lead or this request
 * @returns {string[]} error messages; empty means the transition is allowed
 */
function validateStageTransition(ctx) {
  const errors = [];
  if (ctx.from === ctx.to) return ['The lead is already in that stage.'];

  if (ctx.from === 'won') errors.push('A won deal cannot change stage. Open a new lead for new work.');
  if (ctx.from === 'lost' && ctx.to !== 'contacted') errors.push('A lost lead can only be reopened to Contacted.');
  if (ctx.from === 'lost' && !['admin', 'md'].includes(ctx.role)) errors.push('Only Admin or the MD can reopen a lost lead.');

  if (ctx.to === 'lost') {
    if (!ctx.lostReason) errors.push('Choose a lost reason.');
  } else if (ctx.to === 'won') {
    if (!['proposal_sent', 'negotiation'].includes(ctx.from)) errors.push('Only a lead with a proposal can be marked won.');
    if (!ctx.valueEgp || ctx.valueEgp <= 0) errors.push('Enter the contract value.');
    if ((ctx.valueEgp || 0) > MD_APPROVAL_THRESHOLD_EGP && !ctx.mdApproved && ctx.role !== 'md') {
      errors.push('Contracts above EGP 1M need MD approval.');
    }
  } else if (OPEN_STAGES.includes(ctx.from) && OPEN_STAGES.includes(ctx.to) && OPEN_STAGES.indexOf(ctx.to) < OPEN_STAGES.indexOf(ctx.from) - 1) {
    errors.push('A lead can only move back one stage at a time.');
  }

  if (OPEN_STAGES.includes(ctx.to) && OPEN_STAGES.indexOf(ctx.to) >= FOLLOW_UP_REQUIRED_FROM_INDEX && !ctx.followUpAt) {
    errors.push('Set a follow-up date.');
  }

  if (ctx.role === 'technical' && !['site_survey', 'proposal_sent'].includes(ctx.to)) {
    errors.push('Technical can move leads to Site survey or Proposal sent only.');
  }

  return errors;
}

module.exports = { validateStageTransition, STAGES, OPEN_STAGES, MD_APPROVAL_THRESHOLD_EGP };
