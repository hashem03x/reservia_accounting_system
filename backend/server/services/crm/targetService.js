'use strict';
const CrmTarget = require('../../models/crm/targetModel');

// Reservia CRM - sales targets, one per (owner, month). MD-only to set (controller/crm/
// targetController.js); the Dashboard (services/crm/reportService.js) reads these back to compare
// against real, computed actuals. Upsert, not create-only - the MD revising a target mid-month is
// a correction, not a new target.
async function setTarget(ownerId, year, month, fields, { userId } = {}) {
  const update = { ...fields, setBy: userId || null };
  const target = await CrmTarget.findOneAndUpdate({ owner: ownerId, year, month }, { $set: update }, { new: true, upsert: true, setDefaultsOnInsert: true });
  return target;
}

/** All targets for a given year/month (every owner who has one set), or just one owner's. */
async function listTargets(year, month, { ownerId } = {}) {
  const filter = { year, month };
  if (ownerId) filter.owner = ownerId;
  return CrmTarget.find(filter).lean();
}

module.exports = { setTarget, listTargets };
