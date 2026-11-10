'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const Lead = require('../../models/crm/leadModel');
const Activity = require('../../models/crm/activityModel');
const StageHistory = require('../../models/crm/stageHistoryModel');
const User = require('../../models/userModel');
const { normalizeEgyptianPhone } = require('../../utils/crm/phone');
const { addWorkingHours } = require('../../utils/crm/workingHours');
const { generateRefCode } = require('../../utils/crm/refCode');
const { evaluateStageTransition, canOverride, STAGES, STAGE_LABELS } = require('../../utils/crm/stageRules');
const { trackEvent } = require('./amplitudeService');
const { pickAutoAssignee, notifyAssignment, notifyReassignment, assignmentStrategy } = require('./leadAssignmentService');
const { offerFirstReply, replyViaForActivityType, SLA_WORKING_HOURS } = require('./firstReplyService');

// Reservia CRM - lead intake, dedup/merge, activity logging and stage transitions (Developer Brief
// section 4B/4D + section 7 "Rules that must not change"). This is the one place a Lead document
// is created or re-fetched from a phone number, so every intake path (manual "New lead" form, the
// website's lead-capture call, the WhatsApp webhook, CSV import, and the Change Request 2 unified
// integration intake - services/crm/leadIntakeService.js) goes through the SAME dedupe logic and
// can never diverge into two different "is this a duplicate" implementations.

const OVERRIDE_REASON_MAX = 500;

/** A random, non-personal id for Amplitude correlation - never derived from phone/name/email. */
const newAmpDeviceId = () => crypto.randomUUID();

// A website-supplied Amplitude device id is just a correlation token, never trusted as an
// identity/auth value - but it IS stored and later replayed back to Amplitude as `device_id`
// (amplitudeService.js), so it is shape-checked rather than accepted as arbitrary attacker input:
// plain alphanumeric/hyphen/underscore/dot, a sane length. Anything else (empty, too long, or
// containing characters that have no business in a device id) falls back to a fresh random one -
// the correlation is simply lost for that one lead, never an error the visitor sees.
const AMP_DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{8,100}$/;
function resolveAmpDeviceId(candidate) {
  return typeof candidate === 'string' && AMP_DEVICE_ID_PATTERN.test(candidate) ? candidate : newAmpDeviceId();
}

function shapeLead(lead) {
  if (!lead) return null;
  const obj = typeof lead.toObject === 'function' ? lead.toObject() : lead;
  return obj;
}

const cairoTimeLabel = date =>
  new Date(date).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });

/**
 * The original-submission instant for a new lead. A supplied time (ad form / CSV / webhook) is
 * honoured when it is in the past; a future time (clock skew, a typo) is clamped to now rather
 * than letting the SLA deadline land in the future.
 */
function resolveSubmittedAt(value, now) {
  if (!value) return now;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return now;
  return date.getTime() > now.getTime() ? now : date;
}

/** One human-readable line describing where a (repeat) enquiry came from - for the timeline. */
function describeOrigin(input) {
  const parts = [`via ${input.channel}`];
  if (input.source) parts.push(`source ${input.source}`);
  const campaign = input.campaign || input.utmCampaign;
  if (campaign) parts.push(`campaign "${campaign}"`);
  if (input.adSetName) parts.push(`ad set "${input.adSetName}"`);
  if (input.adName) parts.push(`ad "${input.adName}"`);
  return parts.join(', ');
}

