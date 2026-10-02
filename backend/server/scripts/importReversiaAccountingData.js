/**
 * Imports the real Chart of Accounts / Journal Entries / Projects dataset from the CSV/Excel
 * files under csv_files/ into the existing accounting models (ChartOfAccount, JournalEntry,
 * Project) - replacing whatever is currently in those three collections. Nothing else is touched.
 *
 * Source files (fixed paths, not configurable - this is a one-time dataset import, not a general
 * importer):
 *   csv_files/chart of accounts (1).csv
 *   csv_files/journal entry.xlsx
 *
 * Usage:
 *   node server/scripts/importReversiaAccountingData.js --dry-run   (zero writes, full report)
 *   node server/scripts/importReversiaAccountingData.js --yes       (actually clears + imports)
 *
 * Mirrors the project's established safe-script conventions (see resetDb.js /
 * migrateProjectFieldRenames.js / lib/dbSafety.js): dry-run by default, destructive path requires
 * an explicit --yes, Leopard/safe-database-name checks always run.
 */
const path = require('path');
const mongoose = require('mongoose');
const xlsx = require('xlsx');
const parseCsv = require('../utils/parseCsv');
const { loadEnv, SafetyError, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase } = require('./lib/dbSafety');
const { typeBase } = require('../services/accounting/chartOfAccountOrderingService');

const CSV_FILE = path.join(__dirname, '..', '..', '..', 'csv_files', 'chart of accounts (1).csv');
const XLSX_FILE = path.join(__dirname, '..', '..', '..', 'csv_files', 'journal entry.xlsx');

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRMED = process.argv.includes('--yes');

const TYPE_MAP = {
  'non-current assets': 'asset',
  'current assets': 'asset',
  equity: 'equity',
  'non-current liabilities': 'liability',
  'current liabilities': 'liability',
  expenses: 'expense',
  // The source distinguishes "Costs" from "Expenses" as separate type values - preserved as its
  // own 'cogs' account type (not folded into 'expense') so Project Average Cost eligibility can be
  // determined structurally from this real source distinction, see accountingConstants.js.
  costs: 'cogs',
  revenue: 'revenue',
};

