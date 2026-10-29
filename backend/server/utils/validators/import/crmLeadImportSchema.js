const { normalizeEgyptianPhone } = require('../../crm/phone');
const { SEGMENTS, CHANNELS } = require('../../crm/constants');
const leadService = require('../../../services/crm/leadService');

// Reservia CRM - bulk lead CSV import (Developer Brief: "bulk CSV import... dedupe/merge by
// phone... Arabic/UTF-8... acceptance test: import 3 records, re-import same 3, merge without
// duplicates"). Reuses the shared CSV import engine (services/csvImport/csvImportRunner.js) every
// other importer in this codebase uses - same preview/commit contract, same size/row limits, same
// BOM/UTF-8 handling (parseCsv).
//
// Deliberately NO `dedupeKeys` (unlike customerImportSchema.js, which treats an in-file duplicate
// phone as a row ERROR): for leads, a repeated phone number - whether twice in the same file, or
// in a file re-imported later - is not an error, it is the exact "repeat enquiry" case
// services/crm/leadService.js#intakeLead already merges correctly. Rows are committed in file
// order through that SAME function `createOne` below calls, so row 2 sharing row 1's phone simply
// merges into the lead row 1 created, with zero special-casing here - and re-running the whole
// import later merges again, satisfying the brief's acceptance test by construction rather than a
// parallel "have I seen this phone before" mechanism that could drift from intakeLead's own rules.

exports.headers = ['Name', 'Phone', 'Channel', 'Segment', 'Source', 'Governorate', 'PartnerName', 'MonthlyBillEgp', 'SystemSizeKwp', 'ValueEgp'];

exports.requiredHeaders = ['Phone', 'Channel'];

exports.exampleRow = ['Ahmed Samir', '01012345678', 'phone', 'villa', 'Google ads', 'Giza', '', '1800', '', ''];

exports.validateRow = async function validateRow(row) {
  const errors = [];

  const name = (row.Name || '').trim();
  const phoneRaw = (row.Phone || '').trim();
  const channel = (row.Channel || '').trim().toLowerCase().replace(/\s+/g, '_');
  const segment = (row.Segment || '').trim().toLowerCase();
  const source = (row.Source || '').trim();
  const governorate = (row.Governorate || '').trim();
  const partnerName = (row.PartnerName || '').trim();
  const monthlyBillEgp = (row.MonthlyBillEgp || '').trim();
  const systemSizeKwp = (row.SystemSizeKwp || '').trim();
  const valueEgp = (row.ValueEgp || '').trim();

  let phoneE164 = null;
  if (!phoneRaw) {
    errors.push({ column: 'Phone', value: row.Phone, message: 'Phone is required.' });
  } else {
    phoneE164 = normalizeEgyptianPhone(phoneRaw);
    if (!phoneE164) errors.push({ column: 'Phone', value: row.Phone, message: 'Not a valid Egyptian phone number.' });
  }

  if (!channel) {
    errors.push({ column: 'Channel', value: row.Channel, message: 'Channel is required.' });
  } else if (!CHANNELS.includes(channel)) {
    errors.push({ column: 'Channel', value: row.Channel, message: `Must be one of: ${CHANNELS.join(', ')}.` });
  }

  if (segment && !SEGMENTS.includes(segment)) {
    errors.push({ column: 'Segment', value: row.Segment, message: `Must be one of: ${SEGMENTS.join(', ')}.` });
  }
  for (const [column, value] of [['MonthlyBillEgp', monthlyBillEgp], ['SystemSizeKwp', systemSizeKwp], ['ValueEgp', valueEgp]]) {
    if (value && (Number.isNaN(Number(value)) || Number(value) < 0)) {
      errors.push({ column, value, message: 'Must be a non-negative number.' });
    }
  }

  if (errors.length > 0) return { errors, value: null };

  return {
    errors,
    value: {
      name: name || undefined,
      phone: phoneE164,
      channel,
      segment: segment || undefined,
      source: source || undefined,
      governorate: governorate || undefined,
      partnerName: partnerName || undefined,
      monthlyBillEgp: monthlyBillEgp ? Number(monthlyBillEgp) : undefined,
      systemSizeKwp: systemSizeKwp ? Number(systemSizeKwp) : undefined,
      valueEgp: valueEgp ? Number(valueEgp) : undefined,
    },
  };
};

/** Delegates to the SAME dedupe/merge path every other lead-intake channel uses. */
exports.createOne = async function createOne(value, context) {
  const { lead } = await leadService.intakeLead(value, { userId: context?.userId });
  return lead;
};

exports.fieldSpecs = [
  { column: 'Name', required: 'no', description: 'Lead/contact name.', format: 'Text', example: 'Ahmed Samir' },
  { column: 'Phone', required: 'yes', description: 'Phone number - leads are deduplicated/merged by this number.', format: 'Egyptian mobile (01XXXXXXXXX) or with +20/20/00 prefix', example: '01012345678' },
  { column: 'Channel', required: 'yes', description: 'How the enquiry reached us.', format: `One of: ${CHANNELS.join(', ')}`, example: 'phone' },
  { column: 'Segment', required: 'no', description: 'Customer segment.', format: `One of: ${SEGMENTS.join(', ')}`, example: 'villa' },
  { column: 'Source', required: 'no', description: 'Marketing source label.', format: 'Text', example: 'Google ads' },
  { column: 'Governorate', required: 'no', description: 'Governorate.', format: 'Text', example: 'Giza' },
  { column: 'PartnerName', required: 'no', description: 'Dealer/partner name, if the channel is a dealer.', format: 'Text', example: 'Delta Solar Partners' },
  { column: 'MonthlyBillEgp', required: 'no', description: 'Reported monthly electricity bill.', format: 'Number (EGP)', example: '1800' },
  { column: 'SystemSizeKwp', required: 'no', description: 'Estimated system size.', format: 'Number (kWp)', example: '5' },
  { column: 'ValueEgp', required: 'no', description: 'Estimated deal value.', format: 'Number (EGP)', example: '150000' },
];
