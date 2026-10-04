const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Covers the automatic multi-JE accounting engine (services/accounting/accountingEventService.js) -
// derived from "AUTOMATIC ENTERIES.xlsx" (see scratchpad/automatic-entries-mapping.md). Focuses on
// what's unique to this engine: idempotency per (sourceType, sourceId, accountingAction), one
// business event producing MORE THAN ONE JournalEntry, and that a missing control account aborts
// the whole posting rather than silently completing half of it.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_automatic_accounting';

let JournalEntry;
let ChartOfAccount;
let Project;
let User;
let AdvancedPayment;
let accountingEventService;
let transactionsSupported = true;

let accounts; // code -> ChartOfAccount doc, for every AutomaticJournalAccountCodes/CogsToWipAccountCodeMap entry
let customer, project;

const { AutomaticJournalAccountCodes, CogsToWipAccountCodeMap } = require('../../utils/accountingConstants');

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  AdvancedPayment = require('../../models/payments/advancedPaymentModel');
  accountingEventService = require('../../services/accounting/accountingEventService');

  await Promise.all([JournalEntry.init(), ChartOfAccount.init(), Project.init(), AdvancedPayment.init()]);

  const probeSession = await mongoose.startSession();
  try {
    await probeSession.withTransaction(async () => {
      await mongoose.connection.collection('__txn_probe').insertOne({ ok: 1 }, { session: probeSession });
    });
    await mongoose.connection.collection('__txn_probe').drop().catch(() => {});
  } catch (err) {
    transactionsSupported = false;
  } finally {
    probeSession.endSession();
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([JournalEntry.deleteMany({}), ChartOfAccount.deleteMany({}), Project.deleteMany({}), User.deleteMany({}), AdvancedPayment.deleteMany({})]);

  // Seed every real Chart of Accounts code the engine looks up by code, with the right
  // type/state for each to pass eligibility checks where relevant.
  const cashCode = 'CASH-TEST';
  const codeToType = {
    [AutomaticJournalAccountCodes.customerAdvancesPayable]: 'liability',
    [AutomaticJournalAccountCodes.advanceToSuppliers]: 'asset',
    [AutomaticJournalAccountCodes.materialsInventory]: 'asset',
    [AutomaticJournalAccountCodes.inputVat]: 'asset',
    [AutomaticJournalAccountCodes.suppliers]: 'liability',
    [AutomaticJournalAccountCodes.withholdingTaxPayable]: 'liability',
    [AutomaticJournalAccountCodes.wipRawMaterials]: 'asset',
    [AutomaticJournalAccountCodes.wipLabourWages]: 'asset',
    [AutomaticJournalAccountCodes.wipEngineeringDesign]: 'asset',
    [AutomaticJournalAccountCodes.accountsReceivableProjects]: 'asset',
    [AutomaticJournalAccountCodes.withholdingTaxReceivable]: 'asset',
    [AutomaticJournalAccountCodes.vatPayable]: 'liability',
    [AutomaticJournalAccountCodes.revenue]: 'revenue',
  };

  accounts = {};
  for (const [code, type] of Object.entries(codeToType)) {
    accounts[code] = await ChartOfAccount.create({ code, name: `Account ${code}`, type });
  }
  accounts[cashCode] = await ChartOfAccount.create({ code: cashCode, name: 'Cash', type: 'asset', state: 'cash' });
  accounts.cashCode = cashCode;

  // The 3 real COGS accounts (type 'cogs') CogsToWipAccountCodeMap maps.
  for (const cogsCode of Object.keys(CogsToWipAccountCodeMap)) {
    accounts[cogsCode] = await ChartOfAccount.create({ code: cogsCode, name: `COGS ${cogsCode}`, type: 'cogs' });
  }

  customer = await User.create({ name: 'Engine Test Customer', email: `engine-customer-${Date.now()}@example.com`, role: 'user', type: 'online' });
  project = await Project.create({
    projectNumber: `ENGINE-PRJ-${Date.now()}`,
    contractValue: 1000000,
    customer: customer._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
});

// ===================== Idempotency =====================

test('postAutomaticJournalEntry is idempotent per (sourceType, sourceId, accountingAction) - calling twice creates only one entry', async () => {
  const sourceId = new mongoose.Types.ObjectId();
  const lines = [
    { account: accounts[accounts.cashCode]._id, debit: 500, credit: 0 },
    { account: accounts[AutomaticJournalAccountCodes.customerAdvancesPayable]._id, debit: 0, credit: 500 },
  ];

  const first = await accountingEventService.postAutomaticJournalEntry({
    accountingAction: 'ADVANCE_PAYMENT_RECEIVED_CUSTOMER',
    sourceType: 'ADVANCED_PAYMENT',
    sourceId,
    description: 'test',
    lines,
  });
  const second = await accountingEventService.postAutomaticJournalEntry({
    accountingAction: 'ADVANCE_PAYMENT_RECEIVED_CUSTOMER',
    sourceType: 'ADVANCED_PAYMENT',
    sourceId,
    description: 'test',
    lines,
  });

  assert.equal(first._id.toString(), second._id.toString());
  const count = await JournalEntry.countDocuments({ sourceType: 'ADVANCED_PAYMENT', sourceId });
  assert.equal(count, 1);
});

test('two DIFFERENT accounting actions for the SAME sourceId both post independently (not blocked by the idempotency index)', async () => {
  const sourceId = new mongoose.Types.ObjectId();
  const lineSet = kind => [
    { account: accounts[AutomaticJournalAccountCodes.materialsInventory]._id, debit: kind === 'a' ? 100 : 0, credit: kind === 'a' ? 0 : 100 },
    { account: accounts[AutomaticJournalAccountCodes.suppliers]._id, debit: kind === 'a' ? 0 : 100, credit: kind === 'a' ? 100 : 0 },
  ];

  await accountingEventService.postAutomaticJournalEntry({
    accountingAction: 'PO_INVENTORY_RECEIPT',
    sourceType: 'PO',
    sourceId,
    description: 'receipt',
    lines: lineSet('a'),
  });
  await accountingEventService.postAutomaticJournalEntry({
    accountingAction: 'PO_INVENTORY_TO_WIP',
    sourceType: 'PO',
    sourceId,
    description: 'wip transfer',
    lines: lineSet('b'),
  });

  const entries = await JournalEntry.find({ sourceType: 'PO', sourceId });
  assert.equal(entries.length, 2, 'one PO (one sourceId) legitimately produced two separate JournalEntry documents');
  assert.deepEqual(
    entries.map(e => e.accountingAction).sort(),
    ['PO_INVENTORY_RECEIPT', 'PO_INVENTORY_TO_WIP']
  );
  // Each entry has its own real, distinct entryNumber from the shared counter - never the XLSX's
  // own JV00x labels.
  assert.notEqual(entries[0].entryNumber, entries[1].entryNumber);
});

// ===================== Advanced Payment JEs =====================

test('postAdvancedPaymentJournalEntry (customer): posts Dr Cash / Cr Customer Advances Payable', async () => {
  const advance = await AdvancedPayment.create({
    type: 'customer',
    customer: customer._id,
    project: project._id,
    amount: 5000,
    paymentAccount: accounts[accounts.cashCode]._id,
  });

  const entry = await accountingEventService.postAdvancedPaymentJournalEntry(advance, null);
  assert.ok(entry);
  assert.equal(entry.accountingAction, 'ADVANCE_PAYMENT_RECEIVED_CUSTOMER');
  assert.equal(entry.totalDebit, 5000);
  assert.equal(entry.totalCredit, 5000);

  // JournalEntry.create() doesn't run the find-hook populate, so `lines[].account` is still a raw
  // ObjectId here - compare by id rather than a populated `.code`.
  const cashAccountId = accounts[accounts.cashCode]._id.toString();
  const payableAccountId = accounts[AutomaticJournalAccountCodes.customerAdvancesPayable]._id.toString();
  const cashLine = entry.lines.find(l => l.account.toString() === cashAccountId);
  const payableLine = entry.lines.find(l => l.account.toString() === payableAccountId);
  assert.equal(cashLine.debit, 5000);
  assert.equal(payableLine.credit, 5000);
});

test('postAdvancedPaymentJournalEntry: no-ops (returns null, posts nothing) when the advance has no paymentAccount', async () => {
  const advance = await AdvancedPayment.create({ type: 'customer', customer: customer._id, project: project._id, amount: 2000 });
  const entry = await accountingEventService.postAdvancedPaymentJournalEntry(advance, null);
  assert.equal(entry, null);
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'ADVANCED_PAYMENT', sourceId: advance._id }), 0);
});

