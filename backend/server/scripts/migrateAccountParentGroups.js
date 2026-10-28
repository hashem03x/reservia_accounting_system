/**
 * Builds the Parent Account Groups list (Accounting -> Parent Account Groups) from the group names
 * the Chart of Accounts already carries in `parentGroupNameEn` / `parentGroupNameAr` (set by the CSV
 * import, see importReversiaAccountingData.js).
 *
 * Additive and idempotent:
 *   - only ever INSERTS AccountParentGroup documents - no Chart of Accounts record is modified,
 *     renamed or deleted, and no journal entry or balance is touched;
 *   - a group that already exists (same English name in any spelling/case) is skipped, so running it
 *     again creates nothing.
 *
 * Group names are compared normalized (utils/accountGroupName.js). A name is NOT created - it is
 * reported for review instead - when its accounts disagree:
 *   - conflicting account types (the same group name on asset and liability accounts, say),
 *   - conflicting Arabic names, or
 *   - no Arabic name at all (a group needs both names; nothing is invented),
 *   - its Arabic name already belongs to a different group.
 * Those accounts keep working exactly as before (they keep their stored names); an administrator
 * creates the group by hand once the data is settled.
 *
 * Usage:
 *   npm run db:migrate-account-parent-groups -- --dry-run   # report only
 *   npm run db:migrate-account-parent-groups               # create the missing groups
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { normalizeGroupName } = require('../utils/accountGroupName');
const { compareAccountCodes } = require('../utils/accountCodeSort');

// The most used spelling; a tie goes to the one seen first (lowest account code) - Map keeps
// insertion order and the sort is stable.
const mostCommon = counts => [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

/**
 * Pure planning step (no database): what to create and what to report.
 * @param {Array<{ code, type, parentGroupNameEn?, parentGroupNameAr? }>} accounts
 * @param {Array<{ nameEn, nameAr, type }>} existingGroups
 * @param {(nameEn: string) => boolean} isSystemDefault
 */
function planParentGroupMigration(accounts, existingGroups, isSystemDefault = () => false) {
  const existingByEn = new Map(existingGroups.map(g => [normalizeGroupName(g.nameEn), g]));
  const arOwners = new Map(existingGroups.map(g => [normalizeGroupName(g.nameAr), normalizeGroupName(g.nameEn)]));

  // Collect each group name's spellings, Arabic names and types, in Chart of Accounts code order so
  // the created groups' sortOrder follows the chart.
  const byKey = new Map();
  const sorted = [...accounts].sort((a, b) => compareAccountCodes(a.code, b.code));
  for (const account of sorted) {
    const key = normalizeGroupName(account.parentGroupNameEn);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, { key, accountCount: 0, spellings: new Map(), arabic: new Map(), arabicSpellings: new Map(), types: new Map(), codes: [] });
    const entry = byKey.get(key);
    entry.accountCount += 1;
    entry.codes.push(account.code);
    entry.spellings.set(account.parentGroupNameEn.trim(), (entry.spellings.get(account.parentGroupNameEn.trim()) || 0) + 1);
    entry.types.set(account.type, (entry.types.get(account.type) || 0) + 1);
    const arKey = normalizeGroupName(account.parentGroupNameAr);
    if (arKey) {
      entry.arabic.set(arKey, (entry.arabic.get(arKey) || 0) + 1);
      entry.arabicSpellings.set(arKey, account.parentGroupNameAr.trim());
    }
  }

  const plan = { toCreate: [], existing: [], conflicts: [], missingTranslations: [], accountsScanned: accounts.length, accountsWithGroup: 0 };
  const nextSortOrder = {};
  for (const entry of byKey.values()) {
    plan.accountsWithGroup += entry.accountCount;
    const nameEn = mostCommon(entry.spellings);
    const types = [...entry.types.keys()];
    const arabicKeys = [...entry.arabic.keys()];
    const summary = { nameEn, accountCount: entry.accountCount, types, arabicNames: arabicKeys.map(k => entry.arabicSpellings.get(k)), sampleCodes: entry.codes.slice(0, 5) };

    const existing = existingByEn.get(entry.key);
    if (existing) {
      const notes = [];
      if (types.some(t => t !== existing.type)) notes.push(`accounts have type(s) ${types.join(', ')} but the group is ${existing.type}`);
      if (arabicKeys.some(k => k !== normalizeGroupName(existing.nameAr))) notes.push(`accounts carry Arabic name(s) ${summary.arabicNames.join(' / ')} but the group's is ${existing.nameAr}`);
      plan.existing.push({ ...summary, notes });
      continue;
    }
    if (types.length > 1) {
      plan.conflicts.push({ ...summary, reason: `conflicting account types: ${types.map(t => `${t} (${entry.types.get(t)})`).join(', ')}` });
      continue;
    }
    if (arabicKeys.length > 1) {
      plan.conflicts.push({ ...summary, reason: `conflicting Arabic names: ${arabicKeys.map(k => `${entry.arabicSpellings.get(k)} (${entry.arabic.get(k)})`).join(', ')}` });
      continue;
    }
    if (arabicKeys.length === 0) {
      plan.missingTranslations.push({ ...summary, reason: 'no Arabic group name on any of its accounts' });
      continue;
    }
    const arOwner = arOwners.get(arabicKeys[0]);
    if (arOwner && arOwner !== entry.key) {
      plan.conflicts.push({ ...summary, reason: `its Arabic name "${summary.arabicNames[0]}" already belongs to another group` });
      continue;
    }
    arOwners.set(arabicKeys[0], entry.key);

    const type = types[0];
    nextSortOrder[type] = (nextSortOrder[type] || 0) + 1;
    plan.toCreate.push({
      nameEn,
      nameAr: summary.arabicNames[0],
      type,
      sortOrder: nextSortOrder[type],
      isSystemDefault: isSystemDefault(nameEn),
      accountCount: entry.accountCount,
      spellings: [...entry.spellings.keys()],
    });
  }
  return plan;
}