/**
 * Finds the lead for a phone number, or creates one - the single dedup/merge gate the brief
 * requires ("one lead per phone number... repeated enquiries merge, they never duplicate").
 *
 * Concurrency: two requests for the same brand-new number race to `Lead.create` - the unique index
 * on `phoneE164` lets only one of them actually insert; the loser catches the duplicate-key error
 * and re-fetches, which now sees the winner's document. Nobody ever observes two Lead rows for the
 * same number, and nobody has to hold a lock to get there.
 *
 * A repeat enquiry on an EXISTING lead never resets its stage, owner, first-touch attribution or
 * SLA clock - it appends a 'system' activity recording the repeat contact and its attribution
 * (so the rep sees it and the history stays complete), and only fills fields that are still EMPTY
 * on the existing lead (name, email) - never overwriting anything already there.
 *
 * Options:
 *   - userId: the acting staff user (null for automated channels)
 *   - autoAssign: use the CRM assignment rules even though a user is acting (CSV import of
 *     integration leads - the importer is not the lead's owner)
 *   - skipRepeatNote: the caller records its own timeline entry for a repeat contact (WhatsApp's
 *     inbound message IS that entry), so no extra "Repeat enquiry" note is added
 *
 * Input (beyond the original fields): submittedAt (original enquiry time), email, campaign,
 * utmTerm, adSetName, adName, adFormId, adPlatform, externalLeadId.
 */
