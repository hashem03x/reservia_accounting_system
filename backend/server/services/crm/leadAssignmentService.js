'use strict';

const User = require('../../models/userModel');
const Counter = require('../../models/config/counterModel');
const sendEmail = require('../../utils/sendEmail');

// Reservia CRM - automatic owner assignment for automated-intake leads (acceptance report finding
// 2 + Change Request 1, Feature 2: "Every new website AND WhatsApp lead must automatically
// receive an owner"). Deliberately scoped to the automated intake channels only (web_form,
// landing_page, whatsapp) - a STAFF member creating a lead by hand through the "New Lead" form
// already has a human in the loop who can choose (or deliberately leave blank) an owner;
// auto-assigning over their own explicit choice would be the wrong behaviour.
// Change Request 2: 'ad_lead_form' (Meta / TikTok / Google Ads lead forms, live or via the CSV
// stopgap) is an automated door too - nobody is in the loop to choose an owner.
const AUTO_ASSIGN_CHANNELS = ['web_form', 'landing_page', 'whatsapp', 'ad_lead_form'];
const ROTATION_SEQUENCE = 'crmLeadAssignmentRotation';
const ROTATION_MAX = 999_999_999;

// Assignment strategy (Change Request 1, Feature 2: "configurable using the existing CRM
// configuration approach") - this codebase has no generic runtime-config collection/UI, so this
// follows the SAME convention already used for every other CRM-tunable value (e.g.
// ATTACHMENT_MAX_MB, WHATSAPP_VERIFY_TOKEN): an environment variable, read once per call so a
// deployment config change takes effect without a code change.
//   CRM_ASSIGNMENT_STRATEGY = 'round_robin' (default) | 'single'
//   CRM_DEFAULT_SALES_ENGINEER_EMAIL - required when strategy is 'single'
function assignmentStrategy() {
  const value = (process.env.CRM_ASSIGNMENT_STRATEGY || 'round_robin').trim().toLowerCase();
  return value === 'single' ? 'single' : 'round_robin';
}

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
 * Picks the next owner for an automated-channel lead, atomically (the rotation counter is a
 * single $inc, so concurrent submissions never land on the exact same "next" index by racing a
 * read-then-write). Returns null (never throws) when assignment doesn't apply or nobody is
 * eligible - the caller creates the lead unowned either way ("handle assignment failures
 * gracefully").
 *
 * Strategy 'single': always the configured default Sales Engineer (by email), if they are
 * currently eligible - falls back to round-robin if that email isn't configured or isn't
 * currently an eligible sales user, rather than silently leaving every lead unowned.
 */
async function pickAutoAssignee(channel, session) {
  if (!AUTO_ASSIGN_CHANNELS.includes(channel)) return null;
  try {
    const pool = await eligibleSalesEngineers();
    if (pool.length === 0) return null;

    if (assignmentStrategy() === 'single') {
      const defaultEmail = (process.env.CRM_DEFAULT_SALES_ENGINEER_EMAIL || '').trim().toLowerCase();
      const defaultEngineer = defaultEmail ? pool.find(u => (u.email || '').toLowerCase() === defaultEmail) : null;
      if (defaultEngineer) return defaultEngineer;
      // Configured engineer isn't eligible right now (inactive, removed from CRM, or unset) -
      // round-robin rather than leave the lead unowned.
    }

    const seq = await nextRotationSeq(session);
    const index = seq % pool.length;
    return pool[index];
  } catch {
    return null; // Assignment is a convenience, never a reason to fail lead creation.
  }
}

// Campaign names arrive from external ad platforms - never interpolate them into HTML unescaped.
const escapeHtml = value =>
  String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || 'https://reserviafrontend.vercel.app').replace(/\/$/, '');
}

/**
 * Best-effort email to the newly-assigned owner - never throws, never blocks/delays the caller
 * longer than necessary (fire-and-forget), matching "Handle assignment failures gracefully": a
 * down/unconfigured SMTP server must never stop a lead from being created or owned. Content
 * matches Change Request 1, Feature 2 exactly: name, phone, source, creation time, a link to open
 * the lead.
 */
