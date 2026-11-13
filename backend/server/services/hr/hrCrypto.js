'use strict';

const crypto = require('crypto');

// HR Portal Developer Spec section 10: "pay fields encrypted at rest at the column level, no pay
// data in logs". Employee pay components and frozen payroll lines are stored as one AES-256-GCM box
// each, keyed by HR_PAY_ENCRYPTION_KEY (32 random bytes, base64 or hex) - a key of its own, so the
// CRM integration key never opens payroll.
//
// Without the key: production refuses to store pay (nothing is ever written in clear there). Local
// development and tests fall back to a clearly marked unencrypted box ("p0:") so the portal can be
// run without secrets; such boxes are re-encrypted on the next save once the key is set.

const PREFIX_ENC = 'v1:';
const PREFIX_PLAIN = 'p0:';

function loadKey() {
  const raw = (process.env.HR_PAY_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    try {
      key = Buffer.from(raw, 'base64');
    } catch {
      key = null;
    }
  }
  return key && key.length === 32 ? key : null;
}

const isConfigured = () => !!loadKey();
const isProduction = () => process.env.NODE_ENV === 'production';

class PayKeyMissingError extends Error {
  constructor() {
    super('HR_PAY_ENCRYPTION_KEY is not set on the server, so pay figures cannot be stored. Set it (32 random bytes, base64) and redeploy.');
    this.statusCode = 503;
  }
}

/** Seals any JSON value. */
function seal(value) {
  const json = JSON.stringify(value == null ? null : value);
  const key = loadKey();
  if (!key) {
    if (isProduction()) throw new PayKeyMissingError();
    return PREFIX_PLAIN + Buffer.from(json, 'utf8').toString('base64');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return `${PREFIX_ENC}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

/** Opens a box; `fallback` when empty. Throws when a box cannot be read (wrong or missing key). */
function open(box, fallback = null) {
  if (!box) return fallback;
  if (box.startsWith(PREFIX_PLAIN)) return JSON.parse(Buffer.from(box.slice(PREFIX_PLAIN.length), 'base64').toString('utf8'));
  if (!box.startsWith(PREFIX_ENC)) return fallback;
  const key = loadKey();
  if (!key) throw new PayKeyMissingError();
  const parts = box.slice(PREFIX_ENC.length).split(':');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[1], 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64')), decipher.final()]).toString('utf8'));
  } catch {
    const err = new Error('Pay figures could not be decrypted: HR_PAY_ENCRYPTION_KEY does not match the key they were saved with.');
    err.statusCode = 500;
    throw err;
  }
}

const isEncrypted = box => typeof box === 'string' && box.startsWith(PREFIX_ENC);

module.exports = { seal, open, isConfigured, isEncrypted, PayKeyMissingError };
