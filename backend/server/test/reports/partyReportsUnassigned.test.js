const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Reservia ERP task "Fix PUC Inventory Consumption & Mandatory Sub-Account Assignment", Task 5:
// Customer/Vendor Balances and Aging must never hide an "Unassigned" row as a cosmetic fix, but
// also must not leave it unexplained - services/reports/partyReports.js now annotates it with how
// much is resolvable automatically (same shared resolver as the historical repair script,
// services/accounting/subAccountRepairService.js) versus genuinely needs manual review, without
// changing any row, total or reconciliation check.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_party_reports_unassigned';

let JournalEntry, ChartOfAccount, User, Vendor, SalesOrder, Product, Project;
let R;
let A = {};
let customer, project;
let entryNo = 700000;
const id = () => new mongoose.Types.ObjectId();

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  SalesOrder = require('../../models/sales/salesOrderModel');
  Product = require('../../models/inventory/productModel');
  Project = require('../../models/project/projectModel');
  const { REPORTS_BY_KEY } = require('../../services/reports/reportRegistry');
  R = Object.fromEntries([...REPORTS_BY_KEY].map(([k, r]) => [k, r.run]));
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function resetFixtures() {
  await Promise.all([JournalEntry.deleteMany({}), ChartOfAccount.deleteMany({}), User.deleteMany({}), Vendor.deleteMany({}), SalesOrder.deleteMany({}), Product.deleteMany({}), Project.deleteMany({})]);
  const { AutomaticJournalAccountCodes: CODES } = require('../../utils/accountingConstants');
  A = {};
  A.bank = await ChartOfAccount.create({ code: 'BANK-UNA', name: 'Bank', type: 'asset' });
  A.ar = await ChartOfAccount.create({ code: CODES.accountsReceivableProjects, name: 'Accounts Receivable (Projects)', type: 'asset' });
  A.custAdv = await ChartOfAccount.create({ code: CODES.customerAdvancesPayable, name: 'Advances from Customers', type: 'liability' });
  customer = await User.create({ name: 'Unassigned Test Customer', email: `una-${Date.now()}@example.com`, role: 'user', type: 'online' });
  project = await Project.create({ projectNumber: `UNA-${Date.now()}`, contractValue: 1000000, customer: customer._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
}

function line(accountKey, debit, credit, extra = {}) {
  return { account: A[accountKey]._id, debit, credit, ...extra };
}

async function postRaw(date, lines, extra = {}) {
  entryNo += 1;
  const doc = { _id: id(), entryNumber: entryNo, date: new Date(date), description: `Entry ${entryNo}`, status: 'posted', source: 'automatic', lines, totalDebit: lines.reduce((s, l) => s + l.debit, 0), totalCredit: lines.reduce((s, l) => s + l.credit, 0), ...extra };
  await JournalEntry.collection.insertOne(doc);
  return doc;
}

test('an AR line missing its Sub Account, resolvable via the Sales Order, is counted in Unassigned AND flagged as auto-resolvable - without changing any total', async () => {
  await resetFixtures();
  const salesOrder = await SalesOrder.create({ customer: customer._id, orderSource: 'cashier', project: project._id, items: [] });
  // No partyNumber/partyType on the AR line - the only evidence is the Sales Order's own customer.
  await postRaw('2026-03-01T10:00:00Z', [line('bank', 1000, 0), line('ar', 0, 1000)], { accountingAction: 'SO_PAYMENT_RECORDED', sourceType: 'SO', sourceId: salesOrder._id });

  const result = await R['customer-balances']({ from: '2026-01-01', to: '2026-12-31' });
  const unassignedRow = result.sections[0].rows.find(r => r.partyNumber == null);
  assert.ok(unassignedRow, 'the line is still counted as Unassigned - never silently reattributed in the report itself');
  assert.equal(unassignedRow.credit, 1000);

  const sums = result.sections[0].totals;
  assert.equal(sums.credit, 1000, 'totals are untouched by the annotation');

  const unassignedNote = result.notes.find(n => n.en?.includes('can be resolved automatically'));
  assert.ok(unassignedNote, 'a note explains how much of Unassigned is resolvable');
  assert.match(unassignedNote.en, /1000 \(1 line\(s\)\) can be resolved automatically/);
  assert.match(unassignedNote.en, /db:repair-sub-accounts/);
});

test('no Unassigned rows at all -> no breakdown note is added', async () => {
  await resetFixtures();
  await postRaw('2026-03-01T10:00:00Z', [line('bank', 500, 0), line('ar', 0, 500, { partyNumber: customer.customerNumber, partyType: 'customer' })]);

  const result = await R['customer-balances']({ from: '2026-01-01', to: '2026-12-31' });
  assert.equal(result.sections[0].rows.some(r => r.partyNumber == null), false);
  assert.equal(result.notes.some(n => n.en?.includes('can be resolved automatically')), false);
});

test('Aging gets the same breakdown note for an Unassigned open item resolvable via the Sales Order', async () => {
  await resetFixtures();
  const salesOrder = await SalesOrder.create({ customer: customer._id, orderSource: 'cashier', project: project._id, items: [] });
  await postRaw('2026-03-01T10:00:00Z', [line('ar', 2000, 0), line('bank', 0, 2000)], { accountingAction: 'SO_PAYMENT_RECORDED', sourceType: 'SO', sourceId: salesOrder._id });

  const result = await R['customer-aging']({ asOf: '2026-06-30' });
  const unassignedRow = result.sections[0].rows.find(r => r.partyNumber == null);
  assert.ok(unassignedRow);
  assert.equal(unassignedRow.outstanding, 2000);

  const unassignedNote = result.notes.find(n => n.en?.includes('can be resolved automatically'));
  assert.ok(unassignedNote);
  assert.match(unassignedNote.en, /2000 \(1 line\(s\)\) can be resolved automatically/);
});
