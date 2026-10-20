const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Historical remediation (Reservia ERP task "Fix PUC Inventory Consumption & Mandatory Sub-Account
// Assignment", Task 4): services/accounting/subAccountRepairService.js diagnoses journal entry
// lines on a customer/vendor control account whose Sub Account is missing, the wrong kind, or
// unknown, and auto-fixes ONLY the missing+unambiguous-evidence case.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_sub_account_repair';

let JournalEntry, ChartOfAccount, User, Vendor, SalesOrder, Product;
let diagnoseUnassignedSubAccounts, applySubAccountRepairs;
let getNextJournalEntryNumber;

let accounts, customerA, customerB, vendor, project;

const { AutomaticJournalAccountCodes: C } = require('../../utils/accountingConstants');

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  SalesOrder = require('../../models/sales/salesOrderModel');
  Product = require('../../models/inventory/productModel');
  ({ diagnoseUnassignedSubAccounts, applySubAccountRepairs } = require('../../services/accounting/subAccountRepairService'));
  ({ getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService'));
  await Promise.all([JournalEntry.init(), ChartOfAccount.init(), SalesOrder.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const Project = require('../../models/project/projectModel');

beforeEach(async () => {
  await Promise.all([JournalEntry.deleteMany({}), ChartOfAccount.deleteMany({}), User.deleteMany({}), Vendor.deleteMany({}), SalesOrder.deleteMany({}), Product.deleteMany({}), Project.deleteMany({})]);
  accounts = {};
  accounts.cash = await ChartOfAccount.create({ code: 'CASH-REPAIR-TEST', name: 'Cash', type: 'asset', state: 'cash' });
  accounts[C.accountsReceivableProjects] = await ChartOfAccount.create({ code: C.accountsReceivableProjects, name: 'Accounts Receivable (Projects)', type: 'asset' });
  accounts[C.customerAdvancesPayable] = await ChartOfAccount.create({ code: C.customerAdvancesPayable, name: 'Advances from Customers', type: 'liability' });
  accounts[C.suppliers] = await ChartOfAccount.create({ code: C.suppliers, name: 'Suppliers', type: 'liability' });
  accounts[C.advanceToSuppliers] = await ChartOfAccount.create({ code: C.advanceToSuppliers, name: 'Advances to Suppliers', type: 'asset' });

  customerA = await User.create({ name: 'Repair Customer A', email: `repair-a-${Date.now()}@example.com`, role: 'user', type: 'online' });
  customerB = await User.create({ name: 'Repair Customer B', email: `repair-b-${Date.now()}@example.com`, role: 'user', type: 'online' });
  vendor = await Vendor.create({ name: 'Repair Vendor', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  project = await Project.create({
    projectNumber: `REPAIR-${Date.now()}`,
    contractValue: 1000000,
    customer: customerA._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
});

// Simulates a genuinely historical entry, created before the Sub Account rule existed - the same
// `$locals.historicalImport` escape hatch journalEntryModel.js RULE 5 and scripts/*.js remediation
// tooling already use on purpose.
async function createHistoricalEntry(data) {
  const entryNumber = await getNextJournalEntryNumber();
  const entry = new JournalEntry({ entryNumber, status: 'posted', ...data });
  entry.$locals.historicalImport = true;
  await entry.save();
  return entry;
}

test('a missing Sub Account resolvable via the entry\'s own source document (Sales Order -> customer) is auto-fixable', async () => {
  const salesOrder = await SalesOrder.create({ customer: customerA._id, orderSource: 'cashier', project: project._id, items: [] });
  const entry = await createHistoricalEntry({
    source: 'automatic',
    sourceType: 'SO',
    sourceId: salesOrder._id,
    accountingAction: 'SO_PAYMENT_RECORDED',
    project: project._id,
    lines: [
      { account: accounts.cash._id, description: 'x', debit: 1000, credit: 0, project: project._id, projectNumber: project.projectNumber },
      { account: accounts[C.accountsReceivableProjects]._id, description: 'x', debit: 0, credit: 1000, project: project._id, projectNumber: project.projectNumber },
    ],
  });

  const { autoFixable, review } = await diagnoseUnassignedSubAccounts();
  assert.equal(review.length, 0);
  assert.equal(autoFixable.length, 1);
  assert.equal(autoFixable[0].entryNumber, entry.entryNumber);
  assert.equal(autoFixable[0].resolvedNumber, customerA.customerNumber);
  assert.equal(autoFixable[0].evidence, 'source_document');
  assert.equal(autoFixable[0].amount, 1000);
});

test('a missing Sub Account resolvable via a paired control-account line in the same entry (the real "both lines, one party" bug) is auto-fixable', async () => {
  // No sourceType/sourceId at all - the ONLY evidence is the sibling Advances-from-Customers line,
  // which is correctly stamped with the real customer.
  const entry = await createHistoricalEntry({
    source: 'automatic',
    accountingAction: 'PO_SUPPLIER_ADVANCE_APPLIED',
    lines: [
      { account: accounts[C.customerAdvancesPayable]._id, description: 'x', debit: 500, credit: 0, partyNumber: customerA.customerNumber, partyType: 'customer' },
      { account: accounts[C.accountsReceivableProjects]._id, description: 'x', debit: 0, credit: 500 },
    ],
  });

  const { autoFixable, review } = await diagnoseUnassignedSubAccounts();
  assert.equal(review.length, 0);
  assert.equal(autoFixable.length, 1);
  assert.equal(autoFixable[0].entryNumber, entry.entryNumber);
  assert.equal(autoFixable[0].resolvedNumber, customerA.customerNumber);
  assert.equal(autoFixable[0].evidence, 'paired_line');
});

test('conflicting evidence (source document names one customer, paired line names another) is left for manual review, never guessed', async () => {
  const salesOrder = await SalesOrder.create({ customer: customerB._id, orderSource: 'cashier', project: project._id, items: [] });
  const entry = await createHistoricalEntry({
    source: 'automatic',
    sourceType: 'SO',
    sourceId: salesOrder._id,
    accountingAction: 'SO_PAYMENT_RECORDED',
    project: project._id,
    lines: [
      { account: accounts[C.customerAdvancesPayable]._id, description: 'x', debit: 300, credit: 0, partyNumber: customerA.customerNumber, partyType: 'customer', project: project._id, projectNumber: project.projectNumber },
      { account: accounts[C.accountsReceivableProjects]._id, description: 'x', debit: 0, credit: 300, project: project._id, projectNumber: project.projectNumber },
    ],
  });

  const { autoFixable, review } = await diagnoseUnassignedSubAccounts();
  assert.equal(autoFixable.length, 0);
  const found = review.find(r => r.entryNumber === entry.entryNumber);
  assert.ok(found, 'left for review');
  assert.equal(found.kind, 'missing');
  assert.match(found.reason, /ambiguous/);
});

test('a missing Sub Account with no evidence at all is left for manual review, never guessed', async () => {
  const entry = await createHistoricalEntry({
    source: 'automatic',
    lines: [
      { account: accounts.cash._id, description: 'x', debit: 200, credit: 0 },
      { account: accounts[C.suppliers]._id, description: 'x', debit: 0, credit: 200 },
    ],
  });

  const { autoFixable, review } = await diagnoseUnassignedSubAccounts();
  assert.equal(autoFixable.length, 0);
  const found = review.find(r => r.entryNumber === entry.entryNumber);
  assert.ok(found);
  assert.equal(found.kind, 'missing');
  assert.equal(found.requiredType, 'vendor');
});

test('a wrong-kind Sub Account (vendor stamped on a customer control account) is left for review, never silently overwritten', async () => {
  const entry = await createHistoricalEntry({
    source: 'automatic',
    lines: [
      { account: accounts.cash._id, description: 'x', debit: 400, credit: 0 },
      { account: accounts[C.accountsReceivableProjects]._id, description: 'x', debit: 0, credit: 400, partyNumber: vendor.vendorNumber, partyType: 'vendor' },
    ],
  });

  const { autoFixable, review } = await diagnoseUnassignedSubAccounts();
  assert.equal(autoFixable.length, 0);
  const found = review.find(r => r.entryNumber === entry.entryNumber);
  assert.ok(found);
  assert.equal(found.kind, 'wrong_type');
  assert.equal(found.existingPartyNumber, vendor.vendorNumber);
});

test('a Sub Account number that does not correspond to any real party is left for review as unknown, never touched', async () => {
  const entry = await createHistoricalEntry({
    source: 'automatic',
    lines: [
      { account: accounts.cash._id, description: 'x', debit: 150, credit: 0 },
      { account: accounts[C.suppliers]._id, description: 'x', debit: 0, credit: 150, partyNumber: 999999, partyType: 'vendor' },
    ],
  });

  const { autoFixable, review } = await diagnoseUnassignedSubAccounts();
  assert.equal(autoFixable.length, 0);
  const found = review.find(r => r.entryNumber === entry.entryNumber);
  assert.ok(found);
  assert.equal(found.kind, 'unknown_number');
  assert.equal(found.existingPartyNumber, 999999);
});

test('diagnosis alone never writes anything (dry-run)', async () => {
  const salesOrder = await SalesOrder.create({ customer: customerA._id, orderSource: 'cashier', project: project._id, items: [] });
  await createHistoricalEntry({
    source: 'automatic',
    sourceType: 'SO',
    sourceId: salesOrder._id,
    accountingAction: 'SO_PAYMENT_RECORDED',
    project: project._id,
    lines: [
      { account: accounts.cash._id, description: 'x', debit: 1000, credit: 0, project: project._id, projectNumber: project.projectNumber },
      { account: accounts[C.accountsReceivableProjects]._id, description: 'x', debit: 0, credit: 1000, project: project._id, projectNumber: project.projectNumber },
    ],
  });

  await diagnoseUnassignedSubAccounts();
  const raw = await JournalEntry.collection.findOne({ accountingAction: 'SO_PAYMENT_RECORDED' });
  assert.equal(raw.lines[1].partyNumber ?? null, null, 'still untouched - diagnosis never writes');
});

test('applying the auto-fixable plan writes ONLY partyNumber/partyType, touches nothing else, and a re-run finds nothing left (idempotent)', async () => {
  const salesOrder = await SalesOrder.create({ customer: customerA._id, orderSource: 'cashier', project: project._id, items: [] });
  await createHistoricalEntry({
    source: 'automatic',
    sourceType: 'SO',
    sourceId: salesOrder._id,
    accountingAction: 'SO_PAYMENT_RECORDED',
    project: project._id,
    lines: [
      { account: accounts.cash._id, description: 'x', debit: 1000, credit: 0, project: project._id, projectNumber: project.projectNumber },
      { account: accounts[C.accountsReceivableProjects]._id, description: 'x', debit: 0, credit: 1000, project: project._id, projectNumber: project.projectNumber },
    ],
  });

  const before = await JournalEntry.collection.findOne({ accountingAction: 'SO_PAYMENT_RECORDED' });
  const { autoFixable } = await diagnoseUnassignedSubAccounts();
  const results = await applySubAccountRepairs(autoFixable);
  assert.equal(results.length, 1);
  assert.equal(results[0].applied, true);

  const after = await JournalEntry.collection.findOne({ accountingAction: 'SO_PAYMENT_RECORDED' });
  assert.equal(after.lines[1].partyNumber, customerA.customerNumber);
  assert.equal(after.lines[1].partyType, 'customer');
  // Nothing else on either line changed.
  assert.equal(after.lines[0].debit, before.lines[0].debit);
  assert.equal(after.lines[1].credit, before.lines[1].credit);
  assert.equal(String(after.lines[1].account), String(before.lines[1].account));
  assert.equal(after.status, before.status);

  const second = await diagnoseUnassignedSubAccounts();
  assert.equal(second.autoFixable.length, 0, 'nothing left to fix');
  assert.equal(second.review.length, 0);
});

test('a line fixed by something else between diagnosis and apply is skipped, never clobbered', async () => {
  const salesOrder = await SalesOrder.create({ customer: customerA._id, orderSource: 'cashier', project: project._id, items: [] });
  const entry = await createHistoricalEntry({
    source: 'automatic',
    sourceType: 'SO',
    sourceId: salesOrder._id,
    accountingAction: 'SO_PAYMENT_RECORDED',
    project: project._id,
    lines: [
      { account: accounts.cash._id, description: 'x', debit: 1000, credit: 0, project: project._id, projectNumber: project.projectNumber },
      { account: accounts[C.accountsReceivableProjects]._id, description: 'x', debit: 0, credit: 1000, project: project._id, projectNumber: project.projectNumber },
    ],
  });

  const { autoFixable } = await diagnoseUnassignedSubAccounts();
  assert.equal(autoFixable.length, 1);

  // Someone/something else assigns a DIFFERENT (still real) customer to this line first.
  await JournalEntry.collection.updateOne({ _id: entry._id }, { $set: { 'lines.1.partyNumber': customerB.customerNumber, 'lines.1.partyType': 'customer' } });

  const results = await applySubAccountRepairs(autoFixable);
  assert.equal(results[0].applied, false, 'the re-check filter sees it is no longer missing and skips it');

  const after = await JournalEntry.collection.findOne({ _id: entry._id });
  assert.equal(after.lines[1].partyNumber, customerB.customerNumber, 'the concurrent assignment is preserved, never overwritten');
});
