const { Schema, model } = require('mongoose');
const { SOURCES } = require('../../utils/crm/constants');

// Reservia CRM - WhatsApp Ref code -> source lookup (Change Request 1, Feature 1: "WhatsApp
// message with a recognized Ref code -> Source associated with that code"). Registered by the
// website (routes/crm/publicLeadRoute.js, POST /wa-ref) at the moment a wa.me link is built
// (services/waRefCode.ts on the website side generates the code itself; this collection is the
// ONLY place that code's attribution is recorded, since the code is never otherwise persisted).
// The inbound WhatsApp webhook (services/crm/whatsappService.js) parses the code back out of the
// customer's own first message and looks it up here.
//
// A fixed 30-day TTL (matching the website's own first-touch UTM window - hooks/useUtmParams.ts)
// via a Mongo TTL index - after 30 days an unanswered click's attribution is no longer considered
// "recent" and the code falls back to WhatsApp Direct, same as if it were never recognized.
const waRefCodeSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, maxlength: 40 },
    source: { type: String, enum: SOURCES, required: true },
    utmSource: { type: String, trim: true, maxlength: 150, default: null },
    utmMedium: { type: String, trim: true, maxlength: 150, default: null },
    utmCampaign: { type: String, trim: true, maxlength: 150, default: null },
    utmContent: { type: String, trim: true, maxlength: 150, default: null },
  },
  { timestamps: true }
);

waRefCodeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = model('CrmWaRefCode', waRefCodeSchema);
