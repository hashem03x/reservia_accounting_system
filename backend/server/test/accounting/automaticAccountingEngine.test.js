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
let Vendor;
let AdvancedPayment;
let SalesOrder;
let accountingEventService;
let transactionsSupported = true;

let accounts; // code -> ChartOfAccount doc, for every AutomaticJournalAccountCodes entry + the COGS accounts below
let customer, vendor, project;

const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');

// Real COGS accounts (type 'cogs') from the Chart of Accounts, used as Project Average Cost lines.
const COGS_CODES = ['50000001', '50000002', '50000003', '50000004'];

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  AdvancedPayment = require('../../models/payments/advancedPaymentModel');
  SalesOrder = require('../../models/sales/salesOrderModel');
  require('../../models/inventory/productModel');
  accountingEventService = require('../../services/accounting/accountingEventService');

  await Promise.all([JournalEntry.init(), ChartOfAccount.init(), Project.init(), AdvancedPayment.init(), Vendor.init(), SalesOrder.init()]);

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
  await Promise.all([JournalEntry.deleteMany({}), ChartOfAccount.deleteMany({}), Project.deleteMany({}), User.deleteMany({}), Vendor.deleteMany({}), AdvancedPayment.deleteMany({}), SalesOrder.deleteMany({})]);

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

  for (const cogsCode of COGS_CODES) {
    accounts[cogsCode] = await ChartOfAccount.create({ code: cogsCode, name: `COGS ${cogsCode}`, type: 'cogs' });
  }

  customer = await User.create({ name: 'Engine Test Customer', email: `engine-customer-${Date.now()}@example.com`, role: 'user', type: 'online' });
  vendor = await Vendor.create({ name: 'Engine Test Vendor', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
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
    project: project._id,
    lines: lineSet('a'),
  });
  await accountingEventService.postAutomaticJournalEntry({
    accountingAction: 'PO_INVENTORY_TO_WIP',
    sourceType: 'PO',
    sourceId,
    description: 'wip transfer',
    project: project._id,
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
  assert.equal(payableLine.partyNumber, customer.customerNumber, 'the Customer Number must be on the Customer Advances Payable line');
  assert.equal(payableLine.partyType, 'customer');
  assert.equal(cashLine.partyNumber, null, 'the Cash line must never also carry the Sub Account');
  assert.equal(entry.module, 'Advanced Payment');
});

test('postAdvancedPaymentJournalEntry (vendor): posts Dr Advance to Suppliers / Cr Cash, carries the Vendor Number AND the project when one is attached', async () => {
  const advance = await AdvancedPayment.create({
    type: 'vendor',
    vendor: vendor._id,
    project: project._id,
    amount: 8000,
    paymentAccount: accounts[accounts.cashCode]._id,
  });

  const entry = await accountingEventService.postAdvancedPaymentJournalEntry(advance, null);
  assert.ok(entry);
  assert.equal(entry.accountingAction, 'ADVANCE_PAYMENT_PAID_VENDOR');
  // Regression test for the project bug fix: this used to be hardcoded to `null` unconditionally,
  // silently discarding the advance's real project reference.
  assert.equal(entry.project.toString(), project._id.toString());

  const cashAccountId = accounts[accounts.cashCode]._id.toString();
  const advanceToSuppliersId = accounts[AutomaticJournalAccountCodes.advanceToSuppliers]._id.toString();
  const advanceLine = entry.lines.find(l => l.account.toString() === advanceToSuppliersId);
  const cashLine = entry.lines.find(l => l.account.toString() === cashAccountId);
  assert.equal(advanceLine.debit, 8000);
  assert.equal(cashLine.credit, 8000);
  assert.equal(advanceLine.partyNumber, vendor.vendorNumber);
  assert.equal(advanceLine.partyType, 'vendor');
  assert.equal(cashLine.partyNumber, null);
});

test('postPaymentCustomerAdvanceAppliedJE: posts Dr Customer Advances Payable / Cr Accounts Receivable - Projects, sourced from PAYMENT not SO', async () => {
  const fakePayment = { _id: new mongoose.Types.ObjectId(), customerId: customer._id, createdAt: new Date(), notes: 'Partial advance draw-down' };

  const entry = await accountingEventService.postPaymentCustomerAdvanceAppliedJE(fakePayment, 7500, project._id, null);
  assert.ok(entry);
  assert.equal(entry.accountingAction, 'PAYMENT_CUSTOMER_ADVANCE_APPLIED');
  assert.equal(entry.sourceType, 'PAYMENT');
  assert.equal(entry.sourceId.toString(), fakePayment._id.toString());
  assert.equal(entry.totalDebit, 7500);
  assert.equal(entry.totalCredit, 7500);

  const payableAccountId = accounts[AutomaticJournalAccountCodes.customerAdvancesPayable]._id.toString();
  const arAccountId = accounts[AutomaticJournalAccountCodes.accountsReceivableProjects]._id.toString();
  const payableLine = entry.lines.find(l => l.account.toString() === payableAccountId);
  const arLine = entry.lines.find(l => l.account.toString() === arAccountId);
  assert.equal(payableLine.debit, 7500);
  assert.equal(arLine.credit, 7500);
  assert.equal(payableLine.partyNumber, customer.customerNumber, 'the Customer Number must be stamped on the control-account line itself, not just resolvable at read time');
  assert.equal(payableLine.partyType, 'customer');
  assert.equal(arLine.partyNumber, null, 'the OTHER line of the same entry must never also carry the Sub Account');
});

