const { normalizeEgyptianPhone } = require('../../crm/phone');
const { SEGMENTS, CHANNELS, SOURCES, GOVERNORATE_NAMES_EN } = require('../../crm/constants');
const { parseSubmissionTimestamp } = require('../../crm/businessDate');
const { processIntake, contentDigestId } = require('../../../services/crm/leadIntakeService');

// Reservia CRM - bulk lead CSV import (Developer Brief: "bulk CSV import... dedupe/merge by
// phone... Arabic/UTF-8... acceptance test: import 3 records, re-import same 3, merge without
// duplicates"). Reuses the shared CSV import engine (services/csvImport/csvImportRunner.js) every
// other importer in this codebase uses - same preview/commit contract, same size/row limits, same
// BOM/UTF-8 handling (parseCsv).
//
// Change Request 2, items 10-12: this import is the stopgap door for TikTok, Google Ads and any
// channel without a live integration - Cangrow sends a CSV every working morning. It now accepts
// Email, Campaign and the ORIGINAL submission timestamp, and every row goes through the unified
// intake (services/crm/leadIntakeService.js) - the same phone normalization, duplicate matching,
// owner assignment, notification and SLA rules as a live webhook. The first-reply clock starts at
// SubmittedAt, never at the moment of import.
//
// Deliberately NO `dedupeKeys`: a repeated phone - twice in a file, or in a later file - is the
// "repeat enquiry" case intakeLead merges. What IS prevented is importing the SAME submission
// twice: a row with an ExternalId, or with a SubmittedAt timestamp, has a stable identity
// (channel/source + phone + time, or the platform's own id); re-importing that row is reported as
// "already imported" and changes nothing. A row with neither keeps the original merge behaviour.

exports.headers = [
  'Name',
  'Phone',
  'Email',
  'Channel',
  'Segment',
  'Source',
  'Campaign',
  'SubmittedAt',
  'ExternalId',
  'Governorate',
  'PartnerName',
  'MonthlyBillEgp',
  'SystemSizeKwp',
  'ValueEgp',
];

// Channel is no longer mandatory as a COLUMN: an ad-platform Source implies it (ad_lead_form).
exports.requiredHeaders = ['Phone'];

exports.exampleRow = ['Ahmed Samir', '01012345678', 'ahmed@example.com', '', 'villa', 'Meta Ads', 'Villas November', '2026-11-09 10:00', '', 'Giza', '', '1800', '', ''];

// Sources whose leads arrive through the platform's own lead form - Channel defaults accordingly.
const SOURCE_DEFAULT_CHANNEL = { 'Meta Ads': 'ad_lead_form', TikTok: 'ad_lead_form', 'Google Ads': 'ad_lead_form', 'WhatsApp Direct': 'whatsapp' };
// Channels nobody types in by hand - their leads follow the automatic assignment rules instead of
// becoming the importer's own leads.
const AUTOMATED_CHANNELS = ['ad_lead_form', 'web_form', 'landing_page', 'whatsapp'];

// How far back an original timestamp may reasonably be (a typo like 2025 instead of 2026 would
// otherwise silently start every SLA a year ago).
const MAX_SUBMISSION_AGE_DAYS = 120;
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reads a column tolerantly: exact header first, then case/space/underscore-insensitive (Cangrow's
 * sheet may say "submitted at" or "Submitted_At"), then any listed alias.
 */
function cell(row, column, aliases = []) {
  if (row[column] !== undefined) return String(row[column] ?? '').trim();
  const norm = s => String(s).toLowerCase().replace(/[\s_-]+/g, '');
  const wanted = [column, ...aliases].map(norm);
  const key = Object.keys(row).find(k => wanted.includes(norm(k)));
  return key === undefined ? '' : String(row[key] ?? '').trim();
}

