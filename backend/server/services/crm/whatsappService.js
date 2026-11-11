'use strict';

const crypto = require('crypto');
const ApiError = require('../../utils/apiError');
const { normalizeEgyptianPhone } = require('../../utils/crm/phone');
const leadService = require('./leadService');
const WaRefCode = require('../../models/crm/waRefCodeModel');
const Activity = require('../../models/crm/activityModel');
const { parseSubmissionTimestamp } = require('../../utils/crm/businessDate');

// Change Request 1, Feature 1: "WhatsApp message with a recognized Ref code -> Source associated
// with that code." The code the website appends to every wa.me prefilled message
// (services/waRefCode.ts) looks like "WA-0511-VIL-K2F9" - matched here out of the customer's own
// first message text and looked up against what the website registered at click time
// (services/crm/publicLeadIntakeService.js#registerWaRefCode).
const WA_REF_PATTERN = /\bWA-\d{4}-[A-Z]{3}-[A-Z0-9]{4}\b/;

/**
 * The attribution a WhatsApp message carries: the Ref code's registered source and UTM fields
 * when the message contains a recognized code, else "WhatsApp Direct" with no campaign.
 */
async function resolveWhatsAppAttribution(messageText) {
  const match = String(messageText || '').match(WA_REF_PATTERN);
  const found = match ? await WaRefCode.findOne({ code: match[0] }).lean() : null;
  if (!found) return { source: 'WhatsApp Direct', refCode: match ? match[0] : null };
  return {
    source: found.source || 'WhatsApp Direct',
    refCode: found.code,
    utmSource: found.utmSource || undefined,
    utmMedium: found.utmMedium || undefined,
    utmCampaign: found.utmCampaign || undefined,
    utmContent: found.utmContent || undefined,
  };
}

/** @returns {Promise<string>} a real SOURCES value - the recognized code's source, or the "WhatsApp without a recognized Ref code" fallback. */
async function resolveWhatsAppSource(messageText) {
  return (await resolveWhatsAppAttribution(messageText)).source;
}

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
function verifySubscription({ mode, token, challenge }, expectedToken = process.env.WHATSAPP_VERIFY_TOKEN) {
  if (mode !== 'subscribe') return null;
  if (!expectedToken) return null;
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(String(expectedToken));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return challenge;
}

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the RAW request body (must be the exact
 * bytes Meta sent, computed before any body-parsing/re-serialization can alter whitespace) using
 * the shared app secret. Constant-time compare - a signature check that short-circuits on the
 * first differing byte leaks timing information an attacker can use to forge a valid signature.
 */
function verifySignature(rawBody, signatureHeader, secret = process.env.WHATSAPP_APP_SECRET) {
  if (!secret || !rawBody) return false;
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
      // Coexistence: a reply a salesperson types in the WhatsApp Business APP on the same number is
      // echoed to the webhook (field "smb_message_echoes"). It is a genuine human reply (C7), so it
      // is recorded as whatsapp_out and offered as the lead's first reply. Echoes never create a lead.
      const echoes = Array.isArray(value.message_echoes) ? value.message_echoes : [];
      for (const echo of echoes) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await handleOutboundEcho(echo));
      }
    }
  }
  return results;
}

async function handleOutboundEcho(echo) {
  const phoneE164 = normalizeEgyptianPhone(echo.to);
  if (!phoneE164 || !echo.id) return { skipped: true, reason: 'unrecognized echo' };
  // eslint-disable-next-line global-require
  const Lead = require('../../models/crm/leadModel');
  const lead = await Lead.findOne({ phoneE164 }).select('_id').lean();
  if (!lead) return { skipped: true, reason: 'no lead for this number' };
  const sentAt = parseSubmissionTimestamp(echo.timestamp) || new Date();
  const activity = await leadService.recordActivity(lead._id, { type: 'whatsapp_out', body: `[Sent from the WhatsApp Business app] ${describeMessage(echo)}`.slice(0, 2000), whatsappMessageId: echo.id }, {});
  // recordActivity offered the activity's own createdAt; the real send time can be earlier (a delayed delivery).
  // eslint-disable-next-line global-require
  const { offerFirstReply } = require('./firstReplyService');
  await offerFirstReply(lead._id, sentAt, 'whatsapp_out');
  return { leadId: lead._id, activityId: activity._id, echo: true };
}

async function handleInboundMessage(message, contactName) {
  const phoneE164 = normalizeEgyptianPhone(message.from);
  if (!phoneE164) return { skipped: true, reason: 'unrecognized phone' };

  // Change Request 2, item 9 (idempotency): a redelivered message is recognized BEFORE the lead is
  // touched at all - previously the repeat-enquiry note was written first and only the activity
  // itself was deduplicated, so every Meta retry still added a "Repeat enquiry" timeline entry.
  if (message.id) {
    const seen = await Activity.findOne({ whatsappMessageId: message.id }).select('_id lead').lean();
    if (seen) return { leadId: seen.lead, activityId: seen._id, replay: true };
  }

  // Attribution is resolved from the FIRST message only - intakeLead never overwrites an existing
  // lead's first-touch source/campaign on a repeat contact, matching every other channel's rule.
  const attribution = await resolveWhatsAppAttribution(message.text?.body);
  const { refCode, ...attributionFields } = attribution;
  const { lead, created } = await leadService.intakeLead(
    {
      phone: phoneE164,
      channel: 'whatsapp',
      name: contactName,
      ...attributionFields,
      // Meta's own send time (Unix seconds) - the SLA clock starts when the customer wrote.
      submittedAt: parseSubmissionTimestamp(message.timestamp) || undefined,
    },
    // The inbound message below IS the timeline entry for a repeat contact - no extra note.
    { skipRepeatNote: true }
  );
  const activity = await leadService.recordActivity(
    lead._id,
    { type: 'whatsapp_in', body: describeMessage(message), whatsappMessageId: message.id },
    {}
  );
  if (created && refCode) {
    await Activity.create({ lead: lead._id, type: 'system', body: `WhatsApp Ref code ${refCode} -> source ${attribution.source}.` });
  }
  return { leadId: lead._id, activityId: activity._id, created };
}

module.exports = { verifySubscription, verifySignature, processWebhookPayload, describeMessage, resolveWhatsAppSource, resolveWhatsAppAttribution };

// Re-exported for routes/crm/whatsappRoute.js's error responses without a second import path.
module.exports.ApiError = ApiError;
