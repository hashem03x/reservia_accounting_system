'use strict';

const { verifyKey } = require('./integrationKeyService');
const { processIntake, recordIgnoredEvent, formatExtraAnswers } = require('./leadIntakeService');
const { parseSubmissionTimestamp } = require('../../utils/crm/businessDate');

// Reservia CRM - Google Ads lead form webhook (Change Request 2, item 11).
//
// Google Ads POSTs each lead-form submission as JSON to the webhook URL configured on the lead
// form asset, and authenticates it by echoing back the "key" string configured alongside that URL
// in the `google_key` body field (Google's own scheme - there is no signature header). We issue
// that key exactly like any other channel key (POST /crm/integrations/keys, channel google_ads)
// and verify it with the same hashed, constant-time check - the plaintext is never stored here.
//
// The payload carries campaign/ad group/creative IDS, not names - those are stored as-is (the
// campaign id becomes the lead's campaign until a name is known). Calls from ads are NOT handled
// here: there is no call-tracking number, so ad calls stay manually entered (Change Request 2).

const COLUMN = {
  FULL_NAME: 'name',
  FIRST_NAME: 'firstName',
  LAST_NAME: 'lastName',
  PHONE_NUMBER: 'phone',
  EMAIL: 'email',
};

function mapColumns(userColumnData) {
  const typed = {};
  const extra = {};
  for (const col of Array.isArray(userColumnData) ? userColumnData : []) {
    const value = col?.string_value;
    if (value === undefined || value === null || value === '') continue;
    const key = COLUMN[col.column_id];
    if (key) typed[key] = String(value);
    else extra[col.column_name || col.column_id || 'Answer'] = value;
  }
  if (!typed.name && (typed.firstName || typed.lastName)) typed.name = [typed.firstName, typed.lastName].filter(Boolean).join(' ');
  return { ...typed, extra };
}

/** Google Ads webhook body -> unified intake arguments. */
function toIntake(body) {
  const { name, phone, email, extra } = mapColumns(body.user_column_data);
  const externalId = String(body.lead_id || '');
  const campaign = body.campaign_name || (body.campaign_id ? `Google Ads campaign ${body.campaign_id}` : undefined);
  const noteLines = ['Google Ads lead form submission.'];
  if (body.adgroup_id) noteLines.push(`Ad group id: ${body.adgroup_id}`);
  if (body.creative_id) noteLines.push(`Creative id: ${body.creative_id}`);
  if (body.gcl_id) noteLines.push(`GCLID: ${body.gcl_id}`);
  const extraText = formatExtraAnswers(extra);
  if (extraText) noteLines.push(extraText);
  return {
    externalId,
    lead: {
      name: name || undefined,
      phone,
      email: email || undefined,
      channel: 'ad_lead_form',
      source: 'Google Ads',
      campaign,
      adFormId: body.form_id ? String(body.form_id) : undefined,
      adPlatform: 'google_ads',
      externalLeadId: externalId || undefined,
      submittedAt: parseSubmissionTimestamp(body.lead_submit_time) || undefined,
    },
    note: noteLines.join('\n'),
  };
}

/**
 * @returns {Promise<{status: number, body: object}>} what to answer Google with. Google only needs
 *   a 200 for success; anything else is retried.
 */
async function handleWebhook(body) {
  const keyRecord = await verifyKey(body?.google_key, 'google_ads');
  if (!keyRecord) return { status: 401, body: { success: false, message: 'Invalid google_key.' } };

  const args = toIntake(body || {});
  if (!args.externalId) return { status: 400, body: { success: false, message: 'lead_id is required.' } };

  // "Send test data" in Google Ads posts is_test: true. Those are acknowledged and recorded on the
  // Integrations screen, but kept OUT of the real pipeline unless explicitly allowed, so testing
  // the connection never puts fake customers in front of the sales team.
  if (body.is_test && process.env.CRM_GOOGLE_ADS_ACCEPT_TEST_LEADS !== 'true') {
    await recordIgnoredEvent('google_ads', args.externalId, 'Google Ads test submission (is_test) - not added to the pipeline');
    return { status: 200, body: { success: true, test: true } };
  }
  if (!args.lead.phone) {
    await recordIgnoredEvent('google_ads', args.externalId, 'No phone number in the lead form');
    return { status: 200, body: { success: true, skipped: 'no phone number' } };
  }
  if (body.is_test) args.lead.name = `TEST - ${args.lead.name || 'Google Ads test lead'}`;

  const result = await processIntake({ channel: 'google_ads', ...args });
  return { status: 200, body: { success: true, created: result.created, replay: result.replay } };
}

module.exports = { mapColumns, toIntake, handleWebhook };