test('postPaymentCustomerAdvanceAppliedJE: rejects when the payment has no resolvable customer', async () => {
  const fakePayment = { _id: new mongoose.Types.ObjectId(), createdAt: new Date() };
  await assert.rejects(
    () => accountingEventService.postPaymentCustomerAdvanceAppliedJE(fakePayment, 1000, project._id, null),
    /customer.*missing or invalid/i
  );
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'PAYMENT', sourceId: fakePayment._id }), 0);
});

test('postPaymentVendorAdvanceAppliedJE: posts Dr Suppliers / Cr Advance to Suppliers, sourced from PAYMENT not PO', async () => {
  const fakePayment = { _id: new mongoose.Types.ObjectId(), vendorId: vendor._id, createdAt: new Date(), notes: null };

  const entry = await accountingEventService.postPaymentVendorAdvanceAppliedJE(fakePayment, 4000, project._id, null);
  assert.ok(entry);
  assert.equal(entry.accountingAction, 'PAYMENT_VENDOR_ADVANCE_APPLIED');
  assert.equal(entry.sourceType, 'PAYMENT');
  assert.equal(entry.sourceId.toString(), fakePayment._id.toString());
  assert.equal(entry.project.toString(), project._id.toString(), 'the originating Purchase Order project must flow through, never hardcoded to null');

  const suppliersAccountId = accounts[AutomaticJournalAccountCodes.suppliers]._id.toString();
  const advanceToSuppliersAccountId = accounts[AutomaticJournalAccountCodes.advanceToSuppliers]._id.toString();
  const suppliersLine = entry.lines.find(l => l.account.toString() === suppliersAccountId);
  const advanceLine = entry.lines.find(l => l.account.toString() === advanceToSuppliersAccountId);
  assert.equal(suppliersLine.debit, 4000);
  assert.equal(advanceLine.credit, 4000);
  assert.equal(suppliersLine.partyNumber, vendor.vendorNumber);
  assert.equal(suppliersLine.partyType, 'vendor');
  assert.equal(advanceLine.partyNumber, null);
});

test('postPaymentVendorAdvanceAppliedJE: rejects when the payment has no resolvable vendor', async () => {
  const fakePayment = { _id: new mongoose.Types.ObjectId(), createdAt: new Date() };
  await assert.rejects(
    () => accountingEventService.postPaymentVendorAdvanceAppliedJE(fakePayment, 1000, project._id, null),
    /vendor.*missing or invalid/i
  );
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'PAYMENT', sourceId: fakePayment._id }), 0);
});

test('postAdvancedPaymentJournalEntry: no-ops (returns null, posts nothing) for a legacy advance with no paymentAccount', async () => {
  // paymentAccount is required for every NEW advance (advancedPaymentModel.js), so this can no
  // longer be simulated via AdvancedPayment.create() - a plain mock object (mirroring this file's
  // `fakePO` convention) simulates a genuinely pre-existing document from before that field
  // existed/became required, the exact case this no-op guards against. The service function only
  // ever reads plain fields off whatever it's given, so a real Mongoose document isn't required.
  const fakeAdvance = {
    _id: new mongoose.Types.ObjectId(),
    type: 'customer',
    customer: customer._id,
    project: project._id,
    amount: 2000,
    createdAt: new Date(),
  };

  const entry = await accountingEventService.postAdvancedPaymentJournalEntry(fakeAdvance, null);
  assert.equal(entry, null);
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'ADVANCED_PAYMENT', sourceId: fakeAdvance._id }), 0);
});

// ===================== Purchase Order: product vs. service, single vs. multi-JE =====================

test('postPurchaseOrderJournalEntries: a product PO with NO project is rejected (PO_INVENTORY_RECEIPT is project-related) and posts nothing', async () => {
  const Product = require('../../models/inventory/productModel');
  const product = await Product.create({ type: 'product', title: { en: 'Steel No Project', ar: 'صلب بدون مشروع' }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: new mongoose.Types.ObjectId(), subcategory: new mongoose.Types.ObjectId() });
  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-NO-PROJECT',
    vendorId: vendor._id,
    project: null,
    totalAmount: 1000,
    vatAmount: 0,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: product._id, subtotal: 1000 }],
  };

  await assert.rejects(() => accountingEventService.postPurchaseOrderJournalEntries(fakePO, null), /Project is required for this automatic Journal Entry \(PO_INVENTORY_RECEIPT\)/);
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'PO', sourceId: fakePO._id }), 0);
});

