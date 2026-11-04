'use strict';

const User = require('../../models/userModel');
const Counter = require('../../models/config/counterModel');
const sendEmail = require('../../utils/sendEmail');

// Reservia CRM - automatic owner assignment for website-originated leads (acceptance report
// finding 2: "Website leads arrive with no owner, so nobody is told to reply within 8 working
// hours"). Round-robins across the active Sales Engineers (CRM role 'sales', the existing role
// vocabulary - utils/systemsRegistry.js - not a new "Sales Engineer" designation) so leads are
// spread evenly rather than piling on one person; falls back to leaving the lead unowned (never
// throws) if there is nobody eligible to assign to, so a pool with zero active sales users still
// lets the lead through - "Handle assignment failures gracefully."
//
// Deliberately scoped to the automated website intake channels only (web_form, landing_page) -
// a STAFF member creating a lead by hand through the "New Lead" form already has a human in the
// loop who can choose (or deliberately leave blank) an owner; auto-assigning over their own
// explicit choice would be the wrong behaviour.
const AUTO_ASSIGN_CHANNELS = ['web_form', 'landing_page'];
const ROTATION_SEQUENCE = 'crmLeadAssignmentRotation';
const ROTATION_MAX = 999_999_999;

// counterModel.js's seq/min/max are all `required: true` - an upsert that only ever $inc's `seq`
// would fail schema validation creating the document the first time (min/max missing). Mirrors
// utils/crm/refCode.js#nextRefSequence's own "fast path first, seed only on the slow path"
// pattern instead, rather than reusing utils/accounting/journalEntryNumberService.js's $expr-range
// variant, which this counter has no use for (it only ever needs modulo, never a hard ceiling).
async function nextRotationSeq(session) {
  let updated = await Counter.findOneAndUpdate({ _id: ROTATION_SEQUENCE }, { $inc: { seq: 1 } }, { new: true, session });
  if (!updated) {
    try {
      await Counter.create([{ _id: ROTATION_SEQUENCE, seq: 1, min: 1, max: ROTATION_MAX }], { session });
      return 1;
    } catch (err) {
      if (err.code !== 11000) throw err; // lost the seed race to a concurrent first-ever caller - fine
      updated = await Counter.findOneAndUpdate({ _id: ROTATION_SEQUENCE }, { $inc: { seq: 1 } }, { new: true, session });
    }
  }
  return updated.seq;
}

/** Active users holding the CRM 'sales' role - the eligible assignment pool, ordered by _id for a stable rotation. */
async function eligibleSalesEngineers() {
  return User.find({
    isActive: true,
    isDeleted: { $ne: true },
    systemMemberships: { $elemMatch: { system: 'CRM', role: 'sales', isActive: true } },
  })
    .select('_id name email')
    .sort({ _id: 1 })
    .lean();
}

/**
 * Picks the next owner for an automated-channel lead in round-robin order, atomically (the
 * rotation counter is a single $inc, so two concurrent website submissions never land on the
 * exact same "next" index by racing a read-then-write). Returns null (never throws) when
 * assignment doesn't apply or nobody is eligible - the caller creates the lead unowned either way.
 */
async function pickAutoAssignee(channel, session) {
  if (!AUTO_ASSIGN_CHANNELS.includes(channel)) return null;
  try {
    const pool = await eligibleSalesEngineers();
    if (pool.length === 0) return null;

    const seq = await nextRotationSeq(session);
    const index = seq % pool.length;
    return pool[index];
  } catch {
    return null; // Assignment is a convenience, never a reason to fail lead creation.
  }
}

/**
 * Best-effort email to the newly-assigned owner - never throws, never blocks/delays the caller
 * longer than necessary (fire-and-forget), matching "Handle assignment failures gracefully": a
 * down/unconfigured SMTP server must never stop a lead from being created or owned.
 */
function notifyAssignment(owner, lead) {
  if (!owner?.email) return;
  const subject = `New lead assigned to you - ${lead.refCode}`;
  const html = `
    <p>Hi ${owner.name || ''},</p>
    <p>A new lead has been assigned to you in the Reservia CRM:</p>
    <ul>
      <li><strong>Reference:</strong> ${lead.refCode}</li>
      <li><strong>Name:</strong> ${lead.name || '(not provided)'}</li>
      <li><strong>Phone:</strong> ${lead.phoneE164}</li>
      <li><strong>Segment:</strong> ${lead.segment}</li>
    </ul>
    <p>The first-reply clock is already running - please respond within 8 working hours.</p>
  `;
  sendEmail(owner.email, subject, html).catch(() => {});
}

module.exports = { pickAutoAssignee, notifyAssignment, eligibleSalesEngineers, AUTO_ASSIGN_CHANNELS };
