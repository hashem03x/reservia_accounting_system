const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const IntakeEvent = require('../../models/crm/intakeEventModel');
const IntegrationKey = require('../../models/crm/integrationKeyModel');
const Activity = require('../../models/crm/activityModel');
const Lead = require('../../models/crm/leadModel');
const StageHistory = require('../../models/crm/stageHistoryModel');
const { INTEGRATION_CHANNELS, INTEGRATION_CHANNEL_IDS } = require('../../utils/crm/constants');
const keyService = require('../../services/crm/integrationKeyService');
const { processIntake, mapUnifiedPayload, formatExtraAnswers } = require('../../services/crm/leadIntakeService');
const metaLeadAdsService = require('../../services/crm/metaLeadAdsService');
const googleAdsLeadService = require('../../services/crm/googleAdsLeadService');
const { eligibleSalesEngineers } = require('../../services/crm/leadAssignmentService');
const settings = require('../../services/crm/integrationSettingsService');
const secretBox = require('../../utils/crm/secretBox');

// Reservia CRM - the lead doors (Change Request 2, section 4) + their admin screen (CRM C2-C6).

// ---------------------------------------------------------------- unified API-key endpoint

/**
 * POST /api/v1/crm/integrations/:channel/leads - any channel, authenticated by that channel's own
 * API key (middleware/integrationAccess.js). The response never echoes contact data back.
 */