test('postPurchaseOrderJournalEntries: product item -> PO_INVENTORY_RECEIPT carries the Vendor Number on the Suppliers line only', async () => {
  const Product = require('../../models/inventory/productModel');
  const product = await Product.create({ type: 'product', title: { en: 'Steel', ar: 'صلب' }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: new mongoose.Types.ObjectId(), subcategory: new mongoose.Types.ObjectId() });

  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-1',
    vendorId: vendor._id,
    project: project._id,
    totalAmount: 1000,
    vatAmount: 140,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: product._id, subtotal: 1000 }],
  };

  const entries = await accountingEventService.postPurchaseOrderJournalEntries(fakePO, null);
  assert.equal(entries[0].accountingAction, 'PO_INVENTORY_RECEIPT');
  assert.equal(entries[0].totalDebit, entries[0].totalCredit);
  assert.equal(entries[0].totalDebit, 1140); // 1000 inventory + 140 input VAT

  const suppliersAccountId = accounts[AutomaticJournalAccountCodes.suppliers]._id.toString();
  const suppliersLine = entries[0].lines.find(l => l.account.toString() === suppliersAccountId);
  assert.equal(suppliersLine.partyNumber, vendor.vendorNumber, 'the Vendor Number must be on the Suppliers control-account line');
  assert.equal(suppliersLine.partyType, 'vendor');
  const inventoryLine = entries[0].lines.find(l => l.account.toString() === accounts[AutomaticJournalAccountCodes.materialsInventory]._id.toString());
  assert.equal(inventoryLine.partyNumber, null, 'the Inventory line must never also carry the Vendor Number');
});

test('postPurchaseOrderJournalEntries: product item WITH a project -> PO_INVENTORY_RECEIPT + PO_INVENTORY_TO_WIP (two separate JEs)', async () => {
  const Product = require('../../models/inventory/productModel');
  const product = await Product.create({ type: 'product', title: { en: 'Cement', ar: 'أسمنت' }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: new mongoose.Types.ObjectId(), subcategory: new mongoose.Types.ObjectId() });

  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-2',
    vendorId: vendor._id,
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

test('postPurchaseOrderJournalEntries: service item -> PO_SERVICE_TO_WIP debits the SERVICE\'s own PUC account, never Materials Inventory', async () => {
  const Product = require('../../models/inventory/productModel');
  const pucAccount = accounts[AutomaticJournalAccountCodes.wipEngineeringDesign]; // a real PUC (WIP asset) account
  const service = await Product.create({ type: 'service', title: { en: 'Engineering', ar: 'هندسة' }, description: { en: 'd', ar: 'د' }, price: 100, durationValue: 1, durationUnit: 'month', pucAccount: pucAccount._id });

  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-3',
    vendorId: vendor._id,
    project: project._id,
    totalAmount: 3000,
    vatAmount: 0,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: service._id, subtotal: 3000 }],
  };

  const entries = await accountingEventService.postPurchaseOrderJournalEntries(fakePO, null);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].accountingAction, 'PO_SERVICE_TO_WIP');
  assert.equal(entries[0].totalDebit, entries[0].totalCredit, 'the entry must balance');

  const pucLine = entries[0].lines.find(l => l.account.toString() === pucAccount._id.toString());
  assert.equal(pucLine.debit, 3000);
  const inventoryId = accounts[AutomaticJournalAccountCodes.materialsInventory]._id.toString();
  assert.equal(entries[0].lines.some(l => l.account.toString() === inventoryId), false, 'a service purchase must never touch Materials Inventory');
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'PO', sourceId: fakePO._id, accountingAction: { $in: ['PO_INVENTORY_RECEIPT', 'PO_INVENTORY_TO_WIP'] } }), 0);

  const suppliersLine = entries[0].lines.find(l => l.account.toString() === accounts[AutomaticJournalAccountCodes.suppliers]._id.toString());
  assert.equal(suppliersLine.credit, 3000);
  assert.equal(suppliersLine.partyNumber, vendor.vendorNumber, 'the Supplier is the Vendor - its Vendor Number is the Sub Account');
  assert.equal(suppliersLine.partyType, 'vendor');
});

test('postPurchaseOrderJournalEntries: a legacy per-line costAccount is ignored - the Service\'s PUC account always wins', async () => {
  const Product = require('../../models/inventory/productModel');
  const pucAccount = accounts[AutomaticJournalAccountCodes.wipLabourWages];
  const service = await Product.create({ type: 'service', title: { en: 'Labour PUC', ar: 'عمالة' }, description: { en: 'd', ar: 'د' }, price: 100, durationValue: 1, durationUnit: 'month', pucAccount: pucAccount._id });

  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-LEGACY-COST',
    vendorId: vendor._id,
    project: project._id,
    totalAmount: 1000,
    vatAmount: 0,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: service._id, subtotal: 1000, costAccount: accounts['50000003']._id }],
  };

  const [entry] = await accountingEventService.postPurchaseOrderJournalEntries(fakePO, null);
  assert.ok(entry.lines.find(l => l.account.toString() === pucAccount._id.toString() && l.debit === 1000));
  assert.equal(entry.lines.some(l => l.account.toString() === accounts['50000003']._id.toString()), false);
});

