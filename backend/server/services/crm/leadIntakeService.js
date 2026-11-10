'use strict';

const crypto = require('crypto');
const ApiError = require('../../utils/apiError');
const Activity = require('../../models/crm/activityModel');
const IntakeEvent = require('../../models/crm/intakeEventModel');
const leadService = require('./leadService');
const { INTEGRATION_CHANNELS, SOURCES } = require('../../utils/crm/constants');
const { normalizeSource } = require('../../utils/crm/sourceNormalization');
const { parseSubmissionTimestamp } = require('../../utils/crm/businessDate');

// Reservia CRM - the unified lead-intake service (Change Request 2, item 6: "All incoming leads must
// pass through the same centralized lead creation service"). Every external door - the website
// form, the WhatsApp webhook, Meta Lead Ads, TikTok, Google Ads and the CSV stopgap - ends up in
// processIntake(), which adds exactly two things on top of services/crm/leadService.js#intakeLead
// (where phone normalization to +20, duplicate matching on phone, merge-without-overwrite, source/
// campaign attribution, original timestamp, owner assignment, owner notification, the timeline
// entry and the SLA clock already live - none of those rules is re-implemented here):
//
//   1. Idempotency per provider event (CrmIntakeEvent, unique on channel + external id). A
//      redelivered webhook returns the first result instead of touching the lead again.
//   2. Resumable processing: the event records each completed step, so a retry after a partial
//      failure (lead written, note not yet) finishes the remaining step only.

// A claim older than this is assumed to belong to a crashed/timed-out attempt and may be retaken.
const STALE_PROCESSING_MS = 2 * 60 * 1000;

const safeError = err => String((err && err.operational && err.message) || 'Processing failed - see server logs.').slice(0, 300);

/**
 * Claims (channel, externalId). Returns { event, replay } - replay=true means this delivery was
 * already handled (processed/ignored) or is being handled right now by another request.
 */
