'use strict';

const crypto = require('crypto');

// AES-256-GCM encryption for integration credentials stored in the database (CRM C6: "secure
// credential storage", "never return secrets to the frontend"). The key lives ONLY in the server
// environment (INTEGRATION_SECRETS_KEY: 32 random bytes, base64 or hex) - never in the database,
// never in Git, never sent to a client. Without it, credentials can still come from environment
// variables, but nothing can be saved from the Integrations page (refused, never stored in clear).
//
// Stored format: "v1:<iv b64>:<tag b64>:<ciphertext b64>".

function loadKey() {
  const raw = process.env.INTEGRATION_SECRETS_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) key = Buffer.from(trimmed, 'hex');
  else {
    try {
      key = Buffer.from(trimmed, 'base64');
    } catch {
      key = null;
    }
  }
  return key && key.length === 32 ? key : null;
}

function isConfigured() {
  return !!loadKey();
}

function encrypt(plaintext) {
  const key = loadKey();
  if (!key) throw new Error('INTEGRATION_SECRETS_KEY is not set (32 random bytes, base64 or hex) - credentials cannot be stored.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(box) {
  const key = loadKey();
  if (!key || typeof box !== 'string') return null;
  const parts = box.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null; // wrong key / tampered - treated as "not set", never thrown to a caller
  }
}

/** Last 4 characters only - lets an admin recognize a stored value without ever seeing it. */
function hint(value) {
  const s = String(value || '');
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
}

module.exports = { isConfigured, encrypt, decrypt, hint };