test('postPurchaseOrderJournalEntries: a service with NO PUC account fails with a clear error and posts nothing (no fallback account)', async () => {
  const Product = require('../../models/inventory/productModel');
  const service = await Product.create({ type: 'service', title: { en: 'Labour (no PUC)', ar: 'عمالة بدون حساب' }, description: { en: 'd', ar: 'د' }, price: 100, durationValue: 1, durationUnit: 'month' });

  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-4',
    vendorId: vendor._id,
    project: project._id,
    totalAmount: 1000,
    vatAmount: 0,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: service._id, subtotal: 1000 }],
  };

  await assert.rejects(() => accountingEventService.postPurchaseOrderJournalEntries(fakePO, null), /has no PUC account configured/);
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'PO', sourceId: fakePO._id }), 0);
});

test('postPurchaseOrderJournalEntries: a MIXED product + service PO with VAT/WHT keeps Materials Inventory for the product only, and both entries balance and add up to the order Total Amount', async () => {
  const Product = require('../../models/inventory/productModel');
  const product = await Product.create({ type: 'product', title: { en: 'Panels', ar: 'ألواح' }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: new mongoose.Types.ObjectId(), subcategory: new mongoose.Types.ObjectId() });
  const pucAccount = accounts[AutomaticJournalAccountCodes.wipEngineeringDesign];
  const service = await Product.create({ type: 'service', title: { en: 'Design', ar: 'تصميم' }, description: { en: 'd', ar: 'د' }, price: 100, durationValue: 1, durationUnit: 'month', pucAccount: pucAccount._id });

  // 60,000 product + 40,000 service = 100,000; VAT 14% = 14,000; WHT 1% = 1,000; Total = 113,000.
  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-MIXED',
    vendorId: vendor._id,
    project: project._id,
    totalAmount: 100000,
    vatAmount: 14000,
    withholdingTaxAmount: 1000,
    grandTotal: 113000,
    createdAt: new Date(),
    items: [
      { productId: product._id, subtotal: 60000 },
      { productId: service._id, subtotal: 40000 },
    ],
  };

  const entries = await accountingEventService.postPurchaseOrderJournalEntries(fakePO, null);
  entries.forEach(e => assert.equal(e.totalDebit, e.totalCredit, `${e.accountingAction} must balance`));

  const receipt = entries.find(e => e.accountingAction === 'PO_INVENTORY_RECEIPT');
  const serviceJE = entries.find(e => e.accountingAction === 'PO_SERVICE_TO_WIP');
  const inventoryId = accounts[AutomaticJournalAccountCodes.materialsInventory]._id.toString();
  const suppliersId = accounts[AutomaticJournalAccountCodes.suppliers]._id.toString();

  assert.equal(receipt.lines.find(l => l.account.toString() === inventoryId).debit, 60000);
  assert.equal(serviceJE.lines.some(l => l.account.toString() === inventoryId), false);
  assert.equal(serviceJE.lines.find(l => l.account.toString() === pucAccount._id.toString()).debit, 40000);

  const supplierCredits = [receipt, serviceJE].reduce((sum, e) => sum + e.lines.filter(l => l.account.toString() === suppliersId).reduce((s, l) => s + l.credit, 0), 0);
  assert.equal(Math.round(supplierCredits * 100) / 100, 113000, 'the supplier payable across both entries equals the order Total Amount');
});

test('postPurchaseOrderJournalEntries: a service item with NO project fails safely instead of silently skipping the WIP posting', async () => {
  const Product = require('../../models/inventory/productModel');
  const service = await Product.create({ type: 'service', title: { en: 'Survey', ar: 'مساحة' }, description: { en: 'd', ar: 'د' }, price: 100, durationValue: 1, durationUnit: 'month' });

  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-SERVICE-NO-PROJECT',
    vendorId: vendor._id,
    project: null,
    totalAmount: 1000,
    vatAmount: 0,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: service._id, subtotal: 1000 }],
  };

  await assert.rejects(() => accountingEventService.postPurchaseOrderJournalEntries(fakePO, null), /Project is required/);
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'PO', sourceId: fakePO._id }), 0);
});

test('postPurchaseOrderJournalEntries: rejects when the vendor has no valid Vendor Number, and posts nothing', async () => {
  const Product = require('../../models/inventory/productModel');
  const product = await Product.create({ type: 'product', title: { en: 'NoNumber', ar: 'بلا رقم' }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: new mongoose.Types.ObjectId(), subcategory: new mongoose.Types.ObjectId() });

  // Simulates a legacy Vendor document predating the auto-numbering feature - bypasses the
  // pre('save') hook entirely via a raw collection insert (the hook only ever runs on `.save()`).
  const legacyVendorId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('vendors').insertOne({ _id: legacyVendorId, name: 'Legacy Vendor', contact: { phone: '01000000000' }, vendorNumber: null, createdAt: new Date(), updatedAt: new Date() });

  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-NO-VENDOR-NUMBER',
    vendorId: legacyVendorId,
    project: null,
    totalAmount: 500,
    vatAmount: 0,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: product._id, subtotal: 500 }],
  };

  await assert.rejects(() => accountingEventService.postPurchaseOrderJournalEntries(fakePO, null), /does not have a valid Vendor Number/);
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'PO', sourceId: fakePO._id }), 0, 'a rejected posting must leave no partial journal entry behind');
});

