const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Depreciation and amortization through the whole ledger: the depreciation run, the Chart of
// Accounts balances, the Trial Balance, General Ledger, Profit or Loss, Financial Position and the
// fixed asset reports - all from the same posted journal entries, so they must agree to the pound.
// Also the cause of depreciation missing from the reports (an entry dated after the day it was
// posted) and the audit / repair of entries posted that way before the fix.

const DB_URI = process.env.TEST_DB_URI_DEPRECIATION_REPORTING || 'mongodb://127.0.0.1:27017/reversia_test_depreciation_reporting';
const { AutomaticJournalAccountCodes: C } = require('../../utils/accountingConstants');

let FixedAsset, ChartOfAccount, JournalEntry, Vendor, Project, User;
let createFixedAsset, runDepreciation, getTrialBalance, runReport, reverseJournalEntry, auditDepreciation, repairFutureDatedDepreciation;
let transactionsSupported = true;
let A, vendor, admin;

const R = (key, query = {}) => runReport(key, query);
const rowOf = (report, code) => report.sections[0].rows.find(r => r.code === code);
const checkOk = (report, re) => report.checks.find(c => re.test(c.label.en))?.ok;
const thisMonth = () => new Date().toISOString().slice(0, 7);

function callHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
    };
    Promise.resolve(handler({ headers: {}, query: {}, body: {}, params: {}, user: admin, ...req }, res, err => (err ? reject(err) : resolve({ status: res.statusCode })))).catch(reject);
  });
}
async function inTx(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}
const depreciate = period => inTx(session => runDepreciation({ period, userId: admin._id }, session));
const depreciationEntries = () => JournalEntry.find({ accountingAction: 'FIXED_ASSET_DEPRECIATION' }).sort({ entryNumber: 1 }).lean();
const coaBalance = async account => (await getTrialBalance()).find(r => String(r.account._id) === String(account._id)) || { debit: 0, credit: 0, balance: 0 };

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/inventory/warehouseModel');
  require('../../models/vendor/paymentModel');
  require('../../models/sales/salesOrderModel');
  require('../../models/equity/shareholderModel');
  FixedAsset = require('../../models/fixedAssets');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  Vendor = require('../../models/vendor/vendor');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  ({ createFixedAsset, runDepreciation } = require('../../services/fixedAssets/fixedAssetService'));
  ({ getTrialBalance } = require('../../services/accounting/generalLedgerService'));
  ({ runReport } = require('../../controller/reports/accountingReportsController'));
  ({ reverseJournalEntry } = require('../../controller/accounting/journalEntryController'));
  ({ auditDepreciation, repairFutureDatedDepreciation } = require('../../services/fixedAssets/depreciationAuditService'));
  await Promise.all([FixedAsset.init(), ChartOfAccount.init(), JournalEntry.init(), Vendor.init(), Project.init()]);

  const probe = await mongoose.startSession();
  try {
    await probe.withTransaction(async () => {
      await mongoose.connection.collection('__txn_probe').insertOne({ ok: 1 }, { session: probe });
    });
  } catch (err) {
    transactionsSupported = false;
  } finally {
    probe.endSession();
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// Chart of Accounts shaped like the imported one (groups are parentGroupNameEn values).
const CHART = {
  vehicles: { code: '12000001', name: 'Vehicles', type: 'asset', parentGroupNameEn: 'Property, Plant & Equipment' },
  accDep: { code: '12000099', name: 'Accumulated Depreciation – Fixed Assets', type: 'asset', parentGroupNameEn: 'Property, Plant & Equipment' },
  software: { code: '13000001', name: 'Software Licenses', type: 'asset', parentGroupNameEn: 'Intangible Assets' },
  accAmort: { code: '13000099', name: 'Accumulated Amortization - Intangible Assets', type: 'asset', parentGroupNameEn: 'Intangible Assets' },
  depExpense: { code: '62000001', name: 'Depreciation & Amortization', type: 'expense', parentGroupNameEn: 'Operating Expenses' },
  amortExpense: { code: '62000002', name: 'Amortization Expense', type: 'expense', parentGroupNameEn: 'Depreciation & Amortization' },
  suppliers: { code: C.suppliers, name: 'Suppliers', type: 'liability' },
  inputVat: { code: C.inputVat, name: 'Input VAT', type: 'asset' },
};

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await Promise.all([FixedAsset.init(), ChartOfAccount.init(), JournalEntry.init(), Vendor.init(), Project.init()]);
  A = {};
  for (const [key, data] of Object.entries(CHART)) A[key] = await ChartOfAccount.create(data);
  vendor = await Vendor.create({ name: 'Auto Dealer', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  admin = await User.create({ name: 'Admin', email: `admin-${Date.now()}@example.com`, role: 'admin', type: 'online' });
});

const VEHICLE = (overrides = {}) => ({
  name: 'Delivery Truck',
  vendor: vendor._id,
  assetAccountId: A.vehicles._id,
  accumulatedAccountId: A.accDep._id,
  depreciationAccountId: A.depExpense._id,
  acquisitionDate: new Date('2026-07-15'),
  price: 120000,
  usefulLifeMonths: 12, // 10,000 a month
  vatPercentage: 0,
  ...overrides,
});
const SOFTWARE = (overrides = {}) =>
  VEHICLE({ name: 'ERP License', assetAccountId: A.software._id, accumulatedAccountId: A.accAmort._id, depreciationAccountId: A.amortExpense._id, price: 36000, usefulLifeMonths: 36, ...overrides }); // 1,000 a month
const create = data => inTx(session => createFixedAsset(data, null, session));

test('EGP 120,000 asset, one EGP 10,000 month: the same figures in the CoA, Trial Balance, GL, P&L, Balance Sheet and asset reports', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  const run = await depreciate('2026-08');
  assert.equal(run.processed.length, 1);
  const [entry] = await depreciationEntries();
  assert.equal(entry.status, 'posted');
  assert.equal(entry.date.toISOString(), '2026-08-31T12:00:00.000Z', 'a completed month is dated its last day');
  assert.deepEqual(entry.lines.map(l => [String(l.account._id || l.account), l.debit, l.credit]), [[String(A.depExpense._id), 10000, 0], [String(A.accDep._id), 0, 10000]]);
  assert.equal(entry.totalDebit, entry.totalCredit);

  const aug = { from: '2026-08-01', to: '2026-08-31' };
  const tb = await R('trial-balance', aug);
  assert.deepEqual(['periodDebit', 'periodCredit', 'closingDebit', 'closingCredit'].map(k => rowOf(tb, '62000001')[k]), [10000, 0, 10000, 0], 'expense on the debit side');
  assert.deepEqual(['periodDebit', 'periodCredit', 'closingDebit', 'closingCredit'].map(k => rowOf(tb, '12000099')[k]), [0, 10000, 0, 10000], 'accumulated depreciation on the credit side, not a positive asset');
  assert.deepEqual(['openingDebit', 'periodDebit', 'closingDebit'].map(k => rowOf(tb, '12000001')[k]), [120000, 0, 120000]);
  assert.ok(tb.checks.every(c => c.ok), JSON.stringify(tb.checks));
  assert.equal(tb.sections[0].totals.closingDebit, tb.sections[0].totals.closingCredit);

  // Chart of Accounts balances = Trial Balance closing balances.
  assert.deepEqual([(await coaBalance(A.depExpense)).balance, (await coaBalance(A.accDep)).balance], [10000, -10000]);

  const glExpense = await R('general-ledger', { ...aug, account: String(A.depExpense._id) });
  const [line] = glExpense.sections[0].rows;
  assert.deepEqual([line.accountCode, line.entryNumber, line.debit, line.credit, line.balance], ['62000001', entry.entryNumber, 10000, 0, 10000]);
  assert.match(line.sourceNumber, /Delivery Truck/);
  assert.deepEqual(line._links.sourceNumber, { kind: 'fixedAsset', id: String(asset._id) }, 'drill-down to the fixed asset');
  const glAccumulated = await R('general-ledger', { ...aug, account: String(A.accDep._id) });
  assert.deepEqual(glAccumulated.sections[0].rows.map(r => [r.debit, r.credit]), [[0, 10000]]);
  assert.equal(glAccumulated.summary.find(s => s.key === 'closing').value, 10000, 'credit-nature closing balance = the Trial Balance closing credit');
  assert.equal(glAccumulated.sections[1].rows[0].normalSide, 'Credit', 'a contra-asset account: credit nature');
  assert.equal(glExpense.sections[1].rows[0].normalSide, 'Debit');
  assert.ok(checkOk(await R('general-ledger', aug), /Trial Balance movements/));

  const pl = await R('profit-loss', aug);
  assert.equal(pl.summary.find(s => s.key === 'expenses').value, 10000);
  assert.equal(pl.summary.find(s => s.key === 'netProfit').value, -10000);

  const bs = await R('financial-position', { asOf: '2026-08-31' });
  const ppe = bs.sections[0].rows;
  assert.equal(ppe.find(r => r.code === '12000099').amount, -10000, 'shown as a reduction');
  assert.equal(ppe.find(r => r.name === 'Total Property, Plant & Equipment').amount, 110000, 'net carrying value - subtracted once');
  assert.ok(bs.checks.every(c => c.ok), JSON.stringify(bs.checks));

  const register = await R('fixed-asset-register', { asOf: '2026-08-31' });
  const reg = register.sections[0].rows.find(r => r.name === 'Delivery Truck');
  assert.deepEqual([reg.cost, reg.accumulated, reg.netBookValue], [120000, 10000, 110000]);
  assert.ok(register.checks.every(c => c.ok), JSON.stringify(register.checks));
  const byAsset = await R('depreciation-by-asset', aug);
  assert.equal(byAsset.summary.find(s => s.key === 'expense').value, 10000);

  // Running the month again changes nothing.
  const again = await depreciate('2026-08');
  assert.deepEqual([again.processed.length, again.skipped[0].reason], [0, 'Already depreciated for this month']);
  assert.equal((await depreciationEntries()).length, 1);
  assert.equal(rowOf(await R('trial-balance', aug), '62000001').periodDebit, 10000);
});