// ===================== Purchase Order: product vs. service, single vs. multi-JE =====================

test('postPurchaseOrderJournalEntries: product item with NO project -> only PO_INVENTORY_RECEIPT (no WIP transfer)', async () => {
  const Product = require('../../models/inventory/productModel');
  const product = await Product.create({ type: 'product', title: { en: 'Steel', ar: 'صلب' }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: new mongoose.Types.ObjectId(), subcategory: new mongoose.Types.ObjectId() });

  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-1',
    project: null,
    totalAmount: 1000,
    vatAmount: 140,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: product._id, subtotal: 1000 }],
  };

  const entries = await accountingEventService.postPurchaseOrderJournalEntries(fakePO, null);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].accountingAction, 'PO_INVENTORY_RECEIPT');
  assert.equal(entries[0].totalDebit, entries[0].totalCredit);
  assert.equal(entries[0].totalDebit, 1140); // 1000 inventory + 140 input VAT
});

test('postPurchaseOrderJournalEntries: product item WITH a project -> PO_INVENTORY_RECEIPT + PO_INVENTORY_TO_WIP (two separate JEs)', async () => {
  const Product = require('../../models/inventory/productModel');
  const product = await Product.create({ type: 'product', title: { en: 'Cement', ar: 'أسمنت' }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: new mongoose.Types.ObjectId(), subcategory: new mongoose.Types.ObjectId() });

  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-2',
    project: project._id,
    totalAmount: 2000,
    vatAmount: 0,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: product._id, subtotal: 2000 }],
  };

  const entries = await accountingEventService.postPurchaseOrderJournalEntries(fakePO, null);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map(e => e.accountingAction).sort(),
    ['PO_INVENTORY_RECEIPT', 'PO_INVENTORY_TO_WIP']
  );
  entries.forEach(e => assert.equal(e.project.toString(), project._id.toString()));

  // Calling again for the same PO must not duplicate either entry (idempotency holds for both
  // actions independently).
  const secondPass = await accountingEventService.postPurchaseOrderJournalEntries(fakePO, null);
  assert.equal(secondPass.length, 2);
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'PO', sourceId: fakePO._id }), 2);
});

