/**
 * READ-ONLY audit for Change Request 1, Feature 6: "the client specifically wants RSV-0411-0006,
 * RSV-0411-0007, and any other test leads removed... investigate the two specified test leads and
 * identify other test records... do NOT bulk-delete based on assumptions or similar names; only
 * remove positively-verified test records."
 *
 * This script NEVER writes, archives, or deletes anything - it only prints what it finds so the
 * MD can personally verify each record before anyone archives it (PATCH /crm/leads/:id/archive,
 * MD-only, now requires a `reason` - see leadModel.js/leadService.js#setLeadArchived). Candidates
 * beyond the two explicitly-named leads are flagged by an OBJECTIVE, stated reason (same reference
 * batch, a "test"/"demo" string in the name or phone) - they are suggestions to personally check,
 * never a list to bulk-act on.
 *
 * Usage:
 *   npm run db:audit-crm-test-leads
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

const NAMED_REF_CODES = ['RSV-0411-0006', 'RSV-0411-0007'];
const TEST_STRING_PATTERN = /test|demo|dummy|sample|example/i;

function printLead(lead, reason) {
  console.log(`\n  refCode:     ${lead.refCode}`);
  console.log(`  name:        ${lead.name || '(none)'}`);
  console.log(`  phone:       ${lead.phoneE164}`);
  console.log(`  channel:     ${lead.channel}`);
  console.log(`  source:      ${lead.source}`);
  console.log(`  segment:     ${lead.segment}`);
  console.log(`  stage:       ${lead.stage}`);
  console.log(`  createdAt:   ${lead.createdAt?.toISOString?.() ?? lead.createdAt}`);
  console.log(`  archived:    ${lead.archived}`);
  if (reason) console.log(`  flagged as:  ${reason}`);
}

async function auditCrmTestLeads({ connect = true } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    console.log('Connecting to database (read-only)...');
    await mongoose.connect(process.env.DB_URI);
  }
  const { connection } = mongoose;
  if (connect) {
    const dbName = assertSafeDatabaseName(connection);
    console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
    await assertNotLeopardDatabase(connection);
  }

  // Lead's own pre-find hook populates owner/createdBy/archivedBy, all refs to User - that model
  // must be registered on this connection first, or Mongoose throws MissingSchemaError.
  // eslint-disable-next-line global-require
  require('../models/userModel');
  // eslint-disable-next-line global-require
  const Lead = require('../models/crm/leadModel');

  console.log('\n================ Section 1: the two explicitly-named leads ================');
  const named = await Lead.find({ refCode: { $in: NAMED_REF_CODES } }).lean();
  const foundCodes = new Set(named.map(l => l.refCode));
  for (const code of NAMED_REF_CODES) {
    if (!foundCodes.has(code)) {
      console.log(`\n  ${code}: NOT FOUND in this database. Do not assume it was already removed - confirm against the environment the client is actually looking at.`);
    }
  }
  for (const lead of named) printLead(lead, null);

  console.log('\n\n================ Section 2: other candidates worth personally checking ================');
  console.log('(Objective signals only - NONE of these are archived automatically. Verify each one yourself.)\n');

  // Same day-of-month reference batch as the two named leads (RSV-DDMM-xxxx) - leads created on
  // the same calendar day a known test lead was, which is weak but worth a look, never a reason
  // to act alone.
  const sameBatch = await Lead.find({ refCode: { $regex: /^RSV-0411-/, $nin: NAMED_REF_CODES } }).lean();
  if (sameBatch.length) {
    console.log(`-- Same reference batch (RSV-0411-*), excluding the two named leads: ${sameBatch.length} found --`);
    for (const lead of sameBatch) printLead(lead, 'same RSV-0411-* batch as the two named test leads - check if this was also created while testing');
  }

  // Name or phone containing an obvious test/demo string - still just a flag, not a verdict (a
  // real customer could coincidentally have "Test" in a company name).
  const textMatches = await Lead.find({
    $or: [{ name: { $regex: TEST_STRING_PATTERN } }, { phoneE164: { $regex: TEST_STRING_PATTERN } }],
  }).lean();
  const alreadyShown = new Set([...named, ...sameBatch].map(l => String(l._id)));
  const newTextMatches = textMatches.filter(l => !alreadyShown.has(String(l._id)));
  if (newTextMatches.length) {
    console.log(`\n-- Name/phone contains "test"/"demo"/"dummy"/"sample"/"example": ${newTextMatches.length} found --`);
    for (const lead of newTextMatches) printLead(lead, 'name or phone contains an obvious test/demo string');
  }

  if (!sameBatch.length && !newTextMatches.length) {
    console.log('(none found by these signals)');
  }

  console.log('\n\n================ Next step ================');
  console.log('For every lead you personally confirm is a test record, archive it (never delete) via:');
  console.log('  PATCH /api/v1/crm/leads/:id/archive   (MD role required)');
  console.log('  body: { "reason": "<why this is a test record>" }');
  console.log('This is reversible (PATCH .../restore) and keeps the full audit trail - see leadService.js#setLeadArchived.');

  return { named, sameBatch, textMatches: newTextMatches };
}

if (require.main === module) {
  auditCrmTestLeads()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:audit-crm-test-leads failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { auditCrmTestLeads };