exports.receiveUnifiedLead = asyncHandler(async (req, res) => {
  const { channel } = req.params;
  if (channel !== 'website' && !(await settings.isEnabled(channel).catch(() => true))) {
    return res.status(403).json(apiResponse('This integration is disabled in the CRM.', false));
  }
  const lead = mapUnifiedPayload(channel, req.body);
  const noteLines = [];
  if (req.body.message) noteLines.push(`Message: ${String(req.body.message).slice(0, 2000)}`);
  const answers = formatExtraAnswers(req.body.answers);
  if (answers) noteLines.push(answers);
  const result = await processIntake({ channel, externalId: `api:${req.body.externalId}`, lead, note: noteLines.join('\n') });
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

exports.verifyMetaWebhook = asyncHandler(async (req, res) => {
  if (!(await settings.isEnabled('meta'))) return res.status(403).send('Integration disabled.');
  const expected = await settings.getValue('meta', 'verifyToken');
  const challenge = metaLeadAdsService.verifySubscription({ mode: req.query['hub.mode'], token: req.query['hub.verify_token'], challenge: req.query['hub.challenge'] }, expected);
  if (challenge == null) return res.status(403).send('Verification failed.');
  await settings.recordWebhookVerified('meta');
  return res.status(200).send(String(challenge));
});

exports.receiveMetaWebhook = asyncHandler(async (req, res, next) => {
  if (!(await settings.isEnabled('meta'))) return res.status(200).send('IGNORED_DISABLED');
  const { values } = await settings.getAll('meta');
  if (!metaLeadAdsService.verifySignature(req.rawBody, req.header('X-Hub-Signature-256'), values.appSecret)) {
    return next(new ApiError('Invalid webhook signature.', 403));
  }
  const { results, retryable } = await metaLeadAdsService.processWebhookPayload(req.body, {
    credentials: { pageAccessToken: values.pageAccessToken, appSecret: values.appSecret },
  });
  const failed = results.filter(r => r.error);
  if (failed.length) await settings.recordDeliveryError('meta', failed[0].error);
  // A transient failure (Graph API down, DB hiccup) answers 500 so Meta redelivers; every lead
  // that DID succeed replays idempotently on that redelivery, so nothing is duplicated.
  if (retryable) return res.status(500).json({ success: false, processed: results.filter(r => !r.error).length });
  return res.status(200).send('EVENT_RECEIVED');
});

// ---------------------------------------------------------------- Google Ads lead form webhook

exports.receiveGoogleAdsWebhook = asyncHandler(async (req, res) => {
  if (!(await settings.isEnabled('google_ads'))) return res.status(200).json({ success: false, disabled: true });
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

// ---------------------------------------------------------------- admin: status, settings, events, keys

const DAY = 86400000;

// Setup steps shown on the Integrations page for each door (CRM C6: "clear setup instructions").
const SETUP = {
  website: [
    'The website posts every quote/contact form to the public endpoint below - no key is needed; browser origins are restricted by CORS (WEBSITE_ALLOWED_ORIGINS).',
    'Each submission carries first-touch and last-touch attribution (UTM, gclid/gbraid/wbraid/fbclid/ttclid, landing page, referrer).',
  ],
  whatsapp: [
    'Meta Business -> WhatsApp Manager: add the business number to the WhatsApp Cloud API app.',
    'Create a System User with whatsapp_business_messaging + whatsapp_business_management and generate a permanent access token.',
    'Enter the verify token (any random string you choose), the app secret, the access token and the phone number ID here, then press Test.',
    'Meta app -> WhatsApp -> Configuration: set the callback URL below and the same verify token; subscribe to "messages" (and "smb_message_echoes" if the WhatsApp Business app is also used on this number).',
  ],
  meta: [
    'Meta Business: create a System User with leads_retrieval, pages_manage_metadata, pages_read_engagement, pages_show_list and ads_read on the Page; generate a long-lived Page access token.',
    'Enter the verify token, app secret, Page access token and Page ID here, then press Test.',
    'Meta app -> Webhooks -> Page: set the callback URL below with the same verify token and subscribe to "leadgen"; allow the app in the Page Leads Access Manager.',
  ],
  tiktok: [
    'Create an API key below for the tiktok channel and deliver TikTok lead-form submissions to the unified endpoint with header X-Api-Key (TikTok Leads Center CRM integration, or a relay such as Zapier / Make).',
    'Optional: enter the Marketing API access token, app ID / secret and advertiser ID and press Test to verify the advertiser account.',
  ],
  google_ads: [
    'Lead forms: create an API key below for the google_ads channel; in Google Ads -> lead form -> Lead delivery, set the webhook URL below and paste the key as the webhook key.',
    'Click attribution: the website records gclid / gbraid / wbraid on every lead automatically - no credentials needed for that.',
    'Offline conversions: export Won deals that carry a click id (button below) and import them in Google Ads (Goals -> Conversions -> Uploads) or via the Data Manager API. Google is retiring offline click-conversion uploads through the Google Ads API for new adopters, so nothing is uploaded automatically.',
    'Optional: enter the developer token, OAuth client, refresh token and customer IDs and press Test to verify API access.',
  ],
  csv: ['Use CRM -> Import to upload a CSV exported from an ad platform when a live integration is not available yet.'],
};

exports.getStatus = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 7 * DAY);
  const [keyCounts, eventStats, lastWhatsapp, pool, lastProcessedEver, lastFailedEver] = await Promise.all([
    IntegrationKey.aggregate([{ $match: { active: true } }, { $group: { _id: '$channel', count: { $sum: 1 } } }]),
    IntakeEvent.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { channel: '$channel', status: '$status' }, count: { $sum: 1 } } }]),
    Activity.findOne({ type: 'whatsapp_in' }).sort({ createdAt: -1 }).select('createdAt').lean(),
    eligibleSalesEngineers(),
    IntakeEvent.aggregate([{ $match: { status: 'processed' } }, { $group: { _id: '$channel', last: { $max: '$processedAt' } } }]),
    IntakeEvent.aggregate([{ $match: { status: 'failed' } }, { $group: { _id: '$channel', last: { $max: '$updatedAt' } } }]),
  ]);
  const keysBy = Object.fromEntries(keyCounts.map(k => [k._id, k.count]));
  const lastBy = Object.fromEntries(lastProcessedEver.map(r => [r._id, r.last]));
  const failBy = Object.fromEntries(lastFailedEver.map(r => [r._id, r.last]));
  const stat = (channel, status) => eventStats.find(e => e._id.channel === channel && e._id.status === status)?.count || 0;

  const channels = [];
  for (const channel of [...INTEGRATION_CHANNEL_IDS, 'csv']) {
    let lastProcessedAt = lastBy[channel] || null;
    if (channel === 'whatsapp' && lastWhatsapp?.createdAt && (!lastProcessedAt || lastWhatsapp.createdAt > lastProcessedAt)) lastProcessedAt = lastWhatsapp.createdAt;
    const base = {
      channel,
      label: channel === 'csv' ? 'CSV import (stopgap)' : INTEGRATION_CHANNELS[channel].label,
      source: channel === 'csv' ? null : INTEGRATION_CHANNELS[channel].source,
      activeKeys: keysBy[channel] || 0,
      lastProcessedAt,
      last7Days: { processed: stat(channel, 'processed'), failed: stat(channel, 'failed'), ignored: stat(channel, 'ignored') },
      setup: SETUP[channel] || [],
    };
    if (channel === 'website' || channel === 'csv') {
      // No external credentials: connected once real submissions arrive; an error if the newest event failed.
      const failedAt = failBy[channel] ? new Date(failBy[channel]) : null;
      // CRM Changes Required, item 7: CSV import needs no credentials - before the first import it is
      // 'ready' (not 'awaiting verification', which read as "not working yet").
      const idle = channel === 'csv' ? 'ready' : 'awaiting_verification';
      const state = failedAt && (!lastProcessedAt || failedAt > new Date(lastProcessedAt)) ? 'error' : lastProcessedAt ? 'connected' : idle;
      channels.push({ ...base, state, enabled: true, settings: [], lastSuccessAt: lastProcessedAt, lastError: state === 'error' ? { at: failedAt, message: 'The latest submission failed - see the event log.' } : null });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const st = await settings.computeStatus(channel, { lastProcessedAt, activeKeys: keysBy[channel] || 0, lastFailureAt: failBy[channel] || null });
    channels.push({ ...base, ...st });
  }

  res.status(200).json(
    apiResponse('Integration status retrieved', true, {
      channels,
      // Every automated door assigns owners from this pool (Change Request 1, Feature 2). Zero means
      // new leads arrive UNOWNED - CRM managers are then emailed about each one.
      assignmentPoolSize: pool.length,
      secretsStorageAvailable: secretBox.isConfigured(),
      endpoints: {
        unified: '/api/v1/crm/integrations/:channel/leads',
        metaWebhook: '/api/v1/crm/integrations/meta/webhook',
        googleAdsWebhook: '/api/v1/crm/integrations/google_ads/webhook',
        whatsappWebhook: '/api/v1/crm/whatsapp/webhook',
        websiteForm: '/api/v1/crm/public/leads',
        googleAdsOfflineConversions: '/api/v1/crm/integrations/google_ads/offline-conversions.csv',
      },
    })
  );
});