function notifyAssignment(owner, lead) {
  if (!owner?.email) return;
  const leadUrl = `${frontendBaseUrl()}/crm/leads/${lead._id}`;
  const createdAt = new Date(lead.createdAt || Date.now()).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });
  const subject = `New lead assigned to you - ${lead.refCode}`;
  const html = `
    <p>Hi ${escapeHtml(owner.name || '')},</p>
    <p>A new lead has been assigned to you in the Reservia CRM:</p>
    <ul>
      <li><strong>Reference:</strong> ${lead.refCode}</li>
      <li><strong>Name:</strong> ${escapeHtml(lead.name || '(not provided)')}</li>
      <li><strong>Phone:</strong> ${lead.phoneE164}</li>
      <li><strong>Source:</strong> ${lead.source || 'Other'}</li>
      ${lead.campaign ? `<li><strong>Campaign:</strong> ${escapeHtml(lead.campaign)}</li>` : ''}
      <li><strong>Created:</strong> ${createdAt} (Cairo time)</li>
    </ul>
    <p><a href="${leadUrl}">Open this lead in the CRM</a></p>
    <p>The first-reply clock is already running - please respond within 8 working hours.</p>
  `;
  sendEmail(owner.email, subject, html).catch(() => {});
}

/** Active CRM managers (MD / Admin) - who must hear about a lead nobody could be assigned to. */
async function crmManagers() {
  return User.find({
    isActive: true,
    isDeleted: { $ne: true },
    systemMemberships: { $elemMatch: { system: 'CRM', role: { $in: ['md', 'admin'] }, isActive: true } },
  })
    .select('_id name email')
    .lean();
}

/**
 * QA finding (Integrations): "no active user holds the CRM sales role, so leads ... will arrive
 * unassigned and nobody is notified". When an automated-channel lead could not be auto-assigned
 * (empty Sales pool), every CRM manager is emailed so the lead never sits unseen. Best-effort,
 * fire-and-forget, never blocks lead creation. Returns the managers notified (for the timeline).
 */
async function notifyUnassigned(lead) {
  let managers = [];
  try {
    managers = await crmManagers();
  } catch {
    return [];
  }
  const leadUrl = `${frontendBaseUrl()}/crm/leads/${lead._id}`;
  const subject = `UNASSIGNED new lead - ${lead.refCode} (no CRM Sales user available)`;
  for (const m of managers) {
    if (!m.email) continue;
    const html = `
      <p>Hi ${escapeHtml(m.name || '')},</p>
      <p>A new lead arrived but could <strong>not be assigned automatically</strong>: no active user currently holds the CRM <em>Sales</em> role.</p>
      <ul>
        <li><strong>Reference:</strong> ${lead.refCode}</li>
        <li><strong>Name:</strong> ${escapeHtml(lead.name || '(not provided)')}</li>
        <li><strong>Phone:</strong> ${lead.phoneE164}</li>
        <li><strong>Source:</strong> ${escapeHtml(lead.source || 'Other')}</li>
        ${lead.campaign ? `<li><strong>Campaign:</strong> ${escapeHtml(lead.campaign)}</li>` : ''}
      </ul>
      <p><a href="${leadUrl}">Open the lead and assign an owner</a>. To stop this, grant the CRM Sales role to the sales team in the Central Portal (Admin &rarr; Users &rarr; system access).</p>
    `;
    sendEmail(m.email, subject, html).catch(() => {});
  }
  return managers;
}

/** Reassignment notification (Change Request 1, Feature 2: "Notify the new owner" on manual reassignment). */
function notifyReassignment(owner, lead) {
  if (!owner?.email) return;
  const leadUrl = `${frontendBaseUrl()}/crm/leads/${lead._id}`;
  const subject = `A lead was reassigned to you - ${lead.refCode}`;
  const html = `
    <p>Hi ${escapeHtml(owner.name || '')},</p>
    <p>The lead <strong>${lead.refCode}</strong> (${escapeHtml(lead.name || '(not provided)')}, ${lead.phoneE164}) was reassigned to you.</p>
    <p><a href="${leadUrl}">Open this lead in the CRM</a></p>
  `;
  sendEmail(owner.email, subject, html).catch(() => {});
}

module.exports = { pickAutoAssignee, notifyAssignment, notifyReassignment, notifyUnassigned, crmManagers, eligibleSalesEngineers, AUTO_ASSIGN_CHANNELS, assignmentStrategy };