exports.validateRow = async function validateRow(row, context = {}) {
  const errors = [];
  const now = context.now || new Date();

  const name = cell(row, 'Name', ['Full Name']);
  const phoneRaw = cell(row, 'Phone', ['Phone Number', 'Mobile']);
  const email = cell(row, 'Email', ['Email Address']).toLowerCase();
  const channelRaw = cell(row, 'Channel').toLowerCase().replace(/\s+/g, '_');
  const segment = cell(row, 'Segment').toLowerCase();
  const sourceRaw = cell(row, 'Source');
  const campaign = cell(row, 'Campaign', ['Campaign Name', 'utm_campaign']);
  const submittedRaw = cell(row, 'SubmittedAt', ['Submitted At', 'Original Timestamp', 'Lead Created At', 'Created Time', 'Timestamp']);
  const externalId = cell(row, 'ExternalId', ['External Id', 'Lead Id', 'Lead ID']);
  const governorate = cell(row, 'Governorate');
  const partnerName = cell(row, 'PartnerName');
  const monthlyBillEgp = cell(row, 'MonthlyBillEgp');
  const systemSizeKwp = cell(row, 'SystemSizeKwp');
  const valueEgp = cell(row, 'ValueEgp');

  let phoneE164 = null;
  if (!phoneRaw) {
    errors.push({ column: 'Phone', value: row.Phone, message: 'Phone is required.' });
  } else {
    phoneE164 = normalizeEgyptianPhone(phoneRaw);
    if (!phoneE164) errors.push({ column: 'Phone', value: phoneRaw, message: 'Not a valid Egyptian phone number (e.g. 01012345678 or +201012345678).' });
  }

  if (email && (!EMAIL_PATTERN.test(email) || email.length > 200)) {
    errors.push({ column: 'Email', value: email, message: 'Not a valid email address.' });
  }

  // Acceptance report finding 4: fixed lists, never free text - matched case-insensitively and
  // stored in the canonical spelling, since a hand-made CSV won't reliably match the exact casing.
  const source = sourceRaw ? SOURCES.find(s => s.toLowerCase() === sourceRaw.toLowerCase()) : undefined;
  if (sourceRaw && !source) {
    errors.push({ column: 'Source', value: sourceRaw, message: `Must be one of: ${SOURCES.join(', ')}.` });
  }

  const channel = channelRaw || (source && SOURCE_DEFAULT_CHANNEL[source]) || '';
  if (!channel) {
    errors.push({ column: 'Channel', value: row.Channel, message: `Channel is required unless Source is ${Object.keys(SOURCE_DEFAULT_CHANNEL).join(', ')}. One of: ${CHANNELS.join(', ')}.` });
  } else if (!CHANNELS.includes(channel)) {
    errors.push({ column: 'Channel', value: row.Channel, message: `Must be one of: ${CHANNELS.join(', ')}.` });
  }

  if (segment && !SEGMENTS.includes(segment)) {
    errors.push({ column: 'Segment', value: row.Segment, message: `Must be one of: ${SEGMENTS.join(', ')}.` });
  }
  if (governorate && !GOVERNORATE_NAMES_EN.some(g => g.toLowerCase() === governorate.toLowerCase())) {
    errors.push({ column: 'Governorate', value: governorate, message: `Must be one of: ${GOVERNORATE_NAMES_EN.join(', ')}.` });
  }
  if (campaign.length > 200) errors.push({ column: 'Campaign', value: campaign.slice(0, 40), message: 'At most 200 characters.' });
  if (externalId.length > 150) errors.push({ column: 'ExternalId', value: externalId.slice(0, 40), message: 'At most 150 characters.' });

  // Change Request 2, item 12: the ORIGINAL submission time - the SLA clock starts here.
  let submittedAt = null;
  if (submittedRaw) {
    submittedAt = parseSubmissionTimestamp(submittedRaw);
    if (!submittedAt) {
      errors.push({
        column: 'SubmittedAt',
        value: submittedRaw,
        message: 'Unrecognized date/time. Use "YYYY-MM-DD HH:mm" (Cairo time), e.g. 2026-11-09 10:00, or ISO 8601 with a timezone, e.g. 2026-11-09T10:00:00+02:00. Day/month formats like 09/11/2026 are not accepted because they are ambiguous.',
      });
    } else if (submittedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
      errors.push({ column: 'SubmittedAt', value: submittedRaw, message: 'This time is in the future - check the date and the timezone.' });
      submittedAt = null;
    } else if (now.getTime() - submittedAt.getTime() > MAX_SUBMISSION_AGE_DAYS * 86400000) {
      errors.push({ column: 'SubmittedAt', value: submittedRaw, message: `More than ${MAX_SUBMISSION_AGE_DAYS} days ago - check the year.` });
      submittedAt = null;
    }
  }

  for (const [column, value] of [['MonthlyBillEgp', monthlyBillEgp], ['SystemSizeKwp', systemSizeKwp], ['ValueEgp', valueEgp]]) {
    if (value && (Number.isNaN(Number(value)) || Number(value) < 0)) {
      errors.push({ column, value, message: 'Must be a non-negative number.' });
    }
  }

  if (errors.length > 0) return { errors, value: null };

  const canonicalGovernorate = governorate ? GOVERNORATE_NAMES_EN.find(g => g.toLowerCase() === governorate.toLowerCase()) : undefined;

  return {
    errors,
    value: {
      name: name || undefined,
      phone: phoneE164,
      email: email || undefined,
      channel,
      segment: segment || undefined,
      source: source || undefined,
      campaign: campaign || undefined,
      submittedAt: submittedAt || undefined,
      externalLeadId: externalId || undefined,
      governorate: canonicalGovernorate,
      partnerName: partnerName || undefined,
      monthlyBillEgp: monthlyBillEgp ? Number(monthlyBillEgp) : undefined,
      systemSizeKwp: systemSizeKwp ? Number(systemSizeKwp) : undefined,
      valueEgp: valueEgp ? Number(valueEgp) : undefined,
    },
  };
};

