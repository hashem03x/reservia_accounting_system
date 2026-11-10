const { Schema, model } = require('mongoose');
const { STAGES, SEGMENTS, CHANNELS, LOST_REASONS, FIRST_REPLY_VIA } = require('../../utils/crm/constants');
const { toDateOnly } = require('../../utils/crm/businessDate');

// Change Request 2, item 2: a follow-up is a CALENDAR DATE, stored as 'YYYY-MM-DD'. Legacy
// documents still hold a BSON Date (written as `new Date('2026-11-12')`, i.e. UTC midnight); this
// caster converts those to the Cairo calendar day on read, so they display correctly even before
// scripts/migrateCrmFollowUpDates.js rewrites them. Invalid input throws -> a normal CastError.
function castFollowUpDate(value) {
  const dateOnly = toDateOnly(value);
  if (dateOnly === undefined) throw new Error('Follow-up date must be a calendar date (YYYY-MM-DD).');
  return dateOnly;
}

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
    // Optional contact email (Change Request 2: CSV import and ad lead forms deliver one).
    email: { type: String, trim: true, lowercase: true, maxlength: 200, default: null },
    // Calendar date 'YYYY-MM-DD' (Change Request 2, item 2) - see castFollowUpDate above. The
    // field name is unchanged for API backward compatibility.
    followUpAt: { type: String, cast: castFollowUpDate, default: null },
    // First-touch website attribution (brief: "Website campaign and landing-page attribution") -
    // captured once at creation from the lead-capture payload, never overwritten by a later
    // channel (e.g. a later WhatsApp message on the same phone keeps the website's own first-touch
    // campaign, matching the reference sample's `intake()`, which only sets these on a brand-new
    // lead).
    utmSource: { type: String, trim: true, maxlength: 150, default: null },
    utmMedium: { type: String, trim: true, maxlength: 150, default: null },
    utmCampaign: { type: String, trim: true, maxlength: 150, default: null },
    // Change Request 1, Feature 1: utm_content was captured by the website's own 30-day
    // first-touch storage already (hooks/useUtmParams.ts) but was never persisted onto the lead.
    utmContent: { type: String, trim: true, maxlength: 150, default: null },
    // Change Request 2, item 7: utm_term was never captured.
    utmTerm: { type: String, trim: true, maxlength: 150, default: null },
    // Human-readable campaign name, whatever channel delivered it (website utm_campaign, Meta
    // campaign_name, a CSV "Campaign" column, Google Ads campaign id). The raw utm* fields above are
    // kept verbatim alongside it; this is the one field the UI and reports show as "Campaign".
    campaign: { type: String, trim: true, maxlength: 200, default: null },
    // Ad-platform lead-form attribution (Change Request 2, items 9-11) - all optional, set only by
    // the Meta/TikTok/Google Ads intake paths, first-touch like the utm* fields.
    adSetName: { type: String, trim: true, maxlength: 200, default: null },
    adName: { type: String, trim: true, maxlength: 200, default: null },
    adFormId: { type: String, trim: true, maxlength: 100, default: null },
    adPlatform: { type: String, trim: true, maxlength: 40, default: null },
    externalLeadId: { type: String, trim: true, maxlength: 150, default: null },
    landingPage: { type: String, trim: true, maxlength: 300, default: null },
    // The first-touch referrer (document.referrer at first arrival) - only meaningful when there
    // is no UTM at all, to distinguish Organic (arrived via a search engine) from Direct (typed
    // the URL, a bookmark, or a referrer the browser didn't disclose). Never itself shown as the
    // lead's source; only an input to sourceNormalization.js.
    referrer: { type: String, trim: true, maxlength: 300, default: null },

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
    // Change Request 2, item 3: which qualifying event set firstReplyAt (the first move out of New,
    // or the first logged call / WhatsApp / email) - see services/crm/firstReplyService.js.
    firstReplyVia: { type: String, enum: [...FIRST_REPLY_VIA, null], default: null },
    // Change Request 2, items 3 + 12: when the customer ORIGINALLY submitted the enquiry (ad lead
    // form timestamp, the CSV's original timestamp). The SLA clock (replyDueAt) and "hours to
    // first reply" are measured from this, never from the moment a CSV happened to be imported.
    // Equal to createdAt for leads entered live. Absent on legacy leads - read it through
    // services/crm/firstReplyService.js#leadOriginAt, which falls back to createdAt.
    submittedAt: { type: Date, default: null },

    // Amplitude correlation id (brief section 4H: "safe, pseudonymous identifiers... only") - a
    // random, non-personal device id. For a website-originated lead this IS the visitor's own
    // Amplitude Browser SDK device id (sent by the website - see
    // services/crm/leadService.js#intakeLead's `ampDeviceId` input), so the CRM's own
    // `crm_lead_created` event and the website's `page_view`/`quote_form_submitted` events
    // correlate as the same Amplitude user without any PII changing hands. For every other
    // channel (manual entry, WhatsApp, CSV import) there is no website visit to correlate with,
    // so one is generated fresh per lead instead.
    ampDeviceId: { type: String, required: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // Soft deletion only (acceptance report finding 7 + Change Request 1, Feature 6: "Prefer soft
    // deletion or archiving over permanent deletion... require a reason... record who/when...
    // audit trail") - services/crm/leadService.js#setLeadArchived is the one place this is ever
    // set, gated to the MD role alone (middleware/crmAccess.js#requireCrmRole('md')). An archived
    // lead is excluded from the pipeline/list views by default (controller/crm/leadController.js)
    // but the document, its activity timeline and its stage history are never deleted - restoring
    // it is just clearing these four fields again.
    archived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    archiveReason: { type: String, trim: true, maxlength: 300, default: null },
  },
  { timestamps: true }
);

leadSchema.index({ stage: 1 });
leadSchema.index({ owner: 1 });
leadSchema.index({ segment: 1 });
leadSchema.index({ archived: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ submittedAt: -1 });
// Supports the dashboard's "search by name, phone or Reservia reference code" (brief section 4A).
leadSchema.index({ name: 'text', refCode: 'text' });

leadSchema.pre(/^find/, function (next) {
  this.populate({ path: 'owner', select: 'name email' })
    .populate({ path: 'createdBy', select: 'name' })
    .populate({ path: 'archivedBy', select: 'name' });
  next();
});

module.exports = model('CrmLead', leadSchema);
