const { Schema, model } = require('mongoose');

// Reservia CRM - per-channel integration configuration (CRM C6). One document per channel
// (whatsapp / meta / tiktok / google_ads). Secret fields are stored ENCRYPTED (utils/crm/secretBox.js)
// with a 4-character hint; plain (non-secret) fields such as a phone-number id are stored as-is.
// The status block records what has actually been VERIFIED (webhook handshake, a successful API
// test, the last error) - entering credentials alone never makes a channel "Connected".
const fieldSchema = new Schema(
  {
    secret: { type: Boolean, default: false },
    box: { type: String, default: null }, // encrypted value (secret fields)
    value: { type: String, default: null }, // plain value (non-secret fields)
    hint: { type: String, default: null },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

const integrationSettingSchema = new Schema(
  {
    channel: { type: String, required: true, unique: true, enum: ['whatsapp', 'meta', 'tiktok', 'google_ads'] },
    enabled: { type: Boolean, default: true },
    fields: { type: Map, of: fieldSchema, default: () => new Map() },
    status: {
      webhookVerifiedAt: { type: Date, default: null },
      lastTestAt: { type: Date, default: null },
      lastTestOk: { type: Boolean, default: null },
      lastTestMessage: { type: String, maxlength: 300, default: null },
      lastErrorAt: { type: Date, default: null },
      lastError: { type: String, maxlength: 300, default: null },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// Never serialize encrypted boxes, even to an authorized admin.
integrationSettingSchema.set('toJSON', {
  transform(doc, ret) {
    if (ret.fields) {
      const out = {};
      const entries = ret.fields instanceof Map ? [...ret.fields.entries()] : Object.entries(ret.fields);
      for (const [k, f] of entries) out[k] = { secret: f.secret, set: !!(f.box || f.value), hint: f.secret ? f.hint : f.value, updatedAt: f.updatedAt };
      ret.fields = out;
    }
    return ret;
  },
});

module.exports = model('CrmIntegrationSetting', integrationSettingSchema);
