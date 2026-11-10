/**
 * READ-ONLY audit for Change Request 1, Feature 6: "the client specifically wants RSV-0411-0006,
 * RSV-0411-0007, and any other test leads removed... investigate the two specified test leads and
 * identify other test records... do NOT bulk-delete based on assumptions or similar names; only
 * remove positively-verified test records."
 *
 * By default this script NEVER writes, archives, or deletes anything - it only prints what it finds so the
 * MD can personally verify each record before anyone archives it. The ONLY write path is the
 * explicit `--archive=<codes> --actor-email=<MD> --apply` mode added for Change Request 2 (see
 * archiveConfirmedTestLeads below), which archives - never deletes - confirmed codes only
 * (PATCH /crm/leads/:id/archive,
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

// Change Request 1 named RSV-0411-0006/0007; Change Request 2 adds RSV-0811-0008
// ("TEST - delete Farm Wadi", at Proposal sent).
const NAMED_REF_CODES = ['RSV-0411-0006', 'RSV-0411-0007', 'RSV-0811-0008'];
const TEST_STRING_PATTERN = /test|demo|dummy|sample|example/i;

// Change Request 2, item 13 - archiving mode. Still never automatic and never a delete:
//   npm run db:audit-crm-test-leads -- --archive=RSV-0811-0008,RSV-0411-0006 --actor-email=<MD email>          (dry run)
//   npm run db:audit-crm-test-leads -- --archive=RSV-0811-0008,RSV-0411-0006 --actor-email=<MD email> --apply
// Only the ref codes listed explicitly are touched, and each one must ALSO carry an obvious test
// marker in its name (or be one of the client-named codes above) - a mistyped code can never
// archive a real customer. The actor must hold an active CRM 'md' membership (the same rule as the
// archive button). Archiving goes through leadService#setLeadArchived, so the reason, who and when
// land in the lead's own audit trail and the lead can be restored at any time.
function argValue(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function archiveConfirmedTestLeads({ Lead, codes, actorEmail, apply }) {
  // eslint-disable-next-line global-require
  const User = require('../models/userModel');
  // eslint-disable-next-line global-require
  const { setLeadArchived } = require('../services/crm/leadService');
  const actor = await User.findOne({ email: new RegExp(`^${actorEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('_id name systemMemberships');
  const isMd = actor?.systemMemberships?.some(m => m.system === 'CRM' && m.role === 'md' && m.isActive);
  if (!isMd) throw new SafetyError(`--actor-email ${actorEmail} must be a user with an active CRM "md" membership.`);

  console.log(`\n================ Archive confirmed test leads (${apply ? 'APPLY' : 'dry run'}) ================`);
  const results = [];
  for (const code of codes) {
    // eslint-disable-next-line no-await-in-loop
    const lead = await Lead.findOne({ refCode: code });
    if (!lead) {
      console.log(`  ${code}: not found - skipped.`);
      results.push({ code, outcome: 'not_found' });
      continue;
    }
    const looksTest = TEST_STRING_PATTERN.test(lead.name || '') || NAMED_REF_CODES.includes(code);
    if (!looksTest) {
      console.log(`  ${code} ("${lead.name || '(no name)'}"): NO test marker in the name and not a client-named code - refused. Archive it from the lead page if you are sure.`);
      results.push({ code, outcome: 'refused' });
      continue;
    }
    if (lead.archived) {
      console.log(`  ${code}: already archived (${lead.archiveReason}).`);
      results.push({ code, outcome: 'already_archived' });
      continue;
    }
    const reason = `Test record - removed per Change Request ${NAMED_REF_CODES.slice(0, 2).includes(code) ? '1' : '2'} cleanup (${code}).`;
    console.log(`  ${code} ("${lead.name || '(no name)'}", stage ${lead.stage}): ${apply ? 'ARCHIVED' : 'would archive'} - reason: ${reason}`);
    // eslint-disable-next-line no-await-in-loop
    if (apply) await setLeadArchived(lead._id, true, { userId: actor._id, reason });
    results.push({ code, outcome: apply ? 'archived' : 'would_archive' });
  }
  return results;
}

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

  console.log('\n================ Section 1: the explicitly-named leads (Change Requests 1 and 2) ================');
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

  // Same day-of-month reference batch as the named leads (RSV-DDMM-xxxx) - leads created on the
  // same calendar day a known test lead was, which is weak but worth a look, never a reason to
  // act alone.
  const sameBatch = await Lead.find({ refCode: { $regex: /^RSV-(0411|0811)-/, $nin: NAMED_REF_CODES } }).lean();
  if (sameBatch.length) {
    console.log(`-- Same reference batches (RSV-0411-*, RSV-0811-*), excluding the named leads: ${sameBatch.length} found --`);
    for (const lead of sameBatch) printLead(lead, 'same reference batch as a named test lead - check if this was also created while testing');
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
  console.log('Or, for codes you have confirmed, the --archive=<codes> --actor-email=<MD> [--apply] mode of this script.');

  let archived = null;
  const archiveCodes = (argValue('archive') || '').split(',').map(s => s.trim()).filter(Boolean);
  if (archiveCodes.length) {
    const actorEmail = argValue('actor-email');
    if (!actorEmail) throw new SafetyError('--archive needs --actor-email=<the MD user archiving these leads>.');
    archived = await archiveConfirmedTestLeads({ Lead, codes: archiveCodes, actorEmail, apply: process.argv.includes('--apply') });
  }

  return { named, sameBatch, textMatches: newTextMatches, archived };
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