test('the month in progress is posted on the run day, so the Trial Balance and reports up to today include it at once', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const monthStart = new Date(`${thisMonth()}-01T00:00:00.000Z`);
  await create(VEHICLE({ acquisitionDate: monthStart }));
  const before = Date.now();
  await depreciate(thisMonth());
  const [entry] = await depreciationEntries();
  assert.ok(entry.date.getTime() <= Date.now() && entry.date.getTime() >= before - 1000, `dated the run day, not the month end (got ${entry.date.toISOString()})`);
  assert.equal(entry.date.toISOString().slice(0, 7), thisMonth());

  // Default report window: 1 January to today.
  const tb = await R('trial-balance');
  assert.equal(rowOf(tb, '62000001').periodDebit, 10000);
  assert.equal(rowOf(tb, '12000099').closingCredit, 10000);
  assert.ok(tb.checks.every(c => c.ok), JSON.stringify(tb.checks));
  assert.equal((await R('profit-loss')).summary.find(s => s.key === 'expenses').value, 10000);
  const bs = await R('financial-position');
  assert.equal(bs.sections[0].rows.find(r => r.name === 'Total Property, Plant & Equipment').amount, 110000);
  assert.equal((await R('fixed-asset-register')).sections[0].rows[0].accumulated, 10000);
  // Chart of Accounts = Trial Balance, account by account.
  for (const coa of await getTrialBalance()) {
    const row = rowOf(tb, coa.account.code);
    assert.equal(round(row.closingDebit - row.closingCredit), coa.balance, coa.account.code);
  }
});
const round = n => Math.round(n * 100) / 100;

