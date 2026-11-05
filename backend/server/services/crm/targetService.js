'use strict';
const CrmTarget = require('../../models/crm/targetModel');

// Reservia CRM - sales targets, one per (segment, month). MD-only to set (controller/crm/
// targetController.js); the Dashboard/Performance (services/crm/reportService.js,
// performanceReportService.js) read these back to compare against real, computed actuals.
// Upsert, not create-only - the MD revising a target mid-month is a correction, not a new target.
async function setTarget(segment, year, month, fields, { userId } = {}) {
  // `segment` is included in $set (not just the filter) so Mongoose's update validators - which
  // only check paths actually present in the update document, never the filter - actually see and
  // enforce the enum on it. runValidators: a plain findOneAndUpdate upsert does NOT run schema
  // validation by default (Mongoose only validates on save()/create()); without it, an invalid
  // `segment` would be written straight past the enum check, relying entirely on the route's own
  // express-validator chain to have caught it first. Defense in depth: the service itself must
  // also refuse it.
  const update = { ...fields, segment, year, month, setBy: userId || null };
  const target = await CrmTarget.findOneAndUpdate(
    { segment, year, month },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
  return target;
}

/** All targets for a given year/month (every segment that has one set), or just one segment's. */
async function listTargets(year, month, { segment } = {}) {
  const filter = { year, month };
  if (segment) filter.segment = segment;
  return CrmTarget.find(filter).lean();
}

module.exports = { setTarget, listTargets };