function printPlan(plan, log) {
  log(`Accounts scanned: ${plan.accountsScanned}, with a parent group name: ${plan.accountsWithGroup}`);
  log(`Groups to create: ${plan.toCreate.length}`);
  plan.toCreate.forEach(g => log(`  + [${g.type}] ${g.nameEn} / ${g.nameAr} - ${g.accountCount} account(s)${g.isSystemDefault ? ' (system default)' : ''}${g.spellings.length > 1 ? ` - spellings merged: ${g.spellings.join(' | ')}` : ''}`));
  log(`Already existing (skipped): ${plan.existing.length}`);
  plan.existing.filter(g => g.notes.length).forEach(g => log(`  ! ${g.nameEn}: ${g.notes.join('; ')}`));
  log(`Conflicts flagged for review (not created): ${plan.conflicts.length}`);
  plan.conflicts.forEach(g => log(`  x ${g.nameEn} - ${g.reason} - e.g. accounts ${g.sampleCodes.join(', ')}`));
  log(`Missing translations (not created): ${plan.missingTranslations.length}`);
  plan.missingTranslations.forEach(g => log(`  ? ${g.nameEn} - ${g.reason} - e.g. accounts ${g.sampleCodes.join(', ')}`));
}

async function migrateAccountParentGroups({ dryRun = process.argv.includes('--dry-run'), connect = true, log = console.log } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    log('Connecting to database...');
    await mongoose.connect(process.env.DB_URI);
    const dbName = assertSafeDatabaseName(mongoose.connection);
    log(`Connected (host: ${mongoose.connection.host}, db: ${dbName}).`);
    await assertNotLeopardDatabase(mongoose.connection);
  }

  /* eslint-disable global-require */
  const AccountParentGroup = require('../models/accounting/accountParentGroupModel');
  const AccountParentGroupLog = require('../models/accounting/accountParentGroupLogModel');
  const { isSystemDefaultName } = require('../services/accounting/accountParentGroupService');
  /* eslint-enable global-require */
  await AccountParentGroup.init(); // unique name indexes must exist before inserting

  // Raw collection read: every account (active or not), exactly as stored - nothing is written back.
  const accounts = await mongoose.connection
    .collection('chartofaccounts')
    .find({}, { projection: { code: 1, type: 1, parentGroupNameEn: 1, parentGroupNameAr: 1 } })
    .toArray();
  const existingGroups = await AccountParentGroup.find({}).lean();
  const plan = planParentGroupMigration(accounts, existingGroups, isSystemDefaultName);
  printPlan(plan, log);

  const result = { created: 0, skippedExisting: plan.existing.length, conflicts: plan.conflicts, missingTranslations: plan.missingTranslations, plan };
  if (dryRun) {
    log('\n--dry-run: no changes made.');
    return result;
  }

  for (const g of plan.toCreate) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const group = await AccountParentGroup.create({ nameEn: g.nameEn, nameAr: g.nameAr, type: g.type, sortOrder: g.sortOrder, isSystemDefault: g.isSystemDefault, isActive: true });
      // eslint-disable-next-line no-await-in-loop
      await AccountParentGroupLog.create({ action: 'migrate', group: group._id, groupNameEn: group.nameEn, after: { nameEn: g.nameEn, nameAr: g.nameAr, type: g.type, accountCount: g.accountCount } });
      result.created += 1;
    } catch (err) {
      // Created meanwhile by someone else (or a concurrent run): the unique index decides.
      if (err?.code === 11000) result.skippedExisting += 1;
      else throw err;
    }
  }
  log(`\nCreated ${result.created} parent group(s). No Chart of Accounts record was changed.`);
  return result;
}

if (require.main === module) {
  migrateAccountParentGroups()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:migrate-account-parent-groups failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { planParentGroupMigration, migrateAccountParentGroups };
