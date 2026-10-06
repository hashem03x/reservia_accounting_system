const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Covers three additive pieces of this task (docs: "Journal Entry grouping/balance/SO-PO display
// overhaul"):
//   1. The main Journal Entries listing (getJournalEntries) stays one row PER DOCUMENT (never per
//      line) and gets a derived currency/rate/difference per row (journalEntryController.js#withEntryListFields).
//   2. GET journal-entries/sales-order/:id and GET journal-entries/purchase-order/:id
//      (getJournalEntriesForSalesOrder/getJournalEntriesForPurchaseOrder) correctly compose the
//      direct sourceType+sourceId match, the via-Payment match, and (Sales Order only) the
//      triggeredBySalesOrder match - and never return an unrelated entry.
//   3. postAutomaticJournalEntry/postProjectExecutionRecognitionJEs thread an optional
//      triggeredBySalesOrder id onto PROJECT_REVENUE_RECOGNITION/PROJECT_COST_RECOGNITION entries.
//
// Controller handlers are exercised directly with a mock req/res (same technique the existing
// reverseJournalEntryValidators test in journalEntry.test.js uses for validators) - this app's
// test suite tests model/service/controller logic directly rather than through an HTTP+supertest
// layer, so this file follows that same convention.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_je_grouping_sources';

let JournalEntry;
let ChartOfAccount;
let Project;
let User;
let getNextJournalEntryNumber;
let journalEntryController;
let accountingEventService;
let cash, revenue, project;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  ({ getNextJournalEntryNumber } = require('../../services/accounting/journalEntryNumberService'));
  journalEntryController = require('../../controller/accounting/journalEntryController');
  accountingEventService = require('../../services/accounting/accountingEventService');

  await Promise.all([JournalEntry.init(), ChartOfAccount.init(), Project.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await JournalEntry.deleteMany({});
  await ChartOfAccount.deleteMany({});
  await Project.deleteMany({});
  await User.deleteMany({});
  await mongoose.connection.collection('counters').deleteMany({});
  await mongoose.connection.collection('payments').deleteMany({});

  cash = await ChartOfAccount.create({ code: '1000', name: 'Cash', type: 'asset' });
  revenue = await ChartOfAccount.create({ code: '4000', name: 'Revenue', type: 'revenue' });
  // Real account codes postProjectRevenueRecognitionJE looks up via AutomaticJournalAccountCodes
  // (accountingConstants.js) - only needed by the triggeredBySalesOrder-threading tests below, but
  // harmless to always seed (mirrors automaticAccountingEngine.test.js's own seeding convention).
  const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');
  await ChartOfAccount.create({ code: AutomaticJournalAccountCodes.accountsReceivableProjects, name: 'AR Projects', type: 'asset' });
  await ChartOfAccount.create({ code: AutomaticJournalAccountCodes.revenue, name: 'Revenue (Projects)', type: 'revenue' });
  const manager = await User.create({ name: 'PM', email: `pm-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  project = await Project.create({
    projectNumber: `PRJ-${Date.now()}`,
    projectManager: manager._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
});

// Minimal mock req/res - every handler here only ever reads req.params and writes via
// res.status(code).json(body), so this is enough to exercise the real controller code.
function invoke(handler, { params = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { params, query: {}, headers: {} };
    const res = {
      status(code) {
        return {
          json: body => resolve({ code, body }),
        };
      },
    };
    handler(req, res, reject).catch(reject);
  });
}

async function createBalancedEntry(overrides = {}) {
  const entryNumber = await getNextJournalEntryNumber();
  return JournalEntry.create({
    entryNumber,
    status: 'posted',
    project: project._id,
    lines: [
      { account: cash._id, debit: 100, credit: 0 },
      { account: revenue._id, debit: 0, credit: 100 },
    ],
    ...overrides,
  });
}

// ===================== Grouping: one row per DOCUMENT, never per line =====================

test('getJournalEntries: a single entry with many lines is returned as exactly ONE row, never one row per line', async () => {
  const entryNumber = await getNextJournalEntryNumber();
  await JournalEntry.create({
    entryNumber,
    status: 'posted',
    project: project._id,
    lines: [
      { account: cash._id, debit: 25, credit: 0 },
      { account: cash._id, debit: 25, credit: 0 },
      { account: revenue._id, debit: 0, credit: 25 },
      { account: revenue._id, debit: 0, credit: 25 },
    ],
  });

  const { body } = await invoke((req, res) => journalEntryController.getJournalEntries(req, res));
  assert.equal(body.results, 1, 'a 4-line entry must still be exactly one row in the listing');
  assert.equal(body.data[0].lines.length, 4, 'all 4 lines must still be nested under that one row');
});

test('getJournalEntries: two genuinely separate entries are returned as TWO separate rows, never merged', async () => {
  await createBalancedEntry();
  await createBalancedEntry();

  const { body } = await invoke((req, res) => journalEntryController.getJournalEntries(req, res));
  assert.equal(body.results, 2, 'two distinct JournalEntry documents must never be collapsed into one row');
});

test('getJournalEntries: each row carries a derived difference = totalDebit - totalCredit (0 for a valid/balanced entry), never a running balance', async () => {
  await createBalancedEntry();

  const { body } = await invoke((req, res) => journalEntryController.getJournalEntries(req, res));
  assert.equal(body.data[0].difference, 0, 'a valid, balanced entry must show a difference of exactly 0');
  assert.equal(body.data[0].totalDebit, 100);
  assert.equal(body.data[0].totalCredit, 100);
});

test('getJournalEntries: an unbalanced historical entry (bypassing validation) still shows its real nonzero difference, never silently corrected to 0', async () => {
  // Simulates a pre-existing, already-unbalanced record (same raw-insert technique used elsewhere
  // in this suite for legacy documents) - journalEntryController.js must display the true
  // Total Debit - Total Credit, never fabricate a 0 to make the UI look clean.
  const entryNumber = await getNextJournalEntryNumber();
  await mongoose.connection.collection('journalentries').insertOne({
    entryNumber,
    status: 'posted',
    project: project._id,
    totalDebit: 100,
    totalCredit: 40,
    lines: [
      { account: cash._id, debit: 100, credit: 0 },
      { account: revenue._id, debit: 0, credit: 40 },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const { body } = await invoke((req, res) => journalEntryController.getJournalEntries(req, res));
  assert.equal(body.data[0].difference, 60, 'a historical unbalanced entry must show its real difference, not be silently zeroed out');
});

// ===================== Sales Order / Purchase Order JE sections =====================

test('getJournalEntriesForSalesOrder: returns a directly-linked entry (sourceType SO, sourceId = the order id)', async () => {
  const salesOrderId = new mongoose.Types.ObjectId();
  await createBalancedEntry({ sourceType: 'SO', sourceId: salesOrderId, accountingAction: 'SO_CUSTOMER_ADVANCE_APPLIED' });
  // An unrelated entry for a different Sales Order must never show up.
  await createBalancedEntry({ sourceType: 'SO', sourceId: new mongoose.Types.ObjectId(), accountingAction: 'SO_CUSTOMER_ADVANCE_APPLIED' });

  const { body } = await invoke(journalEntryController.getJournalEntriesForSalesOrder, { params: { salesOrderId: salesOrderId.toString() } });
  assert.equal(body.data.length, 1, 'only the entry whose sourceId is THIS sales order must be returned');
  assert.equal(body.data[0].sourceId.toString(), salesOrderId.toString());
});

test('getJournalEntriesForSalesOrder: returns an entry linked via its Payment (sourceType PAYMENT, Payment.salesOrderId = the order id)', async () => {
  const salesOrderId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('payments').insertOne({ _id: paymentId, salesOrderId, type: 'in', amountPaid: 50, paymentCategory: 'sales' });
  await createBalancedEntry({ sourceType: 'PAYMENT', sourceId: paymentId, accountingAction: 'SO_PAYMENT_RECORDED' });

  // A Payment for a DIFFERENT sales order must never leak in.
  const otherPaymentId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('payments').insertOne({ _id: otherPaymentId, salesOrderId: new mongoose.Types.ObjectId(), type: 'in', amountPaid: 50, paymentCategory: 'sales' });
  await createBalancedEntry({ sourceType: 'PAYMENT', sourceId: otherPaymentId, accountingAction: 'SO_PAYMENT_RECORDED' });

  const { body } = await invoke(journalEntryController.getJournalEntriesForSalesOrder, { params: { salesOrderId: salesOrderId.toString() } });
  assert.equal(body.data.length, 1, 'only the Payment-linked entry for THIS sales order must be returned');
  assert.equal(body.data[0].sourceId.toString(), paymentId.toString());
});

test('getJournalEntriesForSalesOrder: returns an entry linked via triggeredBySalesOrder (PROJECT_REVENUE_RECOGNITION, whose sourceId is a project+percentage hash, not the order id)', async () => {
  const salesOrderId = new mongoose.Types.ObjectId();
  await createBalancedEntry({
    sourceType: 'PROJECT',
    sourceId: new mongoose.Types.ObjectId(), // the deterministic hash - deliberately NOT the sales order id
    accountingAction: 'PROJECT_REVENUE_RECOGNITION',
    triggeredBySalesOrder: salesOrderId,
  });
  // A recognition entry triggered by a DIFFERENT sales order must never leak in.
  await createBalancedEntry({
    sourceType: 'PROJECT',
    sourceId: new mongoose.Types.ObjectId(),
    accountingAction: 'PROJECT_REVENUE_RECOGNITION',
    triggeredBySalesOrder: new mongoose.Types.ObjectId(),
  });

  const { body } = await invoke(journalEntryController.getJournalEntriesForSalesOrder, { params: { salesOrderId: salesOrderId.toString() } });
  assert.equal(body.data.length, 1, 'only the recognition entry triggered by THIS sales order must be returned');
  assert.equal(body.data[0].accountingAction, 'PROJECT_REVENUE_RECOGNITION');
  // triggeredBySalesOrder is populated (ref: SalesOrder) and resolves to null since no real
  // SalesOrder document exists for this id in this unit test - the raw-id filter match above (the
  // actual behavior under test) already proves the query is correct regardless of population.
});

test('getJournalEntriesForSalesOrder: combines all three relationships for one order without duplicates, sorted chronologically', async () => {
  const salesOrderId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('payments').insertOne({ _id: paymentId, salesOrderId, type: 'in', amountPaid: 50, paymentCategory: 'sales' });

  await createBalancedEntry({ sourceType: 'SO', sourceId: salesOrderId, accountingAction: 'SO_CUSTOMER_ADVANCE_APPLIED', date: new Date('2026-01-01') });
  await createBalancedEntry({ sourceType: 'PAYMENT', sourceId: paymentId, accountingAction: 'SO_PAYMENT_RECORDED', date: new Date('2026-01-02') });
  await createBalancedEntry({
    sourceType: 'PROJECT',
    sourceId: new mongoose.Types.ObjectId(),
    accountingAction: 'PROJECT_REVENUE_RECOGNITION',
    triggeredBySalesOrder: salesOrderId,
    date: new Date('2026-01-03'),
  });

  const { body } = await invoke(journalEntryController.getJournalEntriesForSalesOrder, { params: { salesOrderId: salesOrderId.toString() } });
  assert.equal(body.data.length, 3, 'a single Sales Order can legitimately surface multiple distinct JEs - none should be dropped or duplicated');
  const dates = body.data.map(e => new Date(e.date).toISOString().slice(0, 10));
  assert.deepEqual(dates, ['2026-01-01', '2026-01-02', '2026-01-03'], 'results must be sorted chronologically');
});

test('getJournalEntriesForPurchaseOrder: combines the direct and via-Payment relationships, with no PROJECT-hash equivalent', async () => {
  const purchaseOrderId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('payments').insertOne({ _id: paymentId, purchaseOrderId, type: 'out', amountPaid: 50, paymentCategory: 'purchase' });

  await createBalancedEntry({ sourceType: 'PO', sourceId: purchaseOrderId, accountingAction: 'PO_INVENTORY_RECEIPT', date: new Date('2026-02-01') });
  await createBalancedEntry({ sourceType: 'PO', sourceId: purchaseOrderId, accountingAction: 'PO_INVENTORY_TO_WIP', date: new Date('2026-02-02') });
  await createBalancedEntry({ sourceType: 'PAYMENT', sourceId: paymentId, accountingAction: 'PO_PAYMENT_RECORDED', date: new Date('2026-02-03') });
  // Unrelated PO entry must never leak in.
  await createBalancedEntry({ sourceType: 'PO', sourceId: new mongoose.Types.ObjectId(), accountingAction: 'PO_INVENTORY_RECEIPT' });

  const { body } = await invoke(journalEntryController.getJournalEntriesForPurchaseOrder, { params: { purchaseOrderId: purchaseOrderId.toString() } });
  assert.equal(body.data.length, 3, 'a PO generating multiple JEs (e.g. JV003+JV004+JV007) must surface all of them, separately, without flattening their lines together');
});

// ===================== triggeredBySalesOrder threading =====================

test('postProjectExecutionRecognitionJEs: threads an optional triggeredBySalesOrder id onto the PROJECT_REVENUE_RECOGNITION entry', async () => {
  const fakeSalesOrderId = new mongoose.Types.ObjectId();
  project.contractValue = 1000000;
  project.executedPercentage = 20;

  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null, fakeSalesOrderId);
  const revenueJE = entries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  assert.ok(revenueJE);
  assert.equal(revenueJE.triggeredBySalesOrder.toString(), fakeSalesOrderId.toString());
  // sourceId must stay the deterministic project+percentage hash - never overwritten with the
  // Sales Order's real id, which would break the once-per-percentage idempotency key.
  assert.notEqual(revenueJE.sourceId.toString(), fakeSalesOrderId.toString());
});

test('postProjectExecutionRecognitionJEs: triggeredBySalesOrder defaults to null (e.g. a contractValue-driven recalculation with no specific triggering order)', async () => {
  project.contractValue = 1000000;
  project.executedPercentage = 20;

  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null);
  const revenueJE = entries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  assert.ok(revenueJE);
  assert.equal(revenueJE.triggeredBySalesOrder, null);
});