test('entries posted before the fix with a future date: flagged by the reports, found by the audit, re-dated once by the repair', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const monthStart = new Date(`${thisMonth()}-01T00:00:00.000Z`);
  const asset = await create(VEHICLE({ acquisitionDate: monthStart }));
  await depreciate(thisMonth());
  const [posted] = await depreciationEntries();
  // What the old run did: the month's last day (noon UTC) - after the day it was posted.
  const [y, m] = thisMonth().split('-').map(Number);
  const oldDate = new Date(Math.max(Date.UTC(y, m, 0, 12), Date.now() + 3600 * 1000));
  await JournalEntry.collection.updateOne({ _id: posted._id }, { $set: { date: oldDate } });
  await FixedAsset.collection.updateOne({ _id: asset._id }, { $set: { 'depreciations.0.date': oldDate } });

  // The symptom: the Chart of Accounts counts it, the Trial Balance up to today does not - and now says so.
  assert.equal((await coaBalance(A.depExpense)).balance, 10000);
  const tb = await R('trial-balance');
  assert.equal(rowOf(tb, '62000001'), undefined);
  const flagged = tb.checks.find(c => /dated after/.test(c.label.en));
  assert.equal(flagged.ok, false);
  assert.match(flagged.detail, new RegExp(`1 posted entry is dated after the end date and not included \\(no\\. ${posted.entryNumber}`));
  // A report ending before today is not flagged (later entries are simply outside it).
  assert.equal((await R('trial-balance', { from: '2026-01-01', to: '2026-01-31' })).checks.some(c => /dated after/.test(c.label.en)), false);

  const audit = await auditDepreciation();
  assert.deepEqual(audit.issues, []);
  assert.deepEqual(audit.futureDated.map(f => [f.entryNumber, f.amount, f.date]), [[posted.entryNumber, 10000, oldDate.toISOString().slice(0, 10)]]);
  assert.equal(await JournalEntry.countDocuments({ _id: posted._id, date: oldDate }), 1, 'the audit changes nothing');

  const changed = await inTx(session => repairFutureDatedDepreciation({ session }));
  assert.equal(changed.length, 1);
  const fixed = await JournalEntry.findById(posted._id).lean();
  assert.ok(fixed.date <= new Date() && fixed.date >= monthStart);
  assert.deepEqual([fixed.status, fixed.entryNumber, fixed.totalDebit, fixed.lines.length], ['posted', posted.entryNumber, 10000, 2], 'only the date changes');
  const raw = await JournalEntry.collection.findOne({ _id: posted._id });
  assert.equal(raw.dateCorrection.from.toISOString(), oldDate.toISOString(), 'the original date is kept');
  assert.equal((await FixedAsset.findById(asset._id).lean()).depreciations[0].date.toISOString(), fixed.date.toISOString());
  assert.deepEqual(await inTx(session => repairFutureDatedDepreciation({ session })), [], 'idempotent');
  assert.equal((await depreciationEntries()).length, 1, 'no entry created');

  const after = await R('trial-balance');
  assert.equal(rowOf(after, '62000001').periodDebit, 10000);
  assert.ok(after.checks.every(c => c.ok), JSON.stringify(after.checks));
});

