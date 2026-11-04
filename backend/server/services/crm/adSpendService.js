'use strict';
const CrmAdSpend = require('../../models/crm/adSpendModel');

// Reservia CRM - monthly marketing spend per source, MD-entered (controller/crm/
// adSpendController.js). Upsert, not create-only - correcting a month's entered spend is routine.
async function setAdSpend(source, year, month, amountEgp, { userId } = {}) {
  return CrmAdSpend.findOneAndUpdate(
    { source, year, month },
    { $set: { amountEgp, setBy: userId || null } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

async function listAdSpend(year, month) {
  return CrmAdSpend.find({ year, month }).lean();
}

module.exports = { setAdSpend, listAdSpend };