test('postSalesOrderAdvanceAppliedJE: rejects when the customer has no valid Customer Number, and posts nothing', async () => {
  // Simulates a legacy customer predating the auto-numbering feature - same raw-insert technique
  // as the vendor equivalent above.
  const legacyCustomerId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('users').insertOne({ _id: legacyCustomerId, name: 'Legacy Customer', email: `legacy-${Date.now()}@example.com`, role: 'user', type: 'online', customerNumber: null, createdAt: new Date(), updatedAt: new Date() });

  const fakeSalesOrder = { _id: new mongoose.Types.ObjectId(), code: 'SO-TEST-NO-CUSTOMER-NUMBER', customer: legacyCustomerId, project: project._id };

  await assert.rejects(() => accountingEventService.postSalesOrderAdvanceAppliedJE(fakeSalesOrder, 1000, null), /does not have a valid Customer Number/);
  assert.equal(await JournalEntry.countDocuments({ sourceType: 'SO', sourceId: fakeSalesOrder._id }), 0);
});

test('getAccountIdByCode throws (never fabricates an id) when a required control account is missing from the Chart of Accounts', async () => {
  await ChartOfAccount.deleteOne({ code: AutomaticJournalAccountCodes.suppliers });

  const Product = require('../../models/inventory/productModel');
  const product = await Product.create({ type: 'product', title: { en: 'Pipes', ar: 'أنابيب' }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: new mongoose.Types.ObjectId(), subcategory: new mongoose.Types.ObjectId() });
  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-TEST-5',
    vendorId: vendor._id,
    project: null,
    totalAmount: 500,
    vatAmount: 0,
    withholdingTaxAmount: 0,
    createdAt: new Date(),
    items: [{ productId: product._id, subtotal: 500 }],
  };

  await assert.rejects(() => accountingEventService.postPurchaseOrderJournalEntries(fakePO, null), /was not found\. Posting aborted/);
});

// ===================== Payment (JV005/007/009 equivalents) =====================

test('postPurchasePaymentRecordedJE: posts Dr Suppliers / Cr Cash, carries the Vendor Number and the caller-supplied project', async () => {
  const fakePayment = {
    _id: new mongoose.Types.ObjectId(),
    vendorId: vendor._id,
    paymentAccount: accounts[accounts.cashCode]._id,
    amountPaid: 710,
    createdAt: new Date(),
    notes: null,
  };

  const entry = await accountingEventService.postPurchasePaymentRecordedJE(fakePayment, project._id, null);
  assert.ok(entry);
  assert.equal(entry.accountingAction, 'PO_PAYMENT_RECORDED');
  // Regression test: previously hardcoded to `null` unconditionally.
  assert.equal(entry.project.toString(), project._id.toString());
  assert.equal(entry.module, 'Purchase Order');

  const suppliersId = accounts[AutomaticJournalAccountCodes.suppliers]._id.toString();
  const cashId = accounts[accounts.cashCode]._id.toString();
  const suppliersLine = entry.lines.find(l => l.account.toString() === suppliersId);
  const cashLine = entry.lines.find(l => l.account.toString() === cashId);
  assert.equal(suppliersLine.debit, 710);
  assert.equal(cashLine.credit, 710);
  assert.equal(suppliersLine.partyNumber, vendor.vendorNumber);
  assert.equal(suppliersLine.partyType, 'vendor');
});

test('postPurchasePaymentRecordedJE: no-ops when the payment has no paymentAccount (legacy string paymentMethod)', async () => {
  const fakePayment = { _id: new mongoose.Types.ObjectId(), vendorId: vendor._id, paymentAccount: null, amountPaid: 100, createdAt: new Date() };
  const entry = await accountingEventService.postPurchasePaymentRecordedJE(fakePayment, project._id, null);
  assert.equal(entry, null);
});

test('postSalesPaymentRecordedJE: posts Dr Cash / Cr Accounts Receivable - Projects, carries the Customer Number and the caller-supplied project', async () => {
  const fakePayment = {
    _id: new mongoose.Types.ObjectId(),
    customerId: customer._id,
    paymentAccount: accounts[accounts.cashCode]._id,
    amountPaid: 1234,
    createdAt: new Date(),
    notes: null,
  };

  const entry = await accountingEventService.postSalesPaymentRecordedJE(fakePayment, project._id, null);
  assert.ok(entry);
  assert.equal(entry.accountingAction, 'SO_PAYMENT_RECORDED');
  assert.equal(entry.project.toString(), project._id.toString());
  assert.equal(entry.module, 'Sales Order');

  const arId = accounts[AutomaticJournalAccountCodes.accountsReceivableProjects]._id.toString();
  const cashId = accounts[accounts.cashCode]._id.toString();
  const arLine = entry.lines.find(l => l.account.toString() === arId);
  const cashLine = entry.lines.find(l => l.account.toString() === cashId);
  assert.equal(cashLine.debit, 1234);
  assert.equal(arLine.credit, 1234);
  assert.equal(arLine.partyNumber, customer.customerNumber);
  assert.equal(arLine.partyType, 'customer');
});

// ===================== Project revenue/cost recognition =====================

