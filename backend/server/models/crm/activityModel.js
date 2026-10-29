const { Schema, model } = require('mongoose');
const { ACTIVITY_TYPES } = require('../../utils/crm/constants');

// Reservia CRM - one entry in a lead's activity timeline (Developer Brief section 4D). Covers both
// human-logged entries (note/call/email/survey/proposal) and the automated channel log
// (whatsapp_in/whatsapp_out/system) - the SAME timeline the brief requires ("a single
// chronological activity timeline per lead"), never two separate logs.
//
// `whatsapp_out` and `call`/`email` are what can satisfy the "first human reply" SLA
// (services/crm/leadService.js#recordActivity); `whatsapp_in` and `system` never do - an inbound
// customer message or an automated acknowledgement is not a rep's reply.
const activitySchema = new Schema(
  {
    lead: { type: Schema.Types.ObjectId, ref: 'CrmLead', required: true },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    // Free text - a note's body, a call summary, the WhatsApp message text. Never sent to
    // Amplitude (utils/crm/../services/crm/amplitudeService.js strips it entirely).
    body: { type: String, trim: true, maxlength: 5000, default: '' },
    // Set only for whatsapp_in/whatsapp_out - the WhatsApp message id, used for idempotent webhook
    // processing (services/crm/whatsappService.js never creates a second Activity for the same id).
    // No `default` on purpose: a sparse unique index only excludes documents where the field is
    // genuinely ABSENT, not ones explicitly set to `null` - a `default: null` would make every
    // non-WhatsApp activity collide on the same stored null (see userModel.js's own
    // partialFilterExpression comment for this exact gotcha with a different field).
    whatsappMessageId: { type: String },
    author: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

activitySchema.index({ lead: 1, createdAt: 1 });
// Idempotency guard for inbound WhatsApp webhook retries (Meta redelivers on a slow 200).
activitySchema.index({ whatsappMessageId: 1 }, { unique: true, sparse: true });

activitySchema.pre(/^find/, function (next) {
  this.populate({ path: 'author', select: 'name' });
  next();
});

module.exports = model('CrmActivity', activitySchema);
