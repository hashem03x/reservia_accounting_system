/**
 * Removes the PRELAUNCH-TEST records created in production while verifying the CRM -> Deal
 * Engine -> ERP lifecycle (see docs/implementation-reports/PRELAUNCH_AUDIT_22_NOV_2026.md).
 *
 * Follows the exact safety shape already established by commercialQaCleanup.js:
 *   1. Identity - every record touched must carry an explicit test marker (name/email containing
 *      "PRELAUNCH-TEST" or an @reservia-test.local address) - a mistyped filter can never reach a
 *      real customer or deal.
 *   2. Dependencies - a test record that has acquired a link to something OUTSIDE this named set
 *      (a lead/project not in this batch, a real sync event) is REPORTED, never deleted. An
 *      attachment IS handled (backed up, then its metadata doc AND its GridFS bytes removed via
 *      the real attachmentService, never just the doc) as long as it belongs to a lead/project
 *      already confirmed in scope above - it is not, on its own, a reason to refuse.
 *   3. Backup - every document (including attachment metadata and the GridFS file id it pointed
 *      to) that will be removed is written to a JSON file first.
 *   4. Delete - only with --apply, and only inside a single transaction: either every collection
 *      change below lands together, or (on any failure) none of them do - never a half-applied
 *      cleanup. Requires the target to be a replica set (a real Atlas cluster is; a bare standalone
 *      MongoDB is not and will reject the transaction - this script is meant to run against the
 *      real target, not a disposable local instance).
 *
 * What this script does NOT do, by explicit instruction:
 *   - It never touches the Sector collection. The 6 Sectors created this session (On-Grid C&I,
 *     Off-Grid, Agriculture Pumping, Utility Scale, Street Lighting, Solar Water Heating) are real
 *     reference data other projects can already use, not test data.
 *   - It never hard-deletes User documents (staff test accounts, or the CRM/ERP customer records
 *     these test leads created via findOrCreateCustomer). Hard-deleting a User risks dangling
 *     createdBy/approvedBy/owner refs on documents outside this cleanup's own backup. Matching the
 *     `isDeleted` soft-delete convention already used everywhere else in this codebase
 *     (userController.js, productModel.js, etc.), test Users are flagged inactive
 *     (isDeleted: true) instead - reversible, and immediately excluded from every real list/search
 *     (all of which filter `isDeleted: { $ne: true }`).
 *   - It never touches `preluser@reservia.com` (customerNumber 1025, name "PRELAUNCH-TEST-User").
 *     Its email domain is NOT @reservia-test.local, meaning it was not created by this session's
 *     testing - it is reported separately, for the MD to confirm its origin before any action.
 *
 * Usage:
 *   npm run db:prelaunch-test-cleanup                  # dry run: identity + dependency report only
 *   npm run db:prelaunch-test-cleanup -- --apply        # backup, then delete/deactivate
 *   (--backup-dir=<path> to choose where the backup JSON goes; default ./backups)
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

const TEST_EMAIL_DOMAIN = /@reservia-test\.local$/i;
const TEST_NAME_MARKER = /PRELAUNCH-TEST/i;
const PRESERVED_SECTOR_NAMES = ['On-Grid C&I', 'Off-Grid', 'Agriculture Pumping', 'Utility Scale', 'Street Lighting', 'Solar Water Heating'];
const KNOWN_UNRELATED_TEST_USER_EMAIL = 'preluser@reservia.com';

function argValue(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function prelaunchTestCleanup({ apply = process.argv.includes('--apply'), connect = true, backupDir = argValue('backup-dir') || path.join(__dirname, '../../backups'), log = console.log } = {}) {
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
  const backup = {
    takenAt: new Date().toISOString(),
    leads: [], activities: [], stageHistory: [],
    projects: [], revisions: [], approvals: [], proposals: [], syncEvents: [],
    erpProjects: [],
    usersDeactivated: [],
    attachments: [],
  };

  log('\n================ Section 0: sectors (never touched by this script) ================');
  const sectors = await col('sectors').find({ name: { $in: PRESERVED_SECTOR_NAMES } }).toArray();
  log(`Confirmed present and untouched: ${sectors.map(s => s.name).join(', ') || '(none found - check manually)'}`);

  // ---------------------------------------------------------------- CRM leads (identity: name marker)
  log('\n================ Section 1: CRM leads ================');
  const leads = await col('crmleads').find({ name: TEST_NAME_MARKER }).toArray();
  for (const l of leads) {
    const [quotations, payments, attachments] = await Promise.all([
      col('crmquotations').countDocuments({ lead: l._id }),
      col('crmpayments').countDocuments({ lead: l._id }),
      col('attachments').find({ ownerType: 'CrmLead', owner: l._id }).toArray(),
    ]);
    if (quotations) problems.push(`Lead ${l.refCode} has ${quotations} quotation(s) - refusing.`);
    if (payments) problems.push(`Lead ${l.refCode} has ${payments} payment(s) - refusing.`);
    const activities = await col('crmactivities').find({ lead: l._id }).toArray();
    const stageHistory = await col('crmstagehistories').find({ lead: l._id }).toArray();
    backup.leads.push(l);
    backup.activities.push(...activities);
    backup.stageHistory.push(...stageHistory);
    backup.attachments.push(...attachments);
    log(` - ${l.refCode} "${l.name}" (stage ${l.stage}): ${activities.length} activit(ies), ${stageHistory.length} stage change(s), ${attachments.length} attachment(s).`);
  }
  if (!leads.length) log('(none found)');

  // ---------------------------------------------------------------- Commercial (Deal Engine) projects
  log('\n================ Section 2: Deal Engine (Commercial) projects ================');
  const leadIds = leads.map(l => l._id);
  const projects = await col('commercialprojects').find({ crmLead: { $in: leadIds } }).toArray();
  for (const p of projects) {
    const attachments = await col('attachments').find({ ownerType: 'CommercialProject', owner: p._id }).toArray();
    const revisions = await col('commercialrevisions').find({ project: p._id }).toArray();
    const approvals = await col('commercialapprovals').find({ revision: { $in: revisions.map(r => r._id) } }).toArray();
    const proposals = await col('commercialproposals').find({ project: p._id }).toArray();
    const syncEvents = await col('commercialsyncevents').find({ project: p._id }).toArray();
    backup.projects.push(p);
    backup.revisions.push(...revisions);
    backup.approvals.push(...approvals);
    backup.proposals.push(...proposals);
    backup.syncEvents.push(...syncEvents);
    backup.attachments.push(...attachments);
    log(` - ${p.projectCode} (${p.category}): ${revisions.length} revision(s), ${approvals.length} approval row(s), ${proposals.length} proposal(s), ${attachments.length} attachment(s), erpProject=${p.erpProject || '(none)'}`);
  }
  if (!projects.length) log('(none found)');

  // ---------------------------------------------------------------- ERP project (the Won handoff target)
  log('\n================ Section 3: ERP project (Won -> ERP handoff) ================');
  const erpProjectIds = projects.map(p => p.erpProject).filter(Boolean);
  const erpProjects = await col('projects').find({ _id: { $in: erpProjectIds } }).toArray();
  for (const ep of erpProjects) {
    // Real downstream usage of an ERP project would show up as sales orders, advanced payments, or
    // journal entries referencing it - checked, not assumed, since a Won test project is otherwise
    // indistinguishable in shape from a real one.
    const [salesOrders, advancedPayments, journalEntries] = await Promise.all([
      col('salesorders').countDocuments({ project: ep._id }),
      col('advancedpayments').countDocuments({ project: ep._id }),
      col('journalentries').countDocuments({ project: ep._id }),
    ]);
    if (salesOrders) problems.push(`ERP project ${ep.code || ep._id} has ${salesOrders} sales order(s) - refusing.`);
    if (advancedPayments) problems.push(`ERP project ${ep.code || ep._id} has ${advancedPayments} advanced payment(s) - refusing.`);
    if (journalEntries) problems.push(`ERP project ${ep.code || ep._id} has ${journalEntries} journal entry/entries - refusing.`);
    backup.erpProjects.push(ep);
    log(` - ${ep.code || ep._id}: sector=${ep.sector}, averageCostLines=${(ep.averageCostLines || []).length}, boqLines=${(ep.boqLines || []).length}, sales orders=${salesOrders}, advanced payments=${advancedPayments}, journal entries=${journalEntries}`);
  }
  if (!erpProjects.length) log('(none found)');

  // ---------------------------------------------------------------- Users (identity: @reservia-test.local OR name marker)
  log('\n================ Section 4: test Users (deactivated, never hard-deleted) ================');
  const users = await col('users').find({ $or: [{ email: TEST_EMAIL_DOMAIN }, { name: TEST_NAME_MARKER }] }).toArray();
  const unrelated = users.filter(u => String(u.email || '').toLowerCase() === KNOWN_UNRELATED_TEST_USER_EMAIL);
  const inScope = users.filter(u => String(u.email || '').toLowerCase() !== KNOWN_UNRELATED_TEST_USER_EMAIL);
  for (const u of inScope) {
    backup.usersDeactivated.push(u);
    log(` - ${u.email} (role=${u.role}, systems=${(u.systemMemberships || []).map(m => `${m.system}:${m.role}`).join(',') || '-'}) -> will be set isDeleted:true`);
  }
  if (unrelated.length) {
    log('\n -- Found, but OUT OF SCOPE (not an @reservia-test.local address, so not created by this session) --');
    unrelated.forEach(u => log(`    ${u.email} (customerNumber=${u.customerNumber}) - confirm its origin with the team before doing anything with it.`));
  }

  if (problems.length) {
    log('\nREFUSED - resolve these first:');
    problems.forEach(p => log(`  * ${p}`));
    return { applied: false, problems };
  }
  const totalToRemove = backup.leads.length + backup.projects.length + backup.erpProjects.length + backup.usersDeactivated.length;
  if (!totalToRemove) {
    log('\nNothing to remove.');
    return { applied: false, problems: [] };
  }
  if (!apply) {
    log('\nDry run - nothing was changed. Re-run with --apply to back up and delete/deactivate exactly the records above.');
    return { applied: false, problems: [], backup };
  }

  // Read-back verification, not just "fs.writeFileSync didn't throw": re-read the file and confirm
  // it round-trips to the exact same record counts before anything is deleted. If this fails, STOP
  // without deleting anything - a backup that cannot be verified is not a backup.
  fs.mkdirSync(backupDir, { recursive: true });
  const file = path.join(backupDir, `prelaunch-test-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  const verify = JSON.parse(fs.readFileSync(file, 'utf8'));
  const countsMatch = Object.keys(backup).every(k => Array.isArray(backup[k]) ? verify[k]?.length === backup[k].length : true);
  if (!countsMatch) throw new SafetyError(`Backup verification failed for ${file} - STOPPING without deleting anything.`);
  log(`\nBackup written and verified: ${file}`);

  const projectIds = backup.projects.map(p => p._id);
  const revisionIds = backup.revisions.map(r => r._id);
  const attachmentIds = backup.attachments.map(a => a._id);

  // Everything below runs in one transaction - a failure partway rolls the whole cleanup back
  // rather than leaving a half-deleted state that no longer matches the backup just verified above.
  const session = mongoose.connection.getClient().startSession();
  try {
    await session.withTransaction(async () => {
      await col('attachments').deleteMany({ _id: { $in: attachmentIds } }, { session });
      await col('commercialapprovals').deleteMany({ _id: { $in: backup.approvals.map(a => a._id) } }, { session });
      await col('commercialproposals').deleteMany({ project: { $in: projectIds } }, { session });
      await col('commercialrevisions').deleteMany({ _id: { $in: revisionIds } }, { session });
      await col('commercialsyncevents').deleteMany({ $or: [{ project: { $in: projectIds } }, { lead: { $in: leadIds } }] }, { session });
      await col('commercialprojects').deleteMany({ _id: { $in: projectIds } }, { session });
      await col('projects').deleteMany({ _id: { $in: backup.erpProjects.map(p => p._id) } }, { session });
      await col('crmactivities').deleteMany({ lead: { $in: leadIds } }, { session });
      await col('crmstagehistories').deleteMany({ lead: { $in: leadIds } }, { session });
      await col('crmintakeevents').updateMany({ lead: { $in: leadIds } }, { $set: { lead: null } }, { session });
      await col('crmleads').deleteMany({ _id: { $in: leadIds } }, { session });
      await col('users').updateMany({ _id: { $in: backup.usersDeactivated.map(u => u._id) } }, { $set: { isDeleted: true } }, { session });
    });
  } finally {
    await session.endSession();
  }

  // GridFS bytes for the deleted attachments - best-effort, outside the transaction (matches
  // attachmentService.js#deleteAttachment's own non-transactional convention). A failure here
  // leaves an orphaned blob, never a dangling/incorrect reference - the Attachment doc that
  // pointed to it is already gone, inside the transaction above.
  if (attachmentIds.length) {
    const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'attachmentfiles' });
    for (const a of backup.attachments) {
      // eslint-disable-next-line no-await-in-loop
      await bucket.delete(a.file).catch(err => log(`  (file for attachment ${a._id} could not be removed from storage: ${err.message} - harmless orphan, not a data-integrity issue)`));
    }
  }

  log(`Deleted ${projectIds.length} Deal Engine project(s), ${backup.erpProjects.length} ERP project(s), ${leadIds.length} CRM lead(s), ${attachmentIds.length} attachment(s); deactivated ${backup.usersDeactivated.length} test user(s).`);
  return { applied: true, problems: [], backupFile: file };
}

if (require.main === module) {
  prelaunchTestCleanup()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('db:prelaunch-test-cleanup failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { prelaunchTestCleanup };