/** PUT /settings/:channel - MD only. Body: { values: { key: string|null } }. Secrets are encrypted; nothing secret is echoed back. */
exports.saveSettings = asyncHandler(async (req, res) => {
  const { channel } = req.params;
  const values = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {};
  await settings.saveSettings(channel, values, { userId: req.user._id });
  console.info(`[CRM integrations] settings for ${channel} updated by user ${req.user._id} (keys: ${Object.keys(values).join(',')})`);
  res.status(200).json(apiResponse('Settings saved. Press Test to verify the connection.', true, await settings.computeStatus(channel)));
});

/** PATCH /settings/:channel/enabled - MD only. */
exports.setEnabled = asyncHandler(async (req, res) => {
  const enabled = req.body?.enabled !== false;
  await settings.setEnabled(req.params.channel, enabled, { userId: req.user._id });
  res.status(200).json(apiResponse(enabled ? 'Integration enabled.' : 'Integration disabled.', true, await settings.computeStatus(req.params.channel)));
});

/** POST /settings/:channel/test - a REAL authenticated API call with the effective credentials. */
exports.testSettings = asyncHandler(async (req, res) => {
  const result = await settings.testConnection(req.params.channel);
  res.status(200).json(apiResponse(result.message, result.ok, { ...result, status: await settings.computeStatus(req.params.channel) }));
});

