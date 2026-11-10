const { Schema, model } = require('mongoose');

// Reservia CRM - the idempotency ledger for external lead deliveries (Change Request 2, item 6:
// "External platforms may retry webhook deliveries... Repeated delivery of the same event must
// not create duplicate leads or activities."). One document per (channel, provider event/lead
// id): the unique index means a retried delivery can never be processed twice, even when two
// retries race each other.
//
// Deliberately stores NO payload and no contact data - only what is needed to dedupe, report
// status on the Integrations screen and debug a failure (a short, non-PII error message).
const INTAKE_STATUSES = ['processing', 'processed', 'failed', 'ignored'];

const intakeEventSchema = new Schema(
  {
    // 'website' | 'whatsapp' | 'meta' | 'tiktok' | 'google_ads' | 'csv'
    channel: { type: String, required: true, trim: true, maxlength: 30 },
    externalId: { type: String, required: true, trim: true, maxlength: 200 },
    status: { type: String, enum: INTAKE_STATUSES, default: 'processing' },
    lead: { type: Schema.Types.ObjectId, ref: 'CrmLead', default: null },
    leadCreated: { type: Boolean, default: false },
    // The follow-up step (timeline note) finished - lets a retry after a partial failure resume
    // exactly where it stopped instead of re-doing completed work.
    noteRecorded: { type: Boolean, default: false },
    attempts: { type: Number, default: 1 },
    lastError: { type: String, trim: true, maxlength: 300, default: null },
    // Why an event was deliberately not turned into a lead (e.g. a Google Ads test submission).
    ignoredReason: { type: String, trim: true, maxlength: 200, default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

intakeEventSchema.index({ channel: 1, externalId: 1 }, { unique: true });
intakeEventSchema.index({ channel: 1, createdAt: -1 });
intakeEventSchema.index({ status: 1, createdAt: -1 });

module.exports = model('CrmIntakeEvent', intakeEventSchema);
module.exports.INTAKE_STATUSES = INTAKE_STATUSES;
