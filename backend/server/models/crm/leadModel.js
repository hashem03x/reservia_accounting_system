const { Schema, model } = require('mongoose');
const { STAGES, SEGMENTS, CHANNELS, LOST_REASONS } = require('../../utils/crm/constants');

// Reservia CRM - a Lead (Developer Brief section 4B "Lead management" + section 7 "Rules that
// must not change"). One document per real customer enquiry, keyed by its normalized phone number
// - repeated enquiries from the same number MERGE into this same document (see
// services/crm/leadService.js#intakeLead), they never create a second Lead. This is the single
// mechanism the brief's "one lead per phone number... repeats merge, never duplicate" rule rests
// on - enforced here by a real unique index, not just application logic, so even a race between
// two concurrent webhook deliveries can't create a duplicate.
const leadSchema = new Schema(
  {
    // Carries ad/source attribution through the lead's whole lifecycle (brief: "Generate a stable,
    // unique Reservia reference code that carries the appropriate source/advertising attribution
    // through the lead lifecycle") - generated once at creation (utils/crm/refCode.js), never
    // changed.
    refCode: { type: String, required: true, unique: true, trim: true },
    // Optional - a WhatsApp-only enquiry may arrive with no name at all (see the reference
    // sample's lead L7).
    name: { type: String, trim: true, maxlength: 150, default: null },
    // The ONE identity a lead is deduplicated on (utils/crm/phone.js#normalizeEgyptianPhone) -
    // always the canonical '+20...' form, never the raw input a channel delivered.
    phoneE164: { type: String, required: true, unique: true, trim: true },
    segment: { type: String, enum: SEGMENTS, default: 'unknown' },
    governorate: { type: String, trim: true, maxlength: 100, default: null },
    // Display source label (e.g. "Google ads", "Website form", "WhatsApp", "Vendor or partner") -
    // free text because the brief's own list of channels/campaigns keeps growing; `channel` below
    // is the constrained, machine-checked acquisition path.
    source: { type: String, trim: true, maxlength: 100, default: 'Other' },
    channel: { type: String, enum: CHANNELS, required: true },
    // Set only when `channel === 'dealer'` (or a partner/dealer is otherwise involved) - the brief:
    // "Partner or dealer".
    partnerName: { type: String, trim: true, maxlength: 150, default: null },
    monthlyBillEgp: { type: Number, min: 0, default: null },
    systemSizeKwp: { type: Number, min: 0, default: null },
    // Expected/contract deal value - mandatory once a lead reaches Won (utils/crm/stageRules.js),
    // optional before that (an early-stage lead may have no value estimate yet).
    valueEgp: { type: Number, min: 0, default: null },
    owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    followUpAt: { type: Date, default: null },
    // First-touch website attribution (brief: "Website campaign and landing-page attribution") -
    // captured once at creation from the lead-capture payload, never overwritten by a later
    // channel (e.g. a later WhatsApp message on the same phone keeps the website's own first-touch
    // campaign, matching the reference sample's `intake()`, which only sets these on a brand-new
    // lead).
    utmCampaign: { type: String, trim: true, maxlength: 150, default: null },
    landingPage: { type: String, trim: true, maxlength: 300, default: null },

    stage: { type: String, enum: STAGES, default: 'new' },
    stageChangedAt: { type: Date, default: Date.now },
    lostReason: { type: String, enum: [...LOST_REASONS, null], default: null },
    // Set once, by whoever actually approved a >EGP 1M contract (the MD, or an MD-role actor at
    // the time of the Won transition) - see utils/crm/stageRules.js. Never reset by a later,
    // unrelated edit.
    mdApproved: { type: Boolean, default: false },

    // The SLA pair (brief section 7): `replyDueAt` is computed once at creation (or at reopen -
    // see services/crm/leadService.js) via utils/crm/workingHours.js#addWorkingHours; a lead is
    // "reply overdue" (derived, never stored) when `!firstReplyAt && replyDueAt < now`.
    // `firstReplyAt` is set the first time a HUMAN activity (call/email/whatsapp_out) is logged -
    // an automated WhatsApp acknowledgement never sets it (brief: "An automated WhatsApp
    // acknowledgement does not count as the first human reply").
    replyDueAt: { type: Date, required: true },
    firstReplyAt: { type: Date, default: null },

    // Amplitude correlation id (brief section 4H: "safe, pseudonymous identifiers... only") - a
    // random, non-personal device id generated once per lead, never derived from the phone/name.
    ampDeviceId: { type: String, required: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

leadSchema.index({ stage: 1 });
leadSchema.index({ owner: 1 });
leadSchema.index({ segment: 1 });
leadSchema.index({ createdAt: -1 });
// Supports the dashboard's "search by name, phone or Reservia reference code" (brief section 4A).
leadSchema.index({ name: 'text', refCode: 'text' });

leadSchema.pre(/^find/, function (next) {
  this.populate({ path: 'owner', select: 'name email' }).populate({ path: 'createdBy', select: 'name' });
  next();
});

module.exports = model('CrmLead', leadSchema);