async function claimEvent(channel, externalId) {
  try {
    const event = await IntakeEvent.create({ channel, externalId, status: 'processing' });
    return { event, replay: false };
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
  const existing = await IntakeEvent.findOne({ channel, externalId });
  if (!existing) throw new ApiError('Could not record the intake event - retry.', 503);
  if (existing.status === 'processed' || existing.status === 'ignored') return { event: existing, replay: true };
  const stale = Date.now() - existing.updatedAt.getTime() > STALE_PROCESSING_MS;
  if (existing.status === 'processing' && !stale) return { event: existing, replay: true, inProgress: true };
  // A failed (or abandoned) attempt - take it over atomically, so two retries can't both resume it.
  const retaken = await IntakeEvent.findOneAndUpdate(
    { _id: existing._id, status: existing.status, updatedAt: existing.updatedAt },
    { $set: { status: 'processing', lastError: null }, $inc: { attempts: 1 } },
    { new: true }
  );
  if (!retaken) return { event: existing, replay: true, inProgress: true };
  return { event: retaken, replay: false };
}

/**
 * Creates or merges one lead from a normalized intake, exactly once per (channel, externalId).
 *
 * @param {object} args
 * @param {string} args.channel - integration channel id ('website', 'meta', ..., or 'csv')
 * @param {string|null} args.externalId - the provider's event/lead id; null disables idempotency
 *   (only acceptable for a caller with no id at all, e.g. an old website build)
 * @param {object} args.lead - leadService.intakeLead input
 * @param {string} [args.note] - optional note activity (the enquiry's message / extra form answers)
 * @param {object} [args.options] - leadService.intakeLead options (userId, autoAssign, ...)
 * @returns {Promise<{leadId, refCode, created, replay}>}
 */
async function processIntake({ channel, externalId = null, lead: input, note = '', options = {} }) {
  let event = null;
  if (externalId) {
    const claim = await claimEvent(channel, String(externalId).slice(0, 200));
    event = claim.event;
    if (claim.replay) {
      return { leadId: event.lead, refCode: null, created: false, replay: true, inProgress: !!claim.inProgress, status: event.status };
    }
  }

  try {
    let leadId = event?.lead || null;
    let refCode = null;
    let created = event?.leadCreated || false;
    if (!leadId) {
      const result = await leadService.intakeLead(input, { autoAssign: true, ...options });
      leadId = result.lead._id;
      refCode = result.lead.refCode;
      created = result.created;
      if (event) await IntakeEvent.updateOne({ _id: event._id }, { $set: { lead: leadId, leadCreated: created } });
    }
    if (note && !event?.noteRecorded) {
      await Activity.create({ lead: leadId, type: 'note', body: String(note).slice(0, 5000), author: options.userId || null });
      if (event) await IntakeEvent.updateOne({ _id: event._id }, { $set: { noteRecorded: true } });
    }
    if (event) await IntakeEvent.updateOne({ _id: event._id }, { $set: { status: 'processed', processedAt: new Date(), lastError: null } });
    console.info(`[CRM intake] channel=${channel} ${created ? 'created' : 'merged'} lead=${leadId}${externalId ? ' (idempotent)' : ''}`);
    return { leadId, refCode, created, replay: false };
  } catch (err) {
    if (event) await IntakeEvent.updateOne({ _id: event._id }, { $set: { status: 'failed', lastError: safeError(err) } }).catch(() => {});
    console.error(`[CRM intake] channel=${channel} failed: ${err.message}`);
    throw err;
  }
}

/** Records a delivery that is deliberately NOT turned into a lead (e.g. a Google Ads test lead). */
async function recordIgnoredEvent(channel, externalId, reason) {
  await IntakeEvent.updateOne(
    { channel, externalId: String(externalId).slice(0, 200) },
    { $setOnInsert: { channel, externalId: String(externalId).slice(0, 200), status: 'ignored', ignoredReason: reason, processedAt: new Date() } },
    { upsert: true }
  );
}

/** Deterministic id for a source that has none (CSV rows): same row content -> same id. */
function contentDigestId(parts) {
  return crypto.createHash('sha256').update(parts.map(p => String(p ?? '')).join('|'), 'utf8').digest('hex').slice(0, 40);
}

/** Readable note lines for form answers that have no typed field on the lead. */
function formatExtraAnswers(answers) {
  return Object.entries(answers || {})
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${String(v).slice(0, 500)}`)
    .join('\n');
}

/**
 * Maps the unified endpoint's body (POST /crm/integrations/:channel/leads) onto intakeLead input.
 * Source is decided by the CHANNEL (the key proves which platform is calling), never by the body -
 * except the website channel, whose UTM parameters are mapped by the shared Change Request 1 rules.
 */
function mapUnifiedPayload(channel, body) {
  const config = INTEGRATION_CHANNELS[channel];
  if (!config) throw new ApiError('Unknown integration channel.', 400);
  const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
  const submittedAt = body.submittedAt ? parseSubmissionTimestamp(body.submittedAt) : null;
  if (body.submittedAt && !submittedAt) {
    throw new ApiError('submittedAt must be an ISO 8601 timestamp with a timezone (e.g. 2026-11-09T10:00:00+02:00) or a Unix timestamp.', 400);
  }

  let source = config.source;
  if (channel === 'website') source = normalizeSource({ utmSource: utm.utm_source, utmMedium: utm.utm_medium, referrer: body.referrer });
  // A relay forwarding WhatsApp chats may pass the Ref-code source it resolved; anything not on the
  // fixed list falls back to WhatsApp Direct, exactly like the native webhook.
  if (channel === 'whatsapp') source = SOURCES.includes(body.source) ? body.source : 'WhatsApp Direct';

  return {
    name: body.name || undefined,
    phone: body.phone,
    email: body.email || undefined,
    segment: body.segment || undefined,
    governorate: body.governorate || undefined,
    channel: config.leadChannel,
    source,
    campaign: body.campaign || utm.utm_campaign || undefined,
    adSetName: body.adSetName || undefined,
    adName: body.adName || undefined,
    adFormId: body.formId ? String(body.formId) : undefined,
    adPlatform: body.platform || undefined,
    externalLeadId: body.externalId ? String(body.externalId) : undefined,
    utmSource: utm.utm_source || undefined,
    utmMedium: utm.utm_medium || undefined,
    utmCampaign: utm.utm_campaign || undefined,
    utmContent: utm.utm_content || undefined,
    utmTerm: utm.utm_term || undefined,
    landingPage: body.pageUrl || undefined,
    referrer: body.referrer || undefined,
    submittedAt: submittedAt || undefined,
  };
}

module.exports = { processIntake, claimEvent, recordIgnoredEvent, contentDigestId, formatExtraAnswers, mapUnifiedPayload, STALE_PROCESSING_MS };