function normalizeTypeKey(raw) {
  return (raw || '')
    .replace(/‑/g, '-') // non-breaking hyphen -> regular hyphen (seen in the CSV)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// ===================== Chart of Accounts =====================

async function parseChartOfAccounts() {
  const rows = await parseCsv(CSV_FILE);

  const accounts = []; // { code, name, nameAr, type, parentGroupNameEn, parentGroupNameAr, sortOrder }
  const rejected = []; // { row, reason }
  const seenCodes = new Set();
  // Sequential per-type counter, assigned in CSV row order - preserves the source file's own
  // ordering exactly (see chartOfAccountOrderingService.js's block encoding: a single ascending
  // sort by sortOrder alone reproduces this same type-grouped order everywhere).
  const nextPositionByType = {};

  for (const row of rows) {
    const code = (row['كود الحساب'] || '').trim();
    const nameAr = (row['اسم الحساب بالعربي'] || '').trim();
    const nameEn = (row['اسم الحساب بالإنجليزي'] || '').trim();
    const typeEn = (row['النوع بالإنجليزي'] || '').trim();
    const parentAr = (row['Parent بالعربي'] || '').trim();
    const parentEn = (row['Parent بالإنجليزي'] || '').trim();

    // Section-divider rows (e.g. "الأصول غير المتداولة (10xxxxxx)") only ever populate the code
    // column with the section title - not a real account, silently skipped.
    if (!nameEn) continue;

    if (!code) {
      // The source has no code for this row ("Income Tax Expense") - per explicit decision, it is
      // excluded and reported here rather than importing it with an invented or null code.
      rejected.push({ row, reason: `Missing account code for "${nameEn}" - excluded from import` });
      continue;
    }
    if (seenCodes.has(code)) {
      rejected.push({ row, reason: `Duplicate account code "${code}"` });
      continue;
    }

    const type = TYPE_MAP[normalizeTypeKey(typeEn)];
    if (!type) {
      rejected.push({ row, reason: `Unrecognized account type "${typeEn}" for code "${code}"` });
      continue;
    }

    seenCodes.add(code);

    // A parent label identical to the account's own name means "no real parent" - the sheet is
    // just repeating the account name in that column (seen for several top-level accounts). The
    // source never gives a coded parent account, only this text label - it is stored verbatim as
    // a descriptive group field, not fabricated as a fake ChartOfAccount document/code.
    const hasRealParent = Boolean(parentEn && parentEn !== nameEn);

    nextPositionByType[type] = (nextPositionByType[type] || 0) + 1;

    accounts.push({
      code,
      name: nameEn,
      nameAr: nameAr || null,
      type,
      parentGroupNameEn: hasRealParent ? parentEn : null,
      parentGroupNameAr: hasRealParent ? parentAr || null : null,
      sortOrder: typeBase(type) + nextPositionByType[type],
    });
  }

  return { accounts, rejected, totalCsvRows: rows.length };
}

// ===================== Journal Entry =====================

function parseJournalEntryRows() {
  const workbook = xlsx.readFile(XLSX_FILE, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet, { defval: null });
}

function buildJournalEntryPlan(rows, accountByCode, projectCodeSet) {
  const byDocNumber = new Map();
  const errors = [];

  rows.forEach((row, index) => {
    const rowLabel = `xlsx row ${index + 2}`; // +2: header row + 1-indexed
    const docNumber = row['Doucment number '] ?? row['Doucment number'];
    const accNumber = row['Acc Number'] != null ? String(row['Acc Number']).trim() : null;
    const date = row['Doucment date'];
    const projectNumber = row['project number '] ?? row['project number'];
    const currency = row['curncy'] || null;
    const rate = typeof row['rate'] === 'number' ? row['rate'] : null;
    const debit = typeof row['debit'] === 'number' ? row['debit'] : 0;
    const credit = typeof row['credit '] === 'number' ? row['credit '] : typeof row['credit'] === 'number' ? row['credit'] : 0;
    const balanceLocal = row['balance ( local curncy )'];

    if (docNumber == null) {
      errors.push(`${rowLabel}: missing document number`);
      return;
    }
    if (!accNumber || !accountByCode.has(accNumber)) {
      errors.push(`${rowLabel}: account code "${accNumber}" not found in the imported Chart of Accounts`);
      return;
    }
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      errors.push(`${rowLabel}: invalid or missing document date`);
      return;
    }
    if (debit < 0 || credit < 0) {
      errors.push(`${rowLabel}: negative debit/credit is not supported`);
      return;
    }
    if (debit > 0 === credit > 0) {
      errors.push(`${rowLabel}: must have exactly one of debit/credit (got debit=${debit}, credit=${credit})`);
      return;
    }
    if (projectNumber && !projectCodeSet.has(String(projectNumber).trim())) {
      errors.push(`${rowLabel}: project "${projectNumber}" was not resolved`);
      return;
    }

    const localAmount = rate ? (debit || credit) * rate : debit || credit;
    if (typeof balanceLocal === 'number' && Math.round(Math.abs(balanceLocal)) !== Math.round(localAmount)) {
      errors.push(`${rowLabel}: WARNING - computed local amount (${localAmount}) does not match the sheet's own "balance (local currency)" column (${balanceLocal}) - imported using the computed amount`);
    }

    if (!byDocNumber.has(docNumber)) {
      byDocNumber.set(docNumber, { docNumber, date, project: projectNumber ? String(projectNumber).trim() : null, lines: [] });
    }
    byDocNumber.get(docNumber).lines.push({
      accountCode: accNumber,
      debit: debit > 0 ? localAmount : 0,
      credit: credit > 0 ? localAmount : 0,
      currency,
      exchangeRate: rate,
    });
  });

  const entries = [];
  for (const entry of byDocNumber.values()) {
    const totalDebit = entry.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = entry.lines.reduce((s, l) => s + l.credit, 0);
    if (entry.lines.length < 2) {
      errors.push(`Document #${entry.docNumber}: only ${entry.lines.length} line(s) - a journal entry needs at least 2`);
      continue;
    }
    if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
      errors.push(`Document #${entry.docNumber}: NOT BALANCED - total debit ${totalDebit} !== total credit ${totalCredit}`);
      continue;
    }
    entries.push(entry);
  }

  return { entries, errors, totalXlsxRows: rows.length };
}