/** POST /events/:id/retry - re-processes a FAILED Meta delivery (fetched again from the Graph API; idempotent). */
exports.retryEvent = asyncHandler(async (req, res, next) => {
  const event = await IntakeEvent.findById(req.params.id);
  if (!event) return next(new ApiError('Intake event not found.', 404));
  if (event.status !== 'failed') return next(new ApiError('Only a failed delivery can be retried.', 400));
  if (event.channel !== 'meta') {
    return next(new ApiError('Lead data is never stored for this channel, so it cannot be replayed here - the sending platform retries failed deliveries automatically.', 400));
  }
  const { values } = await settings.getAll('meta');
  try {
    const result = await metaLeadAdsService.reprocessLead(event.externalId, { credentials: { pageAccessToken: values.pageAccessToken, appSecret: values.appSecret } });
    res.status(200).json(apiResponse(result.skipped ? `Skipped: ${result.skipped}` : 'Delivery reprocessed.', true, result));
  } catch (err) {
    await IntakeEvent.updateOne({ _id: event._id }, { $set: { lastError: String(err.message).slice(0, 300) }, $inc: { attempts: 1 } });
    throw err;
  }
});

/**
 * GET /google_ads/offline-conversions.csv?from=YYYY-MM-DD&to=YYYY-MM-DD - Won leads carrying a
 * Google click id, in the Google Ads offline-conversion import layout. Uses the LAST touch click id
 * (the click that preceded the conversion), falling back to the first touch.
 */
exports.exportGoogleAdsConversions = asyncHandler(async (req, res) => {
  const conversionName = (await settings.getValue('google_ads', 'conversionActionName')) || 'Reservia - Won deal';
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00+02:00`) : new Date(Date.now() - 90 * DAY);
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59+02:00`) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new ApiError('from/to must be YYYY-MM-DD dates.', 400);
  const leads = await Lead.find({
    stage: 'won',
    archived: { $ne: true },
    $or: [{ gclid: { $ne: null } }, { gbraid: { $ne: null } }, { wbraid: { $ne: null } }, { 'lastTouch.gclid': { $ne: null } }, { 'lastTouch.gbraid': { $ne: null } }, { 'lastTouch.wbraid': { $ne: null } }],
  }).lean();
  const history = await StageHistory.find({ lead: { $in: leads.map(l => l._id) }, to: 'won' }).sort({ createdAt: 1 }).lean();
  const wonAt = {};
  for (const h of history) wonAt[String(h.lead?._id || h.lead)] = wonAt[String(h.lead?._id || h.lead)] || h.createdAt;
  const fmt = d => `${new Date(new Date(d).getTime() + 2 * 3600000).toISOString().slice(0, 19).replace('T', ' ')}+0200`;
  const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [['Parameters:TimeZone=+0200'], ['Google Click ID', 'GBRAID', 'WBRAID', 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency', 'Order ID']];
  for (const l of leads) {
    const at = wonAt[String(l._id)] || l.stageChangedAt;
    if (!at || new Date(at) < from || new Date(at) > to) continue;
    const gclid = l.lastTouch?.gclid || l.gclid || '';
    const gbraid = gclid ? '' : l.lastTouch?.gbraid || l.gbraid || '';
    const wbraid = gclid || gbraid ? '' : l.lastTouch?.wbraid || l.wbraid || '';
    rows.push([gclid, gbraid, wbraid, conversionName, fmt(at), l.valueEgp ?? '', 'EGP', l.refCode]);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="google-ads-offline-conversions.csv"');
  res.status(200).send(rows.map(r => r.map(esc).join(',')).join('\n'));
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
