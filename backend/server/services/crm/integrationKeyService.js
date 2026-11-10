'use strict';

const crypto = require('crypto');
const ApiError = require('../../utils/apiError');
const IntegrationKey = require('../../models/crm/integrationKeyModel');
const { INTEGRATION_CHANNEL_IDS } = require('../../utils/crm/constants');

// Reservia CRM - per-channel intake API keys (Change Request 2, item 6). Key format:
//
//   rsv_<channel>_<keyId>.<secret>
//
//   keyId  - 12 hex chars, random, stored in clear, used only to find the record
//   secret - 32 random bytes, base64url; only sha256(secret) is stored
//
// A key is valid only for its own channel - a leaked TikTok key cannot create Meta leads.

const KEY_PATTERN = /^rsv_([a-z_]+)_([a-f0-9]{12})\.([A-Za-z0-9_-]{40,60})$/;
// lastUsedAt is informational - written at most once a minute per key, never on every request.
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;

const hashSecret = secret => crypto.createHash('sha256').update(secret, 'utf8').digest('hex');

function assertChannel(channel) {
  if (!INTEGRATION_CHANNEL_IDS.includes(channel)) {
    throw new ApiError(`Unknown integration channel "${channel}". Use one of: ${INTEGRATION_CHANNEL_IDS.join(', ')}.`, 400);
  }
}

/** Creates a key and returns the plaintext ONCE - it is never retrievable again. */
async function createKey(channel, { label = '', userId = null } = {}) {
  assertChannel(channel);
  const keyId = crypto.randomBytes(6).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  const record = await IntegrationKey.create({
    channel,
    label: String(label || '').trim().slice(0, 100),
    keyId,
    secretHash: hashSecret(secret),
    hint: secret.slice(-4),
    createdBy: userId,
  });
  return { key: `rsv_${channel}_${keyId}.${secret}`, record: record.toJSON() };
}

/**
 * Verifies a presented key for `channel`. Returns the key record, or null for ANY failure (wrong
 * format, unknown id, revoked, wrong channel, wrong secret) - callers answer every one of those
 * with the same 401 so a caller can't probe which part was wrong.
 */
async function verifyKey(presented, channel) {
  if (typeof presented !== 'string') return null;
  const match = presented.trim().match(KEY_PATTERN);
  if (!match) return null;
  const [, keyChannel, keyId, secret] = match;
  if (keyChannel !== channel) return null;

  const record = await IntegrationKey.findOne({ keyId, channel, active: true });
  if (!record) return null;
  const expected = Buffer.from(record.secretHash, 'hex');
  const given = Buffer.from(hashSecret(secret), 'hex');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;

  if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    IntegrationKey.updateOne({ _id: record._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return record;
}

async function listKeys() {
  const keys = await IntegrationKey.find({}).sort({ createdAt: -1 }).populate({ path: 'createdBy', select: 'name' }).populate({ path: 'revokedBy', select: 'name' });
  return keys.map(k => k.toJSON());
}

async function revokeKey(id, { userId = null } = {}) {
  const record = await IntegrationKey.findById(id);
  if (!record) throw new ApiError('Integration key not found.', 404);
  if (!record.active) return record.toJSON();
  record.active = false;
  record.revokedAt = new Date();
  record.revokedBy = userId;
  await record.save();
  return record.toJSON();
}

/** Extracts a presented key from `X-Api-Key` or `Authorization: Bearer ...`. */
function presentedKeyFrom(req) {
  const header = req.get('x-api-key');
  if (header) return header;
  const auth = req.get('authorization') || '';
  return /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '') : null;
}

module.exports = { createKey, verifyKey, listKeys, revokeKey, presentedKeyFrom, hashSecret, KEY_PATTERN };