test('postPurchaseOrderJournalEntries: service item WITH a project and a costAccount -> PO_SERVICE_TO_WIP, Dr the cost account', async () => {
  const Product = require('../../models/inventory/productModel');
  const service = await Product.create({ type: 'service', title: { en: 'Engineering', ar: 'هندسة' }, description: { en: 'd', ar: 'د' }, price: 100, durationValue: 1, durationUnit: 'month' });
  const engineeringCogs = accounts['50000003']; // WIP-Engineering mapped COGS code from CogsToWipAccountCodeMap

  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-3',
    project: project._id,
    totalAmount: 3000,
    vatAmount: 0,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: service._id, subtotal: 3000, costAccount: engineeringCogs._id }],
  };

  const entries = await accountingEventService.postPurchaseOrderJournalEntries(fakePO, null);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].accountingAction, 'PO_SERVICE_TO_WIP');
  const costLine = entries[0].lines.find(l => l.account.toString() === engineeringCogs._id.toString());
  assert.equal(costLine.debit, 3000);
});

test('postPurchaseOrderJournalEntries: service item with a project but NO costAccount throws (never guesses one)', async () => {
  const Product = require('../../models/inventory/productModel');
  const service = await Product.create({ type: 'service', title: { en: 'Labour', ar: 'عمالة' }, description: { en: 'd', ar: 'د' }, price: 100, durationValue: 1, durationUnit: 'month' });

  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-4',
    project: project._id,
    totalAmount: 1000,
    vatAmount: 0,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: service._id, subtotal: 1000 }],
  };

  await assert.rejects(() => accountingEventService.postPurchaseOrderJournalEntries(fakePO, null), /cost \(WIP\) account/);
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'PO', sourceId: fakePO._id }), 0);
});

