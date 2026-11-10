const { Schema, model } = require('mongoose');
const { INTEGRATION_CHANNEL_IDS } = require('../../utils/crm/constants');

// Reservia CRM - one API key for one lead-intake channel (Change Request 2, item 6: "one secured
// intake endpoint, with an API key per channel"). The plaintext key is shown to the MD exactly
// once, at creation; only a SHA-256 hash of its secret part is stored (the secret is 32 random
// bytes, so a fast hash is the right tool - there is nothing to brute-force, unlike a password).
// `keyId` is a short, non-secret identifier embedded in the key itself so a presented key can be
// found by index and then verified with a constant-time hash comparison.
//
// Rotation = create a new key, switch the sender over, revoke the old one. Several active keys per
// channel are allowed precisely so that switch-over needs no downtime. Revocation is permanent
// (revokedAt is set, the record is kept for audit), never a delete.
const integrationKeySchema = new Schema(
  {
    channel: { type: String, enum: INTEGRATION_CHANNEL_IDS, required: true },
    label: { type: String, trim: true, maxlength: 100, default: '' },
    keyId: { type: String, required: true, unique: true },
    secretHash: { type: String, required: true },
    // Last 4 characters of the secret - lets an admin tell two keys apart in the UI without the
    // key itself ever being displayed again.
    hint: { type: String, required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

integrationKeySchema.index({ channel: 1, active: 1 });

// Never serialize the hash, even to an authorized admin.
integrationKeySchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.secretHash;
    return ret;
  },
});

module.exports = model('CrmIntegrationKey', integrationKeySchema);