test('postProjectExecutionRecognitionJEs: posts PROJECT_REVENUE_RECOGNITION for the incremental executedPercentage share of contractValue', async () => {
  project.executedPercentage = 20;
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null);

  const revenueJE = entries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  assert.ok(revenueJE);
  assert.equal(revenueJE.totalDebit, 200000); // 20% of 1,000,000
  assert.equal(project.revenueRecognizedPercentage, 20);
  // The reference accounting table tags revenue/cost recognition as module "Sales Order" (it is
  // triggered BY a Sales Order's contribution to executedPercentage), not "Project".
  assert.equal(revenueJE.module, 'Sales Order');
  const arId = accounts[AutomaticJournalAccountCodes.accountsReceivableProjects]._id.toString();
  const arLine = revenueJE.lines.find(l => l.account.toString() === arId);
  assert.equal(arLine.partyNumber, customer.customerNumber, "the project's own customer number must be on the AR line");
  assert.equal(arLine.partyType, 'customer');

  // Advancing further only recognizes the DELTA (30% - 20% = 10%), not the full new percentage.
  project.executedPercentage = 30;
  const secondEntries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null);
  const secondRevenueJE = secondEntries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  assert.equal(secondRevenueJE.totalDebit, 100000); // 10% of 1,000,000
});

test('postProjectExecutionRecognitionJEs: revenue recognition posts NO VAT/Withholding line when the project has no VAT (0%) Sales Orders', async () => {
  await SalesOrder.create({
    customer: customer._id,
    orderSource: 'cashier',
    project: project._id,
    items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 1000000, starterQuantity: 1 }],
    // vatPercentage/withholdingTaxPercentage both default to 0.
  });

  project.executedPercentage = 100;
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null);
  const revenueJE = entries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  assert.ok(revenueJE);

  const vatCode = AutomaticJournalAccountCodes.vatPayable;
  const whtCode = AutomaticJournalAccountCodes.withholdingTaxReceivable;
  const vatLine = revenueJE.lines.find(l => l.account.toString() === accounts[vatCode]._id.toString());
  const whtLine = revenueJE.lines.find(l => l.account.toString() === accounts[whtCode]._id.toString());
  assert.equal(vatLine, undefined, 'Case 1 (VAT = 0%): no VAT line should be posted at all');
  assert.equal(whtLine, undefined);
  assert.equal(revenueJE.totalDebit, revenueJE.totalCredit);
});

test('postProjectExecutionRecognitionJEs: revenue recognition posts the actual VAT amount (Case 2 - VAT > 0%), derived from the project\'s real Sales Orders, never the grand total as revenue', async () => {
  // 100,000 pre-tax, 14% VAT -> 114,000 grandTotal. Revenue recognition must use the PRE-TAX
  // amount as Revenue, never the VAT-inclusive total (docs section "Do NOT simply use the Sales
  // Order grand total as revenue").
  await SalesOrder.create({
    customer: customer._id,
    orderSource: 'cashier',
    project: project._id,
    vatPercentage: 14,
    items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 1000000, starterQuantity: 1 }],
  });

  project.executedPercentage = 100;
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null);
  const revenueJE = entries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  assert.ok(revenueJE);

  const revenueId = accounts[AutomaticJournalAccountCodes.revenue]._id.toString();
  const vatId = accounts[AutomaticJournalAccountCodes.vatPayable]._id.toString();
  const arId = accounts[AutomaticJournalAccountCodes.accountsReceivableProjects]._id.toString();
  const revenueLine = revenueJE.lines.find(l => l.account.toString() === revenueId);
  const vatLine = revenueJE.lines.find(l => l.account.toString() === vatId);
  const arLine = revenueJE.lines.find(l => l.account.toString() === arId);

  assert.equal(revenueLine.credit, 1000000, 'Revenue must be the base/taxable amount, never the VAT-inclusive total');
  assert.ok(vatLine, 'Case 2 (VAT > 0%): a VAT Payable line must be posted');
  assert.equal(vatLine.credit, 140000, '14% of the 1,000,000 base amount');
  assert.equal(arLine.debit, 1140000, 'the receivable nets to the VAT-inclusive amount (base + VAT), mirroring SalesOrder.grandTotal');
  assert.equal(revenueJE.totalDebit, revenueJE.totalCredit, 'the entry must balance exactly');
});