test('getAccountIdByCode throws (never fabricates an id) when a required control account is missing from the Chart of Accounts', async () => {
  await ChartOfAccount.deleteOne({ code: AutomaticJournalAccountCodes.suppliers });

  const Product = require('../../models/inventory/productModel');
  const product = await Product.create({ type: 'product', title: { en: 'Pipes', ar: 'أنابيب' }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: new mongoose.Types.ObjectId(), subcategory: new mongoose.Types.ObjectId() });
  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-5',
    project: null,
    totalAmount: 500,
    vatAmount: 0,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: product._id, subtotal: 500 }],
  };

  await assert.rejects(() => accountingEventService.postPurchaseOrderJournalEntries(fakePO, null), /was not found\. Posting aborted/);
});

// ===================== Project revenue/cost recognition =====================

test('postProjectExecutionRecognitionJEs: posts PROJECT_REVENUE_RECOGNITION for the incremental executedPercentage share of contractValue', async () => {
  project.executedPercentage = 20;
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null);

  const revenueJE = entries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  assert.ok(revenueJE);
  assert.equal(revenueJE.totalDebit, 200000); // 20% of 1,000,000
  assert.equal(project.revenueRecognizedPercentage, 20);

  // Advancing further only recognizes the DELTA (30% - 20% = 10%), not the full new percentage.
  project.executedPercentage = 30;
  const secondEntries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null);
  const secondRevenueJE = secondEntries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  assert.equal(secondRevenueJE.totalDebit, 100000); // 10% of 1,000,000
});

test('postProjectExecutionRecognitionJEs: posts PROJECT_COST_RECOGNITION Dr COGS / Cr mapped WIP for each averageCostLine, proportional to the delta', async () => {
  const rawMaterialsCogs = accounts['50000001'];
  project.averageCostLines = [{ account: rawMaterialsCogs._id, amount: 500000 }];
  await project.save();

  project.executedPercentage = 10;
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null);
  const costJE = entries.find(e => e.accountingAction === 'PROJECT_COST_RECOGNITION');
  assert.ok(costJE);
  assert.equal(costJE.totalDebit, 50000); // 10% of 500,000
  const wipAccount = accounts[CogsToWipAccountCodeMap[rawMaterialsCogs.code]];
  const cogsLine = costJE.lines.find(l => l.account.toString() === rawMaterialsCogs._id.toString());
  const wipLine = costJE.lines.find(l => l.account.toString() === wipAccount._id.toString());
  assert.equal(cogsLine.debit, 50000);
  assert.equal(wipLine.credit, 50000);
});

test('postProjectExecutionRecognitionJEs: no-ops (returns no entries) when executedPercentage has not increased', async () => {
  project.executedPercentage = 0;
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null);
  assert.equal(entries.length, 0);
});

test('postProjectExecutionRecognitionJEs: revenue recognition no-ops when contractValue is not set (never fabricates a value)', async () => {
  const noContractProject = await Project.create({
    projectNumber: `ENGINE-NOCV-${Date.now()}`,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
    executedPercentage: 50,
  });
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(noContractProject, null);
  assert.equal(entries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION'), undefined);
});

// ===================== Transaction atomicity (requires a real replica set) =====================

test('a failed account lookup mid-posting leaves NO journal entries behind when run inside a real transaction', async t => {
  if (!transactionsSupported) return t.skip('local MongoDB is a standalone instance, not a replica set - transactions unavailable (verified separately against the real Atlas cluster)');

  await ChartOfAccount.deleteOne({ code: AutomaticJournalAccountCodes.withholdingTaxPayable });

  const Product = require('../../models/inventory/productModel');
  const product = await Product.create({ type: 'product', title: { en: 'Wire', ar: 'سلك' }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: new mongoose.Types.ObjectId(), subcategory: new mongoose.Types.ObjectId() });
  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-ATOMIC',
    project: null,
    totalAmount: 1000,
    vatAmount: 0,
    withholdingTaxAmount: 50, // forces a lookup of the now-missing withholdingTaxPayable account
    createdAt: new Date(),
    items: [{ productId: product._id, subtotal: 1000 }],
  };

  const session = await mongoose.startSession();
  await assert.rejects(() =>
    session.withTransaction(async () => {
      await accountingEventService.postPurchaseOrderJournalEntries(fakePO, session);
    })
  );
  session.endSession();

  assert.equal(await JournalEntry.countDocuments({ sourceType: 'PO', sourceId: fakePO._id }), 0);
});