// ===================== Main =====================

async function run() {
  loadEnv();
  assertDbUriConfigured();

  console.log('Reservia Accounting Import\n');
  console.log(DRY_RUN ? '*** DRY RUN - no data will be written ***\n' : CONFIRMED ? '*** LIVE RUN - collections will be cleared and reimported ***\n' : '');

  if (!DRY_RUN && !CONFIRMED) {
    throw new SafetyError('Refusing to run without --dry-run or --yes. Run with --dry-run first to review the plan, then --yes to apply it.');
  }

  console.log('Connecting to database...');
  const mongooseConn = await mongoose.connect(process.env.DB_URI);
  const connection = mongooseConn.connection;
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).\n`);
  await assertNotLeopardDatabase(connection);

  const ChartOfAccount = require('../models/accounting/chartOfAccountModel');
  const JournalEntry = require('../models/accounting/journalEntryModel');
  const Project = require('../models/project/projectModel');
  const Payment = require('../models/vendor/paymentModel');
  const { getNextJournalEntryNumber } = require('../services/accounting/journalEntryNumberService');

  // ---- Parse + validate everything up front (no writes yet) ----

  const coaPlan = await parseChartOfAccounts();
  console.log(`Chart of Accounts CSV: ${coaPlan.totalCsvRows} rows -> ${coaPlan.accounts.length} valid account(s), ${coaPlan.rejected.length} rejected.`);
  if (coaPlan.rejected.length) {
    console.log('  Rejected rows:');
    coaPlan.rejected.forEach(r => console.log(`    - ${r.reason}`));
  }

  const projectCodes = new Set();
  const rawJournalRows = parseJournalEntryRows();
  rawJournalRows.forEach(row => {
    const p = row['project number '] ?? row['project number'];
    if (p) projectCodes.add(String(p).trim());
  });
  console.log(`\nProjects referenced by journal entries: [${Array.from(projectCodes).join(', ') || 'none'}]`);
  if (projectCodes.size > 0) {
    console.log('  No Projects source file exists - a minimal reference-only Project will be created for each code above (projectNumber ONLY; no contractValue/projectManager/dates are fabricated - those fields are left genuinely empty since the source data does not provide them).');
  }

  const accountByCode = new Map(coaPlan.accounts.map(a => [a.code, a]));
  const jePlan = buildJournalEntryPlan(rawJournalRows, accountByCode, projectCodes);
  console.log(`\nJournal Entry file: ${jePlan.totalXlsxRows} rows -> ${jePlan.entries.length} journal entry(ies) ready to import.`);
  if (jePlan.errors.length) {
    console.log('  Issues:');
    jePlan.errors.forEach(e => console.log(`    - ${e}`));
  }

  // Pre-flight: existing data + dependency check (report only, never auto-deletes anything outside
  // the 3 in-scope collections).
  const existingCounts = {
    accounts: await ChartOfAccount.countDocuments({}),
    projects: await Project.countDocuments({}),
    journalEntries: await JournalEntry.countDocuments({}),
  };
  console.log(`\nExisting data that will be cleared: ${existingCounts.accounts} account(s), ${existingCounts.projects} project(s), ${existingCounts.journalEntries} journal entry(ies).`);

  const existingProjectIds = await Project.find({}).select('_id').lean();
  const dependentPayments = existingProjectIds.length ? await Payment.countDocuments({ projectId: { $in: existingProjectIds.map(p => p._id) } }) : 0;
  if (dependentPayments > 0) {
    console.log(`  WARNING: ${dependentPayments} existing Payment record(s) reference a Project that is about to be deleted. Payments are NOT part of this import's scope and will NOT be modified - their projectId reference will become dangling.`);
  }

  if (DRY_RUN) {
    console.log('\nDry run complete. No data was written. Re-run with --yes to apply this plan.');
    return;
  }

  // ---- Clear (only the 3 in-scope collections) ----

  console.log('\nClearing existing Chart of Accounts, Journal Entries, and Projects...');
  await JournalEntry.deleteMany({});
  await Project.deleteMany({});
  await ChartOfAccount.deleteMany({});

  // ---- Import Chart of Accounts ----
  // No synthesized "group" accounts/codes - the source's Parent column is a text label, not a
  // coded account, so it's stored on each leaf account as parentGroupNameEn/Ar (see model
  // comment). `parentAccount` is left null for every imported row since the source never
  // supplies a real coded parent reference.

  const leafDocs = await ChartOfAccount.insertMany(
    coaPlan.accounts.map(a => ({
      code: a.code,
      name: a.name,
      nameAr: a.nameAr,
      type: a.type,
      parentGroupNameEn: a.parentGroupNameEn,
      parentGroupNameAr: a.parentGroupNameAr,
      sortOrder: a.sortOrder,
    }))
  );
  const accountIdByCode = new Map(leafDocs.map(d => [d.code, d._id]));
  console.log(`\nChart of Accounts: created ${leafDocs.length} account(s).`);

  // ---- Import Projects (one reference-only record per code found in the journal entries) ----
  // Only `projectNumber` (real source data) is set. contractValue/projectManager/startDate/
  // deliveryDate are left unset (null) rather than fabricated - the Project model's `required`
  // constraint on those fields was relaxed specifically for this case (the real "Create Project"
  // UI/API still requires them independently via createProjectValidators.js).

  const projectDocsByCode = new Map();
  for (const code of projectCodes) {
    const doc = await Project.create({
      projectNumber: code,
      description: `Reference-only project created during the accounting CSV import: project code "${code}" is referenced by an imported journal entry, but no Projects source file exists and no other project details were available. Fill in the real project details via the UI.`,
    });
    projectDocsByCode.set(code, doc);
  }
  console.log(`Projects: created ${projectDocsByCode.size} reference-only project(s) (projectNumber only, no other fields fabricated).`);

  // ---- Import Journal Entries ----

  let journalLinesCreated = 0;
  for (const entry of jePlan.entries) {
    const entryNumber = await getNextJournalEntryNumber();
    const project = entry.project ? projectDocsByCode.get(entry.project) : null;
    await JournalEntry.create({
      entryNumber,
      date: entry.date,
      description: `Imported journal entry - Document #${entry.docNumber}`,
      source: 'manual',
      reference: String(entry.docNumber),
      project: project ? project._id : null,
      status: 'posted',
      lines: entry.lines.map(l => ({
        account: accountIdByCode.get(l.accountCode),
        project: project ? project._id : null,
        projectNumber: entry.project || null,
        debit: l.debit,
        credit: l.credit,
        currency: l.currency,
        exchangeRate: l.exchangeRate,
      })),
    });
    journalLinesCreated += entry.lines.length;
  }

  console.log(`Journal Entries: created ${jePlan.entries.length} entry(ies), ${journalLinesCreated} line(s) total.\n`);

  console.log('Import Summary');
  console.log('--------------');
  console.log(`Chart of Accounts: CSV rows ${coaPlan.totalCsvRows}, imported ${leafDocs.length} account(s), rejected ${coaPlan.rejected.length}`);
  console.log(`Projects: referenced ${projectCodes.size}, created ${projectDocsByCode.size} (reference-only, no fabricated fields)`);
  console.log(`Journal Entries: XLSX rows ${jePlan.totalXlsxRows}, entries created ${jePlan.entries.length}, lines created ${journalLinesCreated}, issues ${jePlan.errors.length}`);
  console.log('\nImport completed successfully.');
}

run()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async err => {
    console.error('\ndb:import-accounting-data failed:');
    if (err instanceof SafetyError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    try {
      await mongoose.disconnect();
    } catch {
      // already disconnected / never connected
    }
    process.exit(1);
  });