test('postProjectExecutionRecognitionJEs: revenue recognition posts BOTH VAT and Withholding Tax correctly (Case 3), and the entry still balances', async () => {
  // 200,000 pre-tax, 14% VAT (28,000), 5% withholding (10,000).
  await SalesOrder.create({
    customer: customer._id,
    orderSource: 'cashier',
    project: project._id,
    vatPercentage: 14,
    withholdingTaxPercentage: 5,
    items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 200000, starterQuantity: 1 }],
  });

  // 200,000 / 1,000,000 contractValue x 100 = 20% - matches this project's own Executed %
  // formula exactly, so deltaAmount lines up with this one Sales Order's real pre-tax amount.
  project.executedPercentage = 20;
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null);
  const revenueJE = entries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  assert.ok(revenueJE);

  const revenueId = accounts[AutomaticJournalAccountCodes.revenue]._id.toString();
  const vatId = accounts[AutomaticJournalAccountCodes.vatPayable]._id.toString();
  const whtId = accounts[AutomaticJournalAccountCodes.withholdingTaxReceivable]._id.toString();
  const arId = accounts[AutomaticJournalAccountCodes.accountsReceivableProjects]._id.toString();
  const revenueLine = revenueJE.lines.find(l => l.account.toString() === revenueId);
  const vatLine = revenueJE.lines.find(l => l.account.toString() === vatId);
  const whtLine = revenueJE.lines.find(l => l.account.toString() === whtId);
  const arLine = revenueJE.lines.find(l => l.account.toString() === arId);

  assert.equal(revenueLine.credit, 200000);
  assert.equal(vatLine.credit, 28000);
  assert.equal(whtLine.debit, 10000);
  // AR = Revenue + VAT - WHT = 200,000 + 28,000 - 10,000 = 218,000 (matches SalesOrder.grandTotal's
  // own formula exactly).
  assert.equal(arLine.debit, 218000);
  assert.equal(revenueJE.totalDebit, revenueJE.totalCredit);
  assert.equal(revenueJE.totalDebit, 228000); // AR(218,000) + WHT(10,000) = Revenue(200,000) + VAT(28,000)
});

test('postProjectExecutionRecognitionJEs: Average Cost lines on ANY COGS account (incl. 50000004 Fuel & Logistics) need no WIP mapping - JV0011 loads only the Raw Materials line', async () => {
  project.averageCostLines = COGS_CODES.map(code => ({ account: accounts[code]._id, amount: 100000 }));
  await project.save();

  project.executedPercentage = 10;
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null);
  assert.deepEqual(entries.map(e => e.accountingAction), ['PROJECT_REVENUE_RECOGNITION', 'PROJECT_COST_RECOGNITION']);
  assert.deepEqual(
    entries[1].lines.map(l => [l.account.toString(), l.debit, l.credit]),
    [
      [accounts[AutomaticJournalAccountCodes.wipRawMaterials]._id.toString(), 10000, 0],
      [accounts['50000001']._id.toString(), 0, 10000],
    ],
    '10% of the 100,000 Raw Materials Average Cost; the other COGS lines are not part of JV0011'
  );
});

test('postProjectExecutionRecognitionJEs: revenue recognition no-ops the Sub Account (never throws) when the project has no customer at all', async () => {
  const noCustomerProject = await Project.create({
    projectNumber: `ENGINE-NOCUST-${Date.now()}`,
    contractValue: 100000,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
    executedPercentage: 10,
  });
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(noCustomerProject, null);
  const revenueJE = entries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  assert.ok(revenueJE, 'a project with no customer must still get its revenue recognized - absence of a party is not an error for this flow');
  const arId = accounts[AutomaticJournalAccountCodes.accountsReceivableProjects]._id.toString();
  const arLine = revenueJE.lines.find(l => l.account.toString() === arId);
  assert.equal(arLine.partyNumber, null);
  assert.equal(arLine.partyType, null);
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

test('Sales Order WITHOUT tax: revenue recognition it triggers posts NO VAT/WHT line, even when the project already has a taxed Sales Order', async () => {
  // An earlier taxed order on the same project (14% VAT, 5% WHT) - previously its rates leaked into
  // every later recognition via a project-wide weighted average.
  await SalesOrder.create({
    customer: customer._id,
    orderSource: 'cashier',
    project: project._id,
    vatPercentage: 14,
    withholdingTaxPercentage: 5,
    items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 100000, starterQuantity: 1 }],
  });
  project.executedPercentage = 10;
  project.revenueRecognizedPercentage = 0;
  await accountingEventService.postProjectExecutionRecognitionJEs(project, null);

  // The new order has no VAT and no withholding at all.
  const noTaxOrder = await SalesOrder.create({
    customer: customer._id,
    orderSource: 'cashier',
    project: project._id,
    items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 200000, starterQuantity: 1 }],
  });
  assert.equal(noTaxOrder.vatAmount, 0);
  assert.equal(noTaxOrder.withholdingTaxAmount, 0);
  assert.equal(noTaxOrder.grandTotal, 200000, 'no tax configured -> Total Amount equals the subtotal');

  project.executedPercentage = 30; // +200,000 / 1,000,000
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null, noTaxOrder._id);
  const revenueJE = entries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  assert.ok(revenueJE);

  const vatId = accounts[AutomaticJournalAccountCodes.vatPayable]._id.toString();
  const whtId = accounts[AutomaticJournalAccountCodes.withholdingTaxReceivable]._id.toString();
  assert.equal(revenueJE.lines.some(l => l.account.toString() === vatId), false, 'a no-tax Sales Order must never get an invented VAT line');
  assert.equal(revenueJE.lines.some(l => l.account.toString() === whtId), false, 'nor an invented withholding line');
  assert.equal(revenueJE.totalDebit, 200000);
  assert.equal(revenueJE.totalDebit, revenueJE.totalCredit);
});

