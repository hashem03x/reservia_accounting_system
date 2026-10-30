'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const Lead = require('../../models/crm/leadModel');
const Activity = require('../../models/crm/activityModel');
const StageHistory = require('../../models/crm/stageHistoryModel');
const { normalizeEgyptianPhone } = require('../../utils/crm/phone');
const { addWorkingHours } = require('../../utils/crm/workingHours');
const { generateRefCode } = require('../../utils/crm/refCode');
const { validateStageTransition, STAGES } = require('../../utils/crm/stageRules');
const { trackEvent } = require('./amplitudeService');

// Reservia CRM - lead intake, dedup/merge, activity logging and stage transitions (Developer Brief
// section 4B/4D + section 7 "Rules that must not change"). This is the one place a Lead document
// is created or re-fetched from a phone number, so every intake path (manual "New lead" form, the
// website's lead-capture call, the WhatsApp webhook, CSV import) goes through the SAME dedupe
// logic and can never diverge into two different "is this a duplicate" implementations.

const FIRST_REPLY_ACTIVITY_TYPES = ['call', 'email', 'whatsapp_out'];
const SLA_WORKING_HOURS = 8;

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
 * SLA clock - it only appends a 'system' activity noting the repeat contact, so the rep sees it
 * without the lead silently jumping back to square one.
 */
async function intakeLead(input, { userId = null } = {}) {
  const phoneE164 = normalizeEgyptianPhone(input.phone);
  if (!phoneE164) throw new ApiError('Enter a valid Egyptian phone number.', 400);
  if (!input.channel) throw new ApiError('Choose how this lead reached us (the channel).', 400);

  const existing = await Lead.findOne({ phoneE164 });
  if (existing) {
    await Activity.create({
      lead: existing._id,
      type: 'system',
      body: `Repeat enquiry via ${input.channel}${input.source ? ` (${input.source})` : ''}.`,
      author: userId,
    });
    return { lead: shapeLead(existing), created: false };
  }

  const now = new Date();
  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      const refCode = await generateRefCode(now, session);
      const docs = await Lead.create(
        [
          {
            refCode,
            name: input.name || null,
            phoneE164,
            segment: input.segment || 'unknown',
            governorate: input.governorate || null,
            source: input.source || 'Other',
            channel: input.channel,
            partnerName: input.partnerName || null,
            monthlyBillEgp: input.monthlyBillEgp ?? null,
            systemSizeKwp: input.systemSizeKwp ?? null,
            valueEgp: input.valueEgp ?? null,
            owner: input.owner || userId || null,
            utmSource: input.utmSource || null,
            utmMedium: input.utmMedium || null,
            utmCampaign: input.utmCampaign || null,
            landingPage: input.landingPage || null,
            replyDueAt: addWorkingHours(now, SLA_WORKING_HOURS),
            ampDeviceId: resolveAmpDeviceId(input.ampDeviceId),
            createdBy: userId,
          },
        ],
        { session }
      );
      created = docs[0];
      await Activity.create([{ lead: created._id, type: 'system', body: `Lead created via ${input.channel}.`, author: userId }], { session });
      await StageHistory.create([{ lead: created._id, from: null, to: 'new', changedBy: userId }], { session });
    });
    trackEvent('crm_lead_created', { ampDeviceId: created.ampDeviceId, channel: created.channel, segment: created.segment });
    return { lead: shapeLead(created), created: true };
  } catch (err) {
    if (err?.code === 11000) {
      // Lost the create race - the winner's document now exists; this is a merge, not an error.
      const winner = await Lead.findOne({ phoneE164 });
      if (winner) {
        await Activity.create({ lead: winner._id, type: 'system', body: `Repeat enquiry via ${input.channel}.`, author: userId });
        return { lead: shapeLead(winner), created: false };
      }
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Appends one activity-timeline entry. The lead's `firstReplyAt` is set here, the moment a HUMAN
 * reply (a call, an email, or an outbound WhatsApp message) is logged for the first time - never
 * for `whatsapp_in` (the customer's own message) or `system` (an automated note), matching the
 * brief's "an automated WhatsApp acknowledgement does not count as the first human reply".
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

  if (!lead.firstReplyAt && FIRST_REPLY_ACTIVITY_TYPES.includes(input.type)) {
    lead.firstReplyAt = new Date();
    await lead.save();
  }

  return activity;
}

/**
 * Applies a pipeline-stage change, after running it through
 * utils/crm/stageRules.js#validateStageTransition - the ONE place every stage-transition rule in
 * the brief (Won-only-from-Proposal/Negotiation, MD approval above EGP 1M, one-stage-back-at-a-time,
 * lost-reopen restricted to Admin/MD, technical's restricted destinations, follow-up date required
 * from Site survey onward) is enforced, so a direct API call can never bypass a rule the Kanban UI
 * happens to also enforce client-side.
 */
async function changeStage(leadId, input, { userId = null, role } = {}) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw new ApiError('Lead not found.', 404);

  const ctx = {
    from: lead.stage,
    to: input.to,
    role,
    lostReason: input.lostReason ?? lead.lostReason,
    valueEgp: input.valueEgp ?? lead.valueEgp,
    mdApproved: input.mdApproved || lead.mdApproved || role === 'md',
    followUpAt: input.followUpAt ?? lead.followUpAt,
  };
  const errors = validateStageTransition(ctx);
  if (errors.length) throw new ApiError(errors.join(' '), 400);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const from = lead.stage;
      lead.stage = input.to;
      lead.stageChangedAt = new Date();
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
          },
        ],
        { session }
      );
      await Activity.create(
        [{ lead: lead._id, type: 'system', body: `Stage changed from ${from} to ${input.to}.`, author: userId }],
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  trackEvent(input.to === 'won' ? 'crm_deal_won' : input.to === 'lost' ? 'crm_deal_lost' : 'crm_stage_changed', {
    ampDeviceId: lead.ampDeviceId,
    from: ctx.from,
    to: input.to,
  });

  return shapeLead(lead);
}

/** Reassigns a lead's owner - the brief's "admin officer reassigns leads" (role-gated by the caller). */
async function reassignLead(leadId, ownerId, { userId = null } = {}) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw new ApiError('Lead not found.', 404);
  lead.owner = ownerId || null;
  await lead.save();
  await Activity.create({ lead: lead._id, type: 'system', body: 'Lead reassigned.', author: userId });
  return shapeLead(lead);
}

module.exports = { intakeLead, recordActivity, changeStage, reassignLead, STAGES };
