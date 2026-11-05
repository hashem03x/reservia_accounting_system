'use strict';
const CrmAdSpend = require('../../models/crm/adSpendModel');

// Reservia CRM - monthly marketing spend per channel, MD-entered (controller/crm/
// adSpendController.js). Upsert, not create-only - correcting a month's entered spend is routine.
async function setAdSpend(channel, year, month, amountEgp, { segment = null, userId } = {}) {
  // channel/year/month are included in $set (not just the filter) for the same reason as
  // targetService.js#setTarget - Mongoose's update validators only check paths present in the
  // update document, never the filter. runValidators: a plain findOneAndUpdate upsert does NOT
  // run schema validation by default; without it, an invalid `segment`/out-of-range `month` would
  // be written straight past the model's own checks.
  return CrmAdSpend.findOneAndUpdate(
    { channel, year, month },
    { $set: { channel, year, month, amountEgp, segment: segment || null, setBy: userId || null } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
}

async function listAdSpend(year, month) {
  return CrmAdSpend.find({ year, month }).lean();
}

module.exports = { setAdSpend, listAdSpend };
