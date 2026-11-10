const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const IntakeEvent = require('../../models/crm/intakeEventModel');
const IntegrationKey = require('../../models/crm/integrationKeyModel');
const Activity = require('../../models/crm/activityModel');
const { INTEGRATION_CHANNELS, INTEGRATION_CHANNEL_IDS } = require('../../utils/crm/constants');
const keyService = require('../../services/crm/integrationKeyService');
const { processIntake, mapUnifiedPayload, formatExtraAnswers } = require('../../services/crm/leadIntakeService');
const metaLeadAdsService = require('../../services/crm/metaLeadAdsService');
const googleAdsLeadService = require('../../services/crm/googleAdsLeadService');
const { eligibleSalesEngineers } = require('../../services/crm/leadAssignmentService');

// Reservia CRM - the five lead doors (Change Request 2, section 4) + their admin screen.

// ---------------------------------------------------------------- unified API-key endpoint

/**
 * POST /api/v1/crm/integrations/:channel/leads - any channel, authenticated by that channel's own
 * API key (middleware/integrationAccess.js). The response never echoes contact data back.
 */
exports.receiveUnifiedLead = asyncHandler(async (req, res) => {
  const { channel } = req.params;
  const lead = mapUnifiedPayload(channel, req.body);
  const noteLines = [];
  if (req.body.message) noteLines.push(`Message: ${String(req.body.message).slice(0, 2000)}`);
  const answers = formatExtraAnswers(req.body.answers);
  if (answers) noteLines.push(answers);
  const result = await processIntake({
    channel,
    externalId: `api:${req.body.externalId}`,
    lead,
    note: noteLines.join('\n'),
  });
  if (result.inProgress) {
    return res.status(409).json(apiResponse('This event is already being processed - retry shortly.', false, { replay: true }));
  }
  return res.status(result.created ? 201 : 200).json(
    apiResponse(result.replay ? 'Already received - nothing changed.' : result.created ? 'Lead created.' : 'Merged into the existing lead for this phone number.', true, {
      created: result.created,
      replay: result.replay,
      refCode: result.refCode || undefined,
    })
  );
});

// ---------------------------------------------------------------- Meta Lead Ads webhook

exports.verifyMetaWebhook = (req, res) => {
  const challenge = metaLeadAdsService.verifySubscription({
    mode: req.query['hub.mode'],
    token: req.query['hub.verify_token'],
    challenge: req.query['hub.challenge'],
  });
  if (challenge == null) return res.status(403).send('Verification failed.');
  return res.status(200).send(String(challenge));
};

exports.receiveMetaWebhook = asyncHandler(async (req, res, next) => {
  if (!metaLeadAdsService.verifySignature(req.rawBody, req.header('X-Hub-Signature-256'))) {
    return next(new ApiError('Invalid webhook signature.', 403));
  }
  const { results, retryable } = await metaLeadAdsService.processWebhookPayload(req.body);
  // A transient failure (Graph API down, DB hiccup) answers 500 so Meta redelivers; every lead
  // that DID succeed replays idempotently on that redelivery, so nothing is duplicated.
  if (retryable) return res.status(500).json({ success: false, processed: results.filter(r => !r.error).length });
  return res.status(200).send('EVENT_RECEIVED');
});

// ---------------------------------------------------------------- Google Ads lead form webhook

exports.receiveGoogleAdsWebhook = asyncHandler(async (req, res) => {
  try {
    const { status, body } = await googleAdsLeadService.handleWebhook(req.body);
    return res.status(status).json(body);
  } catch (err) {
    // A permanent, data-level rejection (e.g. a non-Egyptian phone) is acknowledged so Google
    // stops retrying; it is recorded as a failed intake event on the Integrations screen.
    if (err.operational && err.statusCode && err.statusCode < 500) {
      return res.status(200).json({ success: false, rejected: err.message });
    }
    throw err;
  }
});

// ---------------------------------------------------------------- admin: status, events, keys

const DAY = 86400000;

/** Which server-side settings each door needs, without ever revealing their values. */
function channelConfiguration(channel) {
  const has = name => !!process.env[name];
  switch (channel) {
    case 'website':
      return { publicFormEndpoint: true, required: [] };
    case 'whatsapp':
      return { required: [{ name: 'WHATSAPP_VERIFY_TOKEN', set: has('WHATSAPP_VERIFY_TOKEN') }, { name: 'WHATSAPP_APP_SECRET', set: has('WHATSAPP_APP_SECRET') }] };
    case 'meta':
      return {
        required: [
          { name: 'META_VERIFY_TOKEN', set: has('META_VERIFY_TOKEN') },
          { name: 'META_APP_SECRET', set: has('META_APP_SECRET') },
          { name: 'META_PAGE_ACCESS_TOKEN', set: has('META_PAGE_ACCESS_TOKEN') },
        ],
      };
    default:
      return { required: [] }; // tiktok / google_ads authenticate with an API key only
  }
}