test('Sales Order WITH VAT: the revenue recognition it triggers carries exactly that order\'s VAT', async () => {
  const vatOrder = await SalesOrder.create({
    customer: customer._id,
    orderSource: 'cashier',
    project: project._id,
    vatPercentage: 14,
    items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 100000, starterQuantity: 1 }],
  });
  assert.equal(vatOrder.grandTotal, 114000, 'VAT is included in the order Total Amount');

  project.executedPercentage = 10;
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null, vatOrder._id);
  const revenueJE = entries.find(e => e.accountingAction === 'PROJECT_REVENUE_RECOGNITION');
  const vatLine = revenueJE.lines.find(l => l.account.toString() === accounts[AutomaticJournalAccountCodes.vatPayable]._id.toString());
  const arLine = revenueJE.lines.find(l => l.account.toString() === accounts[AutomaticJournalAccountCodes.accountsReceivableProjects]._id.toString());
  assert.equal(vatLine.credit, 14000);
  assert.equal(arLine.debit, 114000, 'the receivable equals the order Total Amount');
  assert.equal(revenueJE.totalDebit, revenueJE.totalCredit);
});

// ===================== Payment Notes -> Journal Entry Description =====================

test('Add Payment: the payment Notes become the Journal Entry Description exactly', async () => {
  const fakePayment = { _id: new mongoose.Types.ObjectId(), customerId: customer._id, paymentAccount: accounts[accounts.cashCode]._id, amountPaid: 500, createdAt: new Date(), notes: 'Payment for Project ABC' };
  const entry = await accountingEventService.postSalesPaymentRecordedJE(fakePayment, project._id, null);
  assert.equal(entry.description, 'Payment for Project ABC');

  const vendorPayment = { _id: new mongoose.Types.ObjectId(), vendorId: vendor._id, paymentAccount: accounts[accounts.cashCode]._id, amountPaid: 300, createdAt: new Date(), notes: '  Advance payment for Project 2026-001  ' };
  const vendorEntry = await accountingEventService.postPurchasePaymentRecordedJE(vendorPayment, project._id, null);
  assert.equal(vendorEntry.description, 'Advance payment for Project 2026-001');
});

test('Add Payment: empty/blank/missing Notes keep the default description - never "undefined"/"null"', () => {
  const { paymentJournalDescription } = accountingEventService;
  assert.equal(paymentJournalDescription({ notes: '' }, 'Customer payment'), 'Customer payment');
  assert.equal(paymentJournalDescription({ notes: '   ' }, 'Customer payment'), 'Customer payment');
  assert.equal(paymentJournalDescription({ notes: null }, 'Supplier payment'), 'Supplier payment');
  assert.equal(paymentJournalDescription({}, 'Supplier payment'), 'Supplier payment');
  assert.equal(paymentJournalDescription({ notes: 'undefined' }, 'Supplier payment'), 'Supplier payment');
  assert.equal(paymentJournalDescription(undefined, 'Supplier payment'), 'Supplier payment');
});

// ===================== Advanced Payment <-> Journal Entry link =====================

test('Advanced Payment journal entries carry a persisted advancedPayment reference (creation + consumption)', async () => {
  const advance = await AdvancedPayment.create({ type: 'customer', customer: customer._id, project: project._id, amount: 9000, paymentAccount: accounts[accounts.cashCode]._id });
  const creationEntry = await accountingEventService.postAdvancedPaymentJournalEntry(advance, null);
  assert.equal(creationEntry.advancedPayment.toString(), advance._id.toString());

  const fakePayment = { _id: new mongoose.Types.ObjectId(), customerId: customer._id, createdAt: new Date(), notes: null, advancedPayment: advance._id };
  const consumptionEntry = await accountingEventService.postPaymentCustomerAdvanceAppliedJE(fakePayment, 4000, project._id, null);
  assert.equal(consumptionEntry.advancedPayment.toString(), advance._id.toString());

  const linked = await JournalEntry.find({ advancedPayment: advance._id });
  assert.equal(linked.length, 2);

  // An unrelated entry never carries the link.
  const unrelated = await accountingEventService.postSalesPaymentRecordedJE(
    { _id: new mongoose.Types.ObjectId(), customerId: customer._id, paymentAccount: accounts[accounts.cashCode]._id, amountPaid: 10, createdAt: new Date() },
    project._id,
    null
  );
  assert.equal(unrelated.advancedPayment, null);
});

// ===================== Journal Entry integrity =====================

test('postAutomaticJournalEntry refuses to create an unbalanced entry', async () => {
  const sourceId = new mongoose.Types.ObjectId();
  await assert.rejects(
    () =>
      accountingEventService.postAutomaticJournalEntry({
        accountingAction: 'PO_INVENTORY_RECEIPT',
        sourceType: 'PO',
        sourceId,
        description: 'unbalanced',
        lines: [
          { account: accounts[AutomaticJournalAccountCodes.materialsInventory]._id, debit: 100, credit: 0 },
          { account: accounts[AutomaticJournalAccountCodes.suppliers]._id, debit: 0, credit: 90 },
        ],
      }),
    /not balanced/
  );
  assert.equal(await JournalEntry.countDocuments({ sourceId }), 0);
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