/** The stable identity of a row's submission, or null when the row has none (see header). */
function rowExternalId(value) {
  if (value.externalLeadId) return `ext:${(value.source || value.channel).toLowerCase()}:${value.externalLeadId}`;
  if (value.submittedAt) return `row:${contentDigestId([value.phone, value.source || value.channel, value.campaign, value.submittedAt.toISOString()])}`;
  return null;
}

/**
 * Delegates to the unified intake - the SAME dedupe/merge, assignment and SLA path every other
 * lead-intake channel uses. Leads from automated channels (ad lead forms, website, WhatsApp) are
 * assigned by the CRM's rules and their owner notified, exactly as if the integration had
 * delivered them; a hand-entered channel (phone, walk-in, ...) keeps the importer as owner.
 */
exports.createOne = async function createOne(value, context) {
  const externalId = rowExternalId(value);
  const result = await processIntake({
    channel: 'csv',
    externalId,
    lead: value,
    options: { userId: context?.userId || null, autoAssign: AUTOMATED_CHANNELS.includes(value.channel) },
  });
  if (result.replay) {
    const err = new Error('Already imported - this exact submission is in the CRM, nothing was changed.');
    err.operational = true;
    err.alreadyImported = true;
    throw err;
  }
  return { _id: result.leadId };
};

exports.rowExternalId = rowExternalId;

exports.fieldSpecs = [
  { column: 'Name', required: 'no', description: 'Lead/contact name.', format: 'Text', example: 'Ahmed Samir' },
  { column: 'Phone', required: 'yes', description: 'Phone number - leads are deduplicated/merged by this number (stored as +20...).', format: 'Egyptian mobile (01XXXXXXXXX) or with +20/20/00 prefix', example: '01012345678' },
  { column: 'Email', required: 'no', description: 'Contact email.', format: 'name@domain', example: 'ahmed@example.com' },
  {
    column: 'Channel',
    required: 'conditional',
    description: 'How the enquiry reached us. May be left empty when Source is Meta Ads, TikTok or Google Ads (ad lead form) or WhatsApp Direct.',
    format: `One of: ${CHANNELS.join(', ')}`,
    example: 'ad_lead_form',
  },
  { column: 'Segment', required: 'no', description: 'Customer segment.', format: `One of: ${SEGMENTS.join(', ')}`, example: 'villa' },
  { column: 'Source', required: 'no', description: 'Marketing source.', format: `One of: ${SOURCES.join(', ')} (letter case ignored)`, example: 'Meta Ads' },
  { column: 'Campaign', required: 'no', description: 'Campaign name, shown on the lead and used in campaign reporting.', format: 'Text, max 200', maxLength: 200, example: 'Villas November' },
  {
    column: 'SubmittedAt',
    required: 'no',
    description: 'When the customer ORIGINALLY submitted the lead. The 8-working-hour first-reply clock starts here, not at import time. Rows with a SubmittedAt (or an ExternalId) are never imported twice.',
    format: 'YYYY-MM-DD HH:mm in Cairo time, or ISO 8601 with timezone (2026-11-09T10:00:00+02:00). Not in the future, not older than 120 days.',
    example: '2026-11-09 10:00',
  },
  { column: 'ExternalId', required: 'no', description: "The ad platform's own lead id, if the export has one - makes re-imports safe.", format: 'Text, max 150', maxLength: 150, example: '1234567890' },
  { column: 'Governorate', required: 'no', description: 'Governorate (case-insensitive).', format: `One of: ${GOVERNORATE_NAMES_EN.join(', ')}`, example: 'Giza' },
  { column: 'PartnerName', required: 'no', description: 'Dealer/partner name, if the channel is a dealer.', format: 'Text', example: 'Delta Solar Partners' },
  { column: 'MonthlyBillEgp', required: 'no', description: 'Reported monthly electricity bill.', format: 'Number (EGP)', example: '1800' },
  { column: 'SystemSizeKwp', required: 'no', description: 'Estimated system size.', format: 'Number (kWp)', example: '5' },
  { column: 'ValueEgp', required: 'no', description: 'Estimated deal value.', format: 'Number (EGP)', example: '150000' },
];