async function intakeLead(input, { userId = null, autoAssign = false, skipRepeatNote = false } = {}) {
  const phoneE164 = normalizeEgyptianPhone(input.phone);
  if (!phoneE164) throw new ApiError('Enter a valid Egyptian phone number.', 400);
  if (!input.channel) throw new ApiError('Choose how this lead reached us (the channel).', 400);

  const existing = await Lead.findOne({ phoneE164 });
  if (existing) {
    await mergeRepeatEnquiry(existing, input, { userId, skipRepeatNote });
    return { lead: shapeLead(existing), created: false };
  }

  const now = new Date();
  const submittedAt = resolveSubmittedAt(input.submittedAt, now);
  const session = await mongoose.startSession();
  try {
    let created;
    let autoAssignee = null;
    await session.withTransaction(async () => {
      const refCode = await generateRefCode(now, session);
      // Acceptance report finding 2 + Change Request 1, Feature 2: a lead with no human owner in
      // the loop at creation gets an owner automatically (round-robin across active CRM 'sales'
      // users) instead of sitting unowned - see leadAssignmentService.js's own header comment for
      // exactly why this is scoped to the automated intake channels only.
      let owner = input.owner || (autoAssign ? null : userId) || null;
      autoAssignee = null;
      if (!owner) {
        autoAssignee = await pickAutoAssignee(input.channel, session);
        if (autoAssignee) owner = autoAssignee._id;
      }
      const docs = await Lead.create(
        [
          {
            refCode,
            name: input.name || null,
            phoneE164,
            email: input.email || null,
            segment: input.segment || 'unknown',
            governorate: input.governorate || null,
            // Change Request 1: a WhatsApp lead with no explicit source (the normal case - the
            // validator never requires one for this channel, see leadValidators.js) falls back to
            // "WhatsApp Direct", never "Other" - every other channel's own validator already
            // requires an explicit source, so this 'Other' only protects an unexpected caller.
            source: input.source || (input.channel === 'whatsapp' ? 'WhatsApp Direct' : 'Other'),
            channel: input.channel,
            partnerName: input.partnerName || null,
            monthlyBillEgp: input.monthlyBillEgp ?? null,
            systemSizeKwp: input.systemSizeKwp ?? null,
            valueEgp: input.valueEgp ?? null,
            owner,
            utmSource: input.utmSource || null,
            utmMedium: input.utmMedium || null,
            utmCampaign: input.utmCampaign || null,
            utmContent: input.utmContent || null,
            utmTerm: input.utmTerm || null,
            campaign: input.campaign || input.utmCampaign || null,
            adSetName: input.adSetName || null,
            adName: input.adName || null,
            adFormId: input.adFormId || null,
            adPlatform: input.adPlatform || null,
            externalLeadId: input.externalLeadId || null,
            landingPage: input.landingPage || null,
            referrer: input.referrer || null,
            submittedAt,
            // Change Request 2, item 12: the 8-working-hour clock starts at the ORIGINAL
            // submission time - a lead submitted Monday 10:00 and imported Tuesday 09:00 is due
            // Monday 18:00, not Tuesday afternoon.
            replyDueAt: addWorkingHours(submittedAt, SLA_WORKING_HOURS),
            ampDeviceId: resolveAmpDeviceId(input.ampDeviceId),
            createdBy: userId,
          },
        ],
        { session }
      );
      created = docs[0];
      const backdated = now.getTime() - submittedAt.getTime() > 60 * 1000;
      const createdNote = `Lead created ${describeOrigin(input)}.${backdated ? ` Originally submitted ${cairoTimeLabel(submittedAt)} (Cairo time).` : ''}`;
      await Activity.create([{ lead: created._id, type: 'system', body: createdNote, author: userId }], { session });
      if (autoAssignee) {
        const strategyLabel = assignmentStrategy() === 'single' ? 'default Sales Engineer' : 'round-robin';
        await Activity.create(
          [{ lead: created._id, type: 'system', body: `Automatically assigned to ${autoAssignee.name} (${strategyLabel}).` }],
          { session }
        );
      }
      await StageHistory.create([{ lead: created._id, from: null, to: 'new', changedBy: userId }], { session });
    });
    trackEvent('crm_lead_created', { ampDeviceId: created.ampDeviceId, channel: created.channel, segment: created.segment });
    if (autoAssignee) notifyAssignment(autoAssignee, created); // fire-and-forget, after the commit
    return { lead: shapeLead(created), created: true };
  } catch (err) {
    if (err?.code === 11000 && (!err.keyPattern || err.keyPattern.phoneE164)) {
      // Lost the create race - the winner's document now exists; this is a merge, not an error.
      const winner = await Lead.findOne({ phoneE164 });
      if (winner) {
        await mergeRepeatEnquiry(winner, input, { userId, skipRepeatNote });
        return { lead: shapeLead(winner), created: false };
      }
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/** Records a repeat enquiry on an existing lead and fills only its still-empty contact fields. */
async function mergeRepeatEnquiry(lead, input, { userId, skipRepeatNote }) {
  const fill = {};
  if (!lead.name && input.name) fill.name = input.name;
  if (!lead.email && input.email) fill.email = String(input.email).toLowerCase();
  if (Object.keys(fill).length) {
    await Lead.updateOne({ _id: lead._id }, { $set: fill });
    Object.assign(lead, fill);
  }
  if (skipRepeatNote) return;
  const submittedNote = input.submittedAt ? ` Submitted ${cairoTimeLabel(input.submittedAt)} (Cairo time).` : '';
  await Activity.create({
    lead: lead._id,
    type: 'system',
    body: `Repeat enquiry ${describeOrigin(input)}.${submittedNote}`,
    author: userId,
  });
}

/**
 * Appends one activity-timeline entry. A call, email or outbound WhatsApp message is offered as
 * the lead's first reply (services/crm/firstReplyService.js - only lands if it is the EARLIEST
 * qualifying event); `whatsapp_in` (the customer's own message), notes and `system` entries never
 * are, matching the brief's "an automated WhatsApp acknowledgement does not count as the first
 * human reply".
 */
async function recordActivity(leadId, input, { userId = null } = {}) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw new ApiError('Lead not found.', 404);

  if (input.whatsappMessageId) {
    const seen = await Activity.findOne({ whatsappMessageId: input.whatsappMessageId }).lean();
    if (seen) return seen; // Meta redelivery - already processed, not an error.
  }

  let activity;
  try {
    activity = await Activity.create({
      lead: lead._id,
      type: input.type,
      body: input.body || '',
      whatsappMessageId: input.whatsappMessageId || undefined,
      author: userId,
    });
  } catch (err) {
    if (err?.code === 11000 && input.whatsappMessageId) {
      return Activity.findOne({ whatsappMessageId: input.whatsappMessageId }).lean();
    }
    throw err;
  }

  const via = replyViaForActivityType(input.type);
  if (via) await offerFirstReply(lead._id, activity.createdAt, via);

  return activity;
}

/**
 * Applies a pipeline-stage change, after running it through
 * utils/crm/stageRules.js#evaluateStageTransition - the ONE place every stage-transition rule in
 * the brief (strict one-stage-at-a-time progression, Won-only-from-Proposal/Negotiation, MD
 * approval above EGP 1M, one-stage-back-at-a-time, lost-reopen restricted to Admin/MD, technical's
 * restricted destinations, follow-up date required from Qualified onward) is enforced, so a direct
 * API call can never bypass a rule the Kanban UI happens to also enforce client-side.
 *
 * MD override (Change Request 2, item 1): when every broken rule is a path/order rule, an actor
 * whose SERVER-SIDE CRM role is 'md' may push the move through by giving `overrideReason`. The
 * override is written to the immutable stage history (previous stage, new stage, who, why, when,
 * which rules) and to the activity timeline. Anyone else sending `overrideReason` gets a 403 -
 * the reason field is not a way around the rules.
 */
async function changeStage(leadId, input, { userId = null, role } = {}) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw new ApiError('Lead not found.', 404);

  const overrideReason = typeof input.overrideReason === 'string' ? input.overrideReason.trim().slice(0, OVERRIDE_REASON_MAX) : '';
  if (overrideReason && role !== 'md') {
    throw new ApiError('Only the MD can override pipeline stage rules.', 403);
  }

  const ctx = {
    from: lead.stage,
    to: input.to,
    role,
    lostReason: input.lostReason ?? lead.lostReason,
    valueEgp: input.valueEgp ?? lead.valueEgp,
    // SECURITY: never trust a client-supplied `mdApproved` - a request body is not proof the MD
    // actually approved anything. Approval can only come from the ACTING role genuinely being
    // 'md' (checked server-side via req.crmRole, loaded from the database - never the client) or
    // from the lead's own already-persisted flag (which itself could only have been set true by
    // this same, now-trustworthy path). `input.mdApproved` is deliberately never read here.
    mdApproved: lead.mdApproved || role === 'md',
    followUpAt: input.followUpAt ?? lead.followUpAt,
  };
  const violations = evaluateStageTransition(ctx);
  let overridden = [];
  if (violations.length) {
    const overridable = canOverride(violations) && role === 'md';
    if (!overridable || !overrideReason) {
      const message = violations.map(v => v.message).join(' ');
      if (overridable) {
        throw new ApiError(`${message} As MD you can override this - give a reason for the override.`, 400, {
          overridable: true,
          rules: violations.map(v => v.code),
        });
      }
      throw new ApiError(message, 400);
    }
    overridden = violations;
  }
  const isOverride = overridden.length > 0;

  const from = lead.stage;
  const changedAt = new Date();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      lead.stage = input.to;
      lead.stageChangedAt = changedAt;
      if (input.to === 'lost') lead.lostReason = ctx.lostReason;
      if (input.to === 'won') {
        lead.valueEgp = ctx.valueEgp;
        lead.mdApproved = ctx.mdApproved;
      }
      if (input.valueEgp !== undefined) lead.valueEgp = input.valueEgp;
      if (input.followUpAt !== undefined) lead.followUpAt = input.followUpAt;
      await lead.save({ session });

      await StageHistory.create(
        [
          {
            lead: lead._id,
            from,
            to: input.to,
            changedBy: userId,
            lostReason: input.to === 'lost' ? ctx.lostReason : null,
            valueEgpAtChange: input.to === 'won' ? ctx.valueEgp : null,
            mdApproved: input.to === 'won' ? ctx.mdApproved : false,
            override: isOverride,
            overrideReason: isOverride ? overrideReason : null,
            overriddenRules: isOverride ? overridden.map(v => v.code) : [],
          },
        ],
        { session }
      );
      const body = isOverride
        ? `Stage changed from ${from} to ${input.to} - MD OVERRIDE of: ${overridden.map(v => v.message).join(' ')} Reason: ${overrideReason}`
        : `Stage changed from ${from} to ${input.to}.`;
      await Activity.create([{ lead: lead._id, type: 'system', body, author: userId }], { session });

      // Change Request 2, item 3: the first move out of New is a qualifying first reply.
      if (from === 'new') await offerFirstReply(lead._id, changedAt, 'stage_change', { session });
    });
  } finally {
    await session.endSession();
  }

  trackEvent(input.to === 'won' ? 'crm_deal_won' : input.to === 'lost' ? 'crm_deal_lost' : 'crm_stage_changed', {
    ampDeviceId: lead.ampDeviceId,
    from: ctx.from,
    to: input.to,
  });
  if (isOverride) {
    // Operational log line (no PII) in addition to the immutable stage-history record.
    console.info(`[CRM] MD stage override on lead ${lead.refCode}: ${STAGE_LABELS[from]} -> ${STAGE_LABELS[input.to]} by user ${userId} (${overridden.map(v => v.code).join(',')})`);
  }

  return shapeLead(await Lead.findById(lead._id));
}

