const crypto = require('crypto');

// Website Management - encrypts the one third-party secret this feature ever stores at rest (the
// Meta Conversions API access token, websiteIntegrationModel.js#metaCapi.accessTokenCipher). No
// "encrypt a secret in Mongo" precedent exists elsewhere in this codebase (every other third-party
// credential is a bare process.env.X read - see services/crm/whatsappService.js's
// WHATSAPP_APP_SECRET) - this is new, deliberately small infrastructure using only Node's built-in
// `crypto` (no new npm dependency), modeled on userModel.js's existing `password: {select:false}`
// + explicit-response-allowlist convention (belt: select:false; suspenders: the controller never
// serializes the cipher field into any API response - see buildContentController.js and
// integrationController.js).
//
// Key: WEBSITE_SECRET_KEY env var, a 32-byte key (64 hex chars, e.g. `openssl rand -hex 32`).
// Format: "iv:ciphertext:authTag" (all hex) - AES-256-GCM, so tampering is detected, not just
// obscured.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
  const hex = process.env.WEBSITE_SECRET_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('WEBSITE_SECRET_KEY must be set to a 64-character hex string (32 bytes) to store a tracking integration secret.');
  }
  return Buffer.from(hex, 'hex');
}

/** Encrypts a plaintext secret for storage. Returns "iv:ciphertext:authTag", all hex. */
function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${ciphertext.toString('hex')}:${authTag.toString('hex')}`;
}

/** Decrypts a value produced by encryptSecret. Throws if the key is wrong or the value was tampered with. */
function decryptSecret(stored) {
  const [ivHex, ciphertextHex, authTagHex] = String(stored).split(':');
  if (!ivHex || !ciphertextHex || !authTagHex) throw new Error('Malformed encrypted secret.');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}

/** The last 4 characters of a plaintext secret - safe to return to the UI so an admin can confirm "a token is set" without it ever round-tripping. */
function last4(plaintext) {
  const value = String(plaintext || '');
  return value.length >= 4 ? value.slice(-4) : value;
}

module.exports = { encryptSecret, decryptSecret, last4 };