function overallState({ configured, activeKeys, channel, lastProcessedAt, recentFailures }) {
  const needsKey = ['tiktok', 'google_ads'].includes(channel);
  if (!configured || (needsKey && activeKeys === 0)) return 'not_configured';
  if (recentFailures > 0) return 'errors';
  if (lastProcessedAt && Date.now() - new Date(lastProcessedAt).getTime() < 7 * DAY) return 'receiving';
  return 'awaiting_first_event';
}

exports.getStatus = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 7 * DAY);
  const [keyCounts, eventStats, lastWhatsapp, pool] = await Promise.all([
    IntegrationKey.aggregate([{ $match: { active: true } }, { $group: { _id: '$channel', count: { $sum: 1 } } }]),
    IntakeEvent.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { channel: '$channel', status: '$status' }, count: { $sum: 1 }, last: { $max: '$updatedAt' } } },
    ]),
    Activity.findOne({ type: 'whatsapp_in' }).sort({ createdAt: -1 }).select('createdAt').lean(),
    eligibleSalesEngineers(),
  ]);
  const lastProcessedEver = await IntakeEvent.aggregate([{ $match: { status: 'processed' } }, { $group: { _id: '$channel', last: { $max: '$processedAt' } } }]);

  const keysBy = Object.fromEntries(keyCounts.map(k => [k._id, k.count]));
  const lastBy = Object.fromEntries(lastProcessedEver.map(r => [r._id, r.last]));
  const stat = (channel, status) => eventStats.find(e => e._id.channel === channel && e._id.status === status)?.count || 0;

  const channels = [...INTEGRATION_CHANNEL_IDS, 'csv'].map(channel => {
    const config = channel === 'csv' ? { required: [] } : channelConfiguration(channel);
    const configured = config.required.every(r => r.set);
    let lastProcessedAt = lastBy[channel] || null;
    if (channel === 'whatsapp' && lastWhatsapp?.createdAt && (!lastProcessedAt || lastWhatsapp.createdAt > lastProcessedAt)) lastProcessedAt = lastWhatsapp.createdAt;
    const recentFailures = stat(channel, 'failed');
    return {
      channel,
      label: channel === 'csv' ? 'CSV import (stopgap)' : INTEGRATION_CHANNELS[channel].label,
      source: channel === 'csv' ? null : INTEGRATION_CHANNELS[channel].source,
      activeKeys: keysBy[channel] || 0,
      settings: config.required,
      lastProcessedAt,
      last7Days: { processed: stat(channel, 'processed'), failed: recentFailures, ignored: stat(channel, 'ignored') },
      state: channel === 'csv' ? (lastProcessedAt ? 'receiving' : 'awaiting_first_event') : overallState({ configured, activeKeys: keysBy[channel] || 0, channel, lastProcessedAt, recentFailures }),
    };
  });

  res.status(200).json(
    apiResponse('Integration status retrieved', true, {
      channels,
      // Every automated door assigns owners from this pool (Change Request 1, Feature 2). Zero
      // means new leads will arrive UNOWNED and nobody is notified.
      assignmentPoolSize: pool.length,
      endpoints: {
        unified: '/api/v1/crm/integrations/:channel/leads',
        metaWebhook: '/api/v1/crm/integrations/meta/webhook',
        googleAdsWebhook: '/api/v1/crm/integrations/google_ads/webhook',
        whatsappWebhook: '/api/v1/crm/whatsapp/webhook',
        websiteForm: '/api/v1/crm/public/leads',
      },
    })
  );
});

exports.listEvents = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.channel) filter.channel = String(req.query.channel);
  if (req.query.status) filter.status = String(req.query.status);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const events = await IntakeEvent.find(filter).sort({ createdAt: -1 }).limit(limit).populate({ path: 'lead', select: 'refCode' }).lean();
  // externalId can be a provider lead id - fine for an admin; contact data is never stored here.
  res.status(200).json(apiResponse('Intake events retrieved', true, events));
});

exports.listKeys = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Integration keys retrieved', true, await keyService.listKeys()));
});

exports.createKey = asyncHandler(async (req, res) => {
  const { key, record } = await keyService.createKey(req.body.channel, { label: req.body.label, userId: req.user._id });
  console.info(`[CRM integrations] key ${record.keyId} created for channel=${record.channel} by user ${req.user._id}`);
  // The ONLY response that ever contains the plaintext key.
  res.status(201).json(apiResponse('Key created. Copy it now - it will not be shown again.', true, { key, record }));
});

exports.revokeKey = asyncHandler(async (req, res) => {
  const record = await keyService.revokeKey(req.params.id, { userId: req.user._id });
  console.info(`[CRM integrations] key ${record.keyId} revoked by user ${req.user._id}`);
  res.status(200).json(apiResponse('Key revoked.', true, record));
});