test('several assets, intangible amortization and two months: opening, period and closing balances and the date range', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await create(VEHICLE());
  await create(SOFTWARE());
  await depreciate('2026-08');
  await depreciate('2026-09');
  assert.equal((await depreciationEntries()).length, 4);

  const tb = await R('trial-balance', { from: '2026-09-01', to: '2026-09-30' });
  const pick = (code, ...keys) => keys.map(k => rowOf(tb, code)[k]);
  assert.deepEqual(pick('62000001', 'openingDebit', 'periodDebit', 'closingDebit'), [10000, 10000, 20000]);
  assert.deepEqual(pick('62000002', 'openingDebit', 'periodDebit', 'closingDebit'), [1000, 1000, 2000], 'amortization on its own expense account');
  assert.deepEqual(pick('12000099', 'openingCredit', 'periodCredit', 'closingCredit'), [10000, 10000, 20000]);
  assert.deepEqual(pick('13000099', 'openingCredit', 'periodCredit', 'closingCredit'), [1000, 1000, 2000]);
  assert.ok(tb.checks.every(c => c.ok), JSON.stringify(tb.checks));
  assert.equal(tb.summary.find(s => s.key === 'periodDebit').value, 11000);

  assert.equal((await R('profit-loss', { from: '2026-09-01', to: '2026-09-30' })).summary.find(s => s.key === 'expenses').value, 11000);
  assert.equal((await R('profit-loss', { from: '2026-08-01', to: '2026-09-30' })).summary.find(s => s.key === 'expenses').value, 22000);
  const bs = await R('financial-position', { asOf: '2026-09-30' });
  assert.equal(bs.sections[0].rows.find(r => r.name === 'Total Property, Plant & Equipment').amount, 100000);
  assert.equal(bs.sections[0].rows.find(r => r.name === 'Total Intangible Assets').amount, 34000);

  const august = await R('fixed-asset-register', { asOf: '2026-08-31' });
  assert.deepEqual(august.sections[0].rows.map(r => [r.name, r.accumulated, r.netBookValue]).sort(), [['Delivery Truck', 10000, 110000], ['ERP License', 1000, 35000]]);
  const september = await R('fixed-asset-register', { asOf: '2026-09-30' });
  assert.equal(september.summary.find(s => s.key === 'accumulated').value, 22000);
  assert.ok(september.checks.every(c => c.ok), JSON.stringify(september.checks));
  const byAsset = await R('depreciation-by-asset', { from: '2026-08-01', to: '2026-09-30' });
  assert.deepEqual([byAsset.sections[0].rows.length, byAsset.summary.find(s => s.key === 'expense').value], [4, 22000]);

  // GL for the accumulated amortization account agrees with the Trial Balance.
  const gl = await R('general-ledger', { from: '2026-09-01', to: '2026-09-30', account: String(A.accAmort._id) });
  assert.deepEqual(['opening', 'closing'].map(k => gl.summary.find(s => s.key === k).value), [1000, 2000]);
});

