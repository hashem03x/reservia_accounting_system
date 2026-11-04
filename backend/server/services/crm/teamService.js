'use strict';
const User = require('../../models/userModel');

/** Every active CRM team member, any role - the Dashboard's owner filter and the MD's target-setting UI both read this, never a client-supplied list. */
async function listCrmTeam() {
  return User.find({
    isActive: true,
    isDeleted: { $ne: true },
    systemMemberships: { $elemMatch: { system: 'CRM', isActive: true } },
  })
    .select('_id name')
    .sort({ name: 1 })
    .lean();
}

module.exports = { listCrmTeam };
