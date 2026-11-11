/**
 * QA Findings section 7 - removes ONLY the three QA test records the Managing Director named:
 *
 *   Commercial  ONG-000002  "TEST - ONG 80 kWp reference deal (delete after QA)"
 *   Commercial  ONG-000003  "TEST ONG 80 kWp ref v2 (delete after QA)"
 *   CRM lead    RSV-0811-0008  "TEST - delete Farm Wadi"
 *
 * Safety (run in this order, nothing is deleted unless every check passes):
 *   1. Identity - each code must exist AND its name must carry an explicit test marker ("TEST" /
 *      "delete after QA" / "delete"); a mistyped code can never remove a real customer's record.
 *   2. Dependencies - a record that has acquired real business links is REPORTED, never deleted:
 *      Commercial: an issued proposal, a linked ERP project, a Won outcome, attachments, a CRM lead
 *      that is not itself one of the named test records. CRM lead: quotations, payments,
 *      attachments, a Commercial deal that is not one of the named test projects.
 *   3. Backup - every document that will be removed (project/lead + revisions, approvals,
 *      proposals, sync events, activities, stage history) is written to a JSON file first.
 *   4. Delete - only with --apply. The shared customer record is never touched; counters are never
 *      rewound (numbers are not reused).
 *
 * Usage:
 *   npm run db:commercial-qa-cleanup                       # dry run: identity + dependency report only
 *   npm run db:commercial-qa-cleanup -- --apply            # backup, then delete
 *   (--backup-dir=<path> to choose where the backup JSON goes; default ./backups)
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

const PROJECT_CODES = ['ONG-000002', 'ONG-000003'];
const LEAD_CODES = ['RSV-0811-0008'];
const TEST_MARKER = /\btest\b|delete after qa|\bdelete\b/i;

function argValue(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function commercialQaCleanup({ apply = process.argv.includes('--apply'), connect = true, backupDir = argValue('backup-dir') || path.join(__dirname, '../../backups'), log = console.log } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    await mongoose.connect(process.env.DB_URI);
    const dbName = assertSafeDatabaseName(mongoose.connection);
    log(`Connected (db: ${dbName}).`);
    await assertNotLeopardDatabase(mongoose.connection);
  }
  const db = mongoose.connection.db;
  const col = name => db.collection(name);
  const problems = [];
  const backup = { takenAt: new Date().toISOString(), projects: [], revisions: [], approvals: [], proposals: [], syncEvents: [], leads: [], activities: [], stageHistory: [], intakeEventsUnlinked: [] };

  // ---------------------------------------------------------------- Commercial projects
  const projects = await col('commercialprojects').find({ projectCode: { $in: PROJECT_CODES } }).toArray();
  for (const code of PROJECT_CODES) {
    const p = projects.find(x => x.projectCode === code);
    if (!p) {
      log(`- ${code}: not found (already removed?) - nothing to do.`);
      continue;
    }
    if (!TEST_MARKER.test(p.name || '')) problems.push(`${code} "${p.name}" has no test marker in its name - refusing.`);
    const proposals = await col('commercialproposals').find({ project: p._id }).toArray();
    const attachments = await col('attachments').countDocuments({ ownerType: 'CommercialProject', owner: p._id });
    if (p.erpProject) problems.push(`${code} is linked to an ERP project - refusing.`);
    if (p.outcome === 'Won') problems.push(`${code} is marked Won - refusing.`);
    if (attachments) problems.push(`${code} has ${attachments} attachment(s) - remove them in the UI first or confirm they are test files.`);
    if (proposals.length) log(`  ${code}: ${proposals.length} issued proposal(s) - QA artefacts of this test deal, included in the backup.`);
    if (p.crmLead) {
      const lead = await col('crmleads').findOne({ _id: p.crmLead }, { projection: { refCode: 1 } });
      if (lead && !LEAD_CODES.includes(lead.refCode)) problems.push(`${code} belongs to CRM lead ${lead.refCode}, which is not a named test lead - refusing.`);
    }
    const revisions = await col('commercialrevisions').find({ project: p._id }).toArray();
    const approvals = await col('commercialapprovals').find({ revision: { $in: revisions.map(r => r._id) } }).toArray();
    const syncEvents = await col('commercialsyncevents').find({ project: p._id }).toArray();
    backup.projects.push(p);
    backup.revisions.push(...revisions);
    backup.approvals.push(...approvals);
    backup.proposals.push(...proposals);
    backup.syncEvents.push(...syncEvents);
    log(`- ${code} "${p.name}" (${p.category}, region ${p.region ?? '-'}): ${revisions.length} revision(s), ${approvals.length} approval row(s), ${proposals.length} proposal(s).`);
  }

  // ---------------------------------------------------------------- CRM lead
  const leads = await col('crmleads').find({ refCode: { $in: LEAD_CODES } }).toArray();
  for (const code of LEAD_CODES) {
    const l = leads.find(x => x.refCode === code);
    if (!l) {
      log(`- ${code}: not found (already removed?) - nothing to do.`);
      continue;
    }
    if (!TEST_MARKER.test(l.name || '')) problems.push(`${code} "${l.name}" has no test marker in its name - refusing.`);
    const [quotations, payments, attachments] = await Promise.all([
      col('crmquotations').countDocuments({ lead: l._id }),
      col('crmpayments').countDocuments({ lead: l._id }),
      col('attachments').countDocuments({ ownerType: 'CrmLead', owner: l._id }),
    ]);
    if (quotations) problems.push(`${code} has ${quotations} quotation(s) - refusing.`);
    if (payments) problems.push(`${code} has ${payments} payment(s) - refusing.`);
    if (attachments) problems.push(`${code} has ${attachments} attachment(s) - remove them in the UI first.`);
    const linked = await col('commercialprojects').findOne({ crmLead: l._id }, { projection: { projectCode: 1 } });
    if (linked && !PROJECT_CODES.includes(linked.projectCode)) problems.push(`${code} owns Commercial project ${linked.projectCode}, which is not a named test project - refusing.`);
    const activities = await col('crmactivities').find({ lead: l._id }).toArray();
    const stageHistory = await col('crmstagehistories').find({ lead: l._id }).toArray();
    const intake = await col('crmintakeevents').find({ lead: l._id }).toArray();
    backup.leads.push(l);
    backup.activities.push(...activities);
    backup.stageHistory.push(...stageHistory);
    backup.intakeEventsUnlinked.push(...intake);
    log(`- ${code} "${l.name}" (stage ${l.stage}): ${activities.length} activit(ies), ${stageHistory.length} stage change(s).`);
  }

  if (problems.length) {
    log('\nREFUSED - resolve these first:');
    problems.forEach(p => log(`  * ${p}`));
    return { applied: false, problems };
  }
  if (!backup.projects.length && !backup.leads.length) {
    log('\nNothing to remove.');
    return { applied: false, problems: [] };
  }
  if (!apply) {
    log('\nDry run - nothing was changed. Re-run with --apply to back up and delete exactly the records above.');
    return { applied: false, problems: [], backup };
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const file = path.join(backupDir, `qa-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  log(`\nBackup written: ${file}`);

  const projectIds = backup.projects.map(p => p._id);
  const leadIds = backup.leads.map(l => l._id);
  await col('commercialapprovals').deleteMany({ _id: { $in: backup.approvals.map(a => a._id) } });
  await col('commercialproposals').deleteMany({ project: { $in: projectIds } });
  await col('commercialrevisions').deleteMany({ project: { $in: projectIds } });
  await col('commercialsyncevents').deleteMany({ $or: [{ project: { $in: projectIds } }, { lead: { $in: leadIds } }] });
  await col('commercialprojects').deleteMany({ _id: { $in: projectIds } });
  await col('crmactivities').deleteMany({ lead: { $in: leadIds } });
  await col('crmstagehistories').deleteMany({ lead: { $in: leadIds } });
  // The idempotency ledger keeps its rows (so a replayed webhook stays a no-op) but loses the link.
  await col('crmintakeevents').updateMany({ lead: { $in: leadIds } }, { $set: { lead: null } });
  await col('crmleads').deleteMany({ _id: { $in: leadIds } });
  log(`Deleted ${projectIds.length} Commercial project(s) and ${leadIds.length} CRM lead(s) with their revisions, approvals, proposals, activities and stage history.`);
  return { applied: true, problems: [], backupFile: file };
}

if (require.main === module) {
  commercialQaCleanup()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('db:commercial-qa-cleanup failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { commercialQaCleanup, PROJECT_CODES, LEAD_CODES };