test('reversed depreciation nets to zero everywhere, drafts and cancelled entries never count, and the month can be depreciated again', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await create(VEHICLE());
  await depreciate('2026-08');
  const [entry] = await depreciationEntries();
  await callHandler(reverseJournalEntry, { params: { id: String(entry._id) }, body: { reversalDate: '2026-08-31' } });
  // A draft and a cancelled entry on the same accounts.
  for (const status of ['draft', 'cancelled']) {
    await JournalEntry.collection.insertOne({ entryNumber: status === 'draft' ? 900001 : 900002, date: new Date('2026-08-20'), description: status, source: 'manual', status, lines: [{ account: A.depExpense._id, debit: 777, credit: 0, description: status }, { account: A.accDep._id, debit: 0, credit: 777, description: status }], totalDebit: 777, totalCredit: 777 });
  }

  const aug = { from: '2026-08-01', to: '2026-08-31' };
  const tb = await R('trial-balance', aug);
  assert.deepEqual(['periodDebit', 'periodCredit', 'closingDebit', 'closingCredit'].map(k => rowOf(tb, '62000001')[k]), [10000, 10000, 0, 0], 'the account had activity, so it is listed at zero');
  assert.ok(tb.checks.every(c => c.ok));
  assert.equal((await coaBalance(A.depExpense)).balance, 0);
  assert.equal((await R('profit-loss', aug)).summary.find(s => s.key === 'expenses').value, 0);
  const register = await R('fixed-asset-register', { asOf: '2026-08-31' });
  assert.deepEqual([register.sections[0].rows[0].accumulated, register.sections[0].rows[0].netBookValue], [0, 120000]);
  assert.ok(register.checks.every(c => c.ok), JSON.stringify(register.checks));

  await depreciate('2026-08');
  const entries = await depreciationEntries();
  assert.deepEqual(entries.map(e => e.status), ['reversed', 'posted']);
  assert.equal(rowOf(await R('trial-balance', aug), '62000001').closingDebit, 10000);
  assert.equal((await R('fixed-asset-register', { asOf: '2026-08-31' })).sections[0].rows[0].accumulated, 10000);
  assert.deepEqual((await auditDepreciation()).issues, []);
});

test('the audit lists entries that need review and never changes them; zero balances and project attribution', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const asset = await create(VEHICLE());
  await depreciate('2026-08');
  const [entry] = await depreciationEntries();
  // An entry no asset refers to, an asset record whose entry is gone, and a total that disagrees.
  await JournalEntry.collection.insertOne({ entryNumber: 900010, date: new Date('2026-08-31'), description: 'Old import', source: 'automatic', status: 'posted', accountingAction: 'FIXED_ASSET_DEPRECIATION', lines: [{ account: A.depExpense._id, debit: 500, credit: 0 }, { account: A.accDep._id, debit: 0, credit: 500 }], totalDebit: 500, totalCredit: 500 });
  await FixedAsset.collection.updateOne({ _id: asset._id }, { $push: { depreciations: { period: '2026-07', amount: 10000, date: new Date('2026-07-31'), journalEntry: new mongoose.Types.ObjectId() } } });
  const before = await JournalEntry.countDocuments();
  const { issues, futureDated } = await auditDepreciation();
  assert.deepEqual(issues.map(i => i.kind).sort(), ['asset_total_mismatch', 'missing_entry', 'orphan_entry']);
  assert.deepEqual(futureDated, []);
  assert.equal(await JournalEntry.countDocuments(), before);
  assert.equal(await JournalEntry.countDocuments({ _id: entry._id, status: 'posted' }), 1);

  // includeZero lists accounts without activity at zero.
  const tb = await R('trial-balance', { from: '2026-08-01', to: '2026-08-31', includeZero: 'true' });
  assert.deepEqual(['closingDebit', 'closingCredit'].map(k => rowOf(tb, '13000099')[k]), [0, 0]);
  assert.ok(tb.checks.every(c => c.ok));

  // Depreciation charged to a project is that project's indirect cost.
  const project = await Project.create({ projectNumber: 'PRJ001', name: 'Plant', contractValue: 100000, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  await JournalEntry.collection.insertOne({ entryNumber: 900011, date: new Date('2026-08-31'), description: 'Site equipment depreciation', source: 'manual', status: 'posted', project: project._id, lines: [{ account: A.depExpense._id, debit: 2000, credit: 0, project: project._id, projectNumber: 'PRJ001' }, { account: A.accDep._id, debit: 0, credit: 2000, project: project._id, projectNumber: 'PRJ001' }], totalDebit: 2000, totalCredit: 2000 });
  const profit = await R('project-profit-analysis', { from: '2026-08-01', to: '2026-08-31', project: String(project._id) });
  const row = profit.sections[0].rows.find(r => r.projectNumber === 'PRJ001');
  assert.deepEqual([row.totalCost, row.net, row.result], [2000, -2000, 'Loss'], 'the expense - never the accumulated depreciation - is the cost');
  assert.deepEqual(profit.sections[1].rows.filter(r => r.accountCode).map(r => [r.accountCode, r.amount]), [['62000001', 2000]]);
});