/** Reassigns a lead's owner - the brief's "admin officer reassigns leads" (role-gated by the caller). */
async function reassignLead(leadId, ownerId, { userId = null } = {}) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw new ApiError('Lead not found.', 404);
  // The lead's own pre-save populate hook resolves `owner` to {_id, name} - read the PREVIOUS
  // owner's name before overwriting it, so the audit trail (Change Request 1, Feature 2:
  // "Preserve the previous owner in the assignment history") actually names both sides of the
  // change, not just "reassigned" with no record of who it moved from/to.
  const previousOwnerName = lead.owner?.name || null;
  const newOwner = ownerId ? await User.findById(ownerId).select('_id name email').lean() : null;

  lead.owner = ownerId || null;
  await lead.save();
  const body = newOwner
    ? `Lead reassigned${previousOwnerName ? ` from ${previousOwnerName}` : ''} to ${newOwner.name}.`
    : `Lead unassigned${previousOwnerName ? ` (was ${previousOwnerName})` : ''}.`;
  await Activity.create({ lead: lead._id, type: 'system', body, author: userId });

  if (newOwner) notifyReassignment(newOwner, lead); // fire-and-forget, same as the auto-assignment notification
  return shapeLead(lead);
}

/**
 * Archive/restore (acceptance report finding 7 + Change Request 1, Feature 6) - a reason is
 * required to archive (never to restore) and is recorded both on the lead itself and in its
 * activity timeline, so the audit trail answers "who archived this, when, and why" without needing
 * a separate collection. The caller (controller/crm/leadController.js, behind
 * requireCrmRole('md')) is the only HTTP path to this; it does not re-check the role so a one-off
 * maintenance script with an explicit, already-authorized MD user id can use it too. The document,
 * its activities and its stage history are never deleted - fully reversible.
 */
async function setLeadArchived(leadId, archived, { userId = null, reason = null } = {}) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw new ApiError('Lead not found.', 404);
  if (archived && !String(reason || '').trim()) throw new ApiError('A reason is required to archive a lead.', 400);
  lead.archived = !!archived;
  lead.archivedAt = archived ? new Date() : null;
  lead.archivedBy = archived ? userId : null;
  lead.archiveReason = archived ? String(reason).trim() : null;
  await lead.save();
  const body = archived ? `Lead archived. Reason: ${lead.archiveReason}` : 'Lead restored from archive.';
  await Activity.create({ lead: lead._id, type: 'system', body, author: userId });
  return shapeLead(lead);
}

module.exports = { intakeLead, recordActivity, changeStage, reassignLead, setLeadArchived, STAGES };
