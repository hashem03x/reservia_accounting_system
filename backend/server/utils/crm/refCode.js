// Reservia reference code generator (`RSV-DDMM-NNNN`) - carries the lead's creation date and a
// globally atomic sequence number, exactly the shape the supplied reference sample uses
// (`RSV-${day}${month}-${seq}`). Mirrors services/shared/orderNumberService.js's atomic
// Counter.findOneAndUpdate($inc) pattern (the established, concurrency-safe convention in this
// codebase for issuing sequential codes) rather than a `countDocuments()+1` race.
//
// The ref code is generated once at lead creation and never changes - it is what carries ad/source
// attribution (Amplitude's `crm_lead_created` event, the WhatsApp reply, the printed quotation)
// through the lead's whole lifecycle, per the brief's "Ref code carries the ad source" acceptance
// test.

const Counter = require('../../models/config/counterModel');

const SEQUENCE_NAME = 'crmLeadRefCode';
const SEQUENCE_MAX = 999999999;

async function nextRefSequence(session) {
  let updated = await Counter.findOneAndUpdate({ _id: SEQUENCE_NAME }, { $inc: { seq: 1 } }, { new: true, session });
  if (!updated) {
    try {
      await Counter.create([{ _id: SEQUENCE_NAME, seq: 1, min: 1, max: SEQUENCE_MAX }], { session });
      return 1;
    } catch (err) {
      if (err.code !== 11000) throw err; // lost the seed race to a concurrent first-ever caller - fine
      updated = await Counter.findOneAndUpdate({ _id: SEQUENCE_NAME }, { $inc: { seq: 1 } }, { new: true, session });
    }
  }
  return updated.seq;
}

/** Cairo-local day/month for the code's date component - matches every other CRM date boundary. */
function cairoDayMonth(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit' }).formatToParts(date).map(p => [p.type, p.value])
  );
  return { day: parts.day, month: parts.month };
}

/** @returns {Promise<string>} e.g. "RSV-0511-0003" */
async function generateRefCode(date = new Date(), session) {
  const { day, month } = cairoDayMonth(date);
  const seq = await nextRefSequence(session);
  return `RSV-${day}${month}-${String(seq).padStart(4, '0')}`;
}

module.exports = { generateRefCode };
