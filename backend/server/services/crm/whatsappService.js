'use strict';

const crypto = require('crypto');
const ApiError = require('../../utils/apiError');
const { normalizeEgyptianPhone } = require('../../utils/crm/phone');
const leadService = require('./leadService');

// WhatsApp Business Platform (Meta Cloud API) webhook - Developer Brief section 4G. This file is
// deliberately INBOUND-ONLY: it verifies and processes what Meta sends us. It does NOT send
// outbound WhatsApp messages, because that requires a real, permanent System User access token
// issued against Reservia's own WhatsApp Business Account - a credential nobody has handed over
// (env.example documents WHATSAPP_ACCESS_TOKEN as a placeholder only). Building the send path
// against a token that doesn't exist would mean either leaving it silently broken or faking
// success, and the brief is explicit that a fake/simulated send is worse than an honestly-missing
// feature. See utils/crm/whatsappWindow.js for the one piece of that future feature (the 24-hour
// free-form-reply window rule) that IS safe to build now, being pure date math.
//
// What this file does implement, fully and safely without any Meta credential:
//  - the GET verification handshake (Meta calls this once, with a token WE chose and configured -
//    WHATSAPP_VERIFY_TOKEN - never a Meta-issued secret)
//  - HMAC-SHA256 payload signature verification (WHATSAPP_APP_SECRET - the app secret, which is
//    configured on our side of the Meta App dashboard, not a message-sending credential)
//  - idempotent inbound message processing (routes/crm/whatsappRoute.js + leadService's own
//    whatsappMessageId unique index - the same message delivered twice by Meta's at-least-once
//    retries is only ever recorded once)
//  - phone-based lead routing: an inbound message either opens a new lead or appends to the
//    existing one for that number, through the SAME intakeLead/recordActivity dedupe path every
//    other channel uses

/**
 * The GET /webhook handshake Meta performs once per subscription. Returns the challenge string to
 * echo back verbatim, or null if the verify token doesn't match (caller should 403).
 */
function verifySubscription({ mode, token, challenge }) {
  if (mode !== 'subscribe') return null;
  if (!process.env.WHATSAPP_VERIFY_TOKEN) return null;
  if (token !== process.env.WHATSAPP_VERIFY_TOKEN) return null;
  return challenge;
}

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the RAW request body (must be the exact
 * bytes Meta sent, computed before any body-parsing/re-serialization can alter whitespace) using
 * the shared app secret. Constant-time compare - a signature check that short-circuits on the
 * first differing byte leaks timing information an attacker can use to forge a valid signature.
 */
function verifySignature(rawBody, signatureHeader) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = signatureHeader.slice('sha256='.length);
  const expectedBuf = Buffer.from(expected, 'hex');
  const givenBuf = Buffer.from(given, 'hex');
  if (expectedBuf.length !== givenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, givenBuf);
}

/** A short, non-PII display label for an inbound message, by its Meta `type`. Never stores raw media. */
function describeMessage(message) {
  switch (message.type) {
    case 'text':
      return message.text?.body || '';
    case 'image':
      return '[Image attachment]';
    case 'document':
      return `[Document attachment${message.document?.filename ? `: ${message.document.filename}` : ''}]`;
    case 'audio':
      return '[Voice/audio message]';
    case 'video':
      return '[Video attachment]';
    case 'location':
      return '[Shared location]';
    default:
      return `[${message.type || 'Unsupported'} message]`;
  }
}

/**
 * Processes one already-signature-verified Meta webhook payload. Only the `messages` field of a
 * change is actioned (brief: inbound messages create/append to leads); `statuses` entries
 * (delivered/read receipts) are acknowledged but not stored - they describe OUR outbound sends,
 * which this system does not yet make.
 */
async function processWebhookPayload(payload) {
  const results = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change.value || {};
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const contactsByWaId = Object.fromEntries((value.contacts || []).map(c => [c.wa_id, c.profile?.name || null]));
      for (const message of messages) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await handleInboundMessage(message, contactsByWaId[message.from] || null));
      }
    }
  }
  return results;
}

async function handleInboundMessage(message, contactName) {
  const phoneE164 = normalizeEgyptianPhone(message.from);
  if (!phoneE164) return { skipped: true, reason: 'unrecognized phone', raw: message.from };

  const { lead } = await leadService.intakeLead({ phone: phoneE164, channel: 'whatsapp', name: contactName });
  const activity = await leadService.recordActivity(
    lead._id,
    { type: 'whatsapp_in', body: describeMessage(message), whatsappMessageId: message.id },
    {}
  );
  return { leadId: lead._id, activityId: activity._id };
}

module.exports = { verifySubscription, verifySignature, processWebhookPayload, describeMessage };

// Re-exported for routes/crm/whatsappRoute.js's error responses without a second import path.
module.exports.ApiError = ApiError;
