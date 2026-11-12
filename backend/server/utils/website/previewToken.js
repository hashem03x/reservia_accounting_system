'use strict';

const crypto = require('crypto');

// Website Management - draft preview tokens. A signed, short-lived, single-page token lets the
// REAL public website (its own components) render a page's draft:
//   dashboard (authenticated, 'view') -> POST /website/pages/:id/preview-token -> token
//   website /<lang>/__preview?token=... -> GET /website/public/preview/:token -> that page's draft
// The public endpoint returns nothing without a valid, unexpired signature, and only the one
// page named in the token. Secret: WEBSITE_PREVIEW_SECRET, else derived from JWT_SECRET_KEY (never
// sent anywhere). Format: base64url(payload).base64url(hmac).

const TTL_SECONDS = 30 * 60;

function secret() {
  const base = process.env.WEBSITE_PREVIEW_SECRET || process.env.JWT_SECRET_KEY;
  if (!base) throw new Error('No preview signing secret configured (WEBSITE_PREVIEW_SECRET or JWT_SECRET_KEY).');
  return crypto.createHash('sha256').update(`website-preview:${base}`).digest();
}

const b64 = buf => Buffer.from(buf).toString('base64url');
const sign = data => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

function createPreviewToken(pageId, { userId, ttlSeconds = TTL_SECONDS, now = Date.now() } = {}) {
  const payload = b64(JSON.stringify({ p: String(pageId), u: userId ? String(userId) : null, exp: Math.floor(now / 1000) + ttlSeconds }));
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date((Math.floor(now / 1000) + ttlSeconds) * 1000) };
}

/** The page id the token grants, or null when it is malformed, forged or expired. */
function verifyPreviewToken(token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.p || !/^[a-f0-9]{24}$/i.test(data.p) || !(data.exp > Math.floor(now / 1000))) return null;
    return { pageId: data.p, userId: data.u || null, exp: data.exp };
  } catch {
    return null;
  }
}

module.exports = { createPreviewToken, verifyPreviewToken, TTL_SECONDS };
