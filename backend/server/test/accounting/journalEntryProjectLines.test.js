const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Project propagation (journalEntryModel.js RULE 3 + journalEntryProjectService.js): every line of
// a project-related entry carries the entry's Project and that Project's real Project Number.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_journal_entry_project_lines';

let JournalEntry;
let ChartOfAccount;
let Project;
let User;
let Vendor;
let SalesOrder;
let Product;
let accountingEventService;

let accounts;
let customer, vendor, project;

const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');

const idStr = ref => String(ref?._id || ref);

// Every line carries the entry's project and the project's real Project Number.
function assertProjectOnEveryLine(entry, expectedProject) {
  assert.equal(idStr(entry.project), idStr(expectedProject._id), 'parent entry project');
  entry.lines.forEach((line, i) => {
    assert.equal(idStr(line.project), idStr(expectedProject._id), `line ${i + 1} project`);
    assert.equal(line.projectNumber, expectedProject.projectNumber, `line ${i + 1} projectNumber`);
  });
}

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  SalesOrder = require('../../models/sales/salesOrderModel');
  Product = require('../../models/inventory/productModel');
  accountingEventService = require('../../services/accounting/accountingEventService');

  await Promise.all([JournalEntry.init(), ChartOfAccount.init(), Project.init(), Vendor.init(), SalesOrder.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([JournalEntry.deleteMany({}), ChartOfAccount.deleteMany({}), Project.deleteMany({}), User.deleteMany({}), Vendor.deleteMany({}), SalesOrder.deleteMany({}), Product.deleteMany({})]);

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
  accounts.cash = await ChartOfAccount.create({ code: 'CASH-TEST', name: 'Cash', type: 'asset', state: 'cash' });
  accounts['50000001'] = await ChartOfAccount.create({ code: '50000001', name: 'Raw Materials', type: 'cogs' });
  accounts.fuel = await ChartOfAccount.create({ code: '50000004', name: 'Fuel & Logistics', type: 'cogs' });

  customer = await User.create({ name: 'Project Lines Customer', email: `pl-customer-${Date.now()}@example.com`, role: 'user', type: 'online' });
  vendor = await Vendor.create({ name: 'Project Lines Vendor', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  project = await Project.create({
    projectNumber: `PRJ-LINES-${Date.now()}`,
    contractValue: 1000000,
    customer: customer._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
});

const makeProduct = () =>
  Product.create({ type: 'product', title: { en: `Steel ${Math.random()}`, ar: `صلب ${Math.random()}` }, description: { en: 'd', ar: 'د' }, price: 100, cost: 50, category: new mongoose.Types.ObjectId(), subcategory: new mongoose.Types.ObjectId() });
const makeService = puc =>
  Product.create({ type: 'service', title: { en: `Engineering ${Math.random()}`, ar: `هندسة ${Math.random()}` }, description: { en: 'd', ar: 'د' }, price: 100, durationValue: 1, durationUnit: 'month', pucAccount: puc._id });

// ===================== Project propagation =====================

test('Case 1 - a project-related automatic JE: every line gets the entry Project and Project Number, even when the builder sent none', async () => {
  const entry = await accountingEventService.postAutomaticJournalEntry({
    accountingAction: 'ADVANCE_PAYMENT_RECEIVED_CUSTOMER',
    sourceType: 'ADVANCED_PAYMENT',
    sourceId: new mongoose.Types.ObjectId(),
    description: 'project lines',
    project: project._id,
    lines: [
      { account: accounts.cash._id, debit: 500, credit: 0 },
      { account: accounts[AutomaticJournalAccountCodes.customerAdvancesPayable]._id, debit: 0, credit: 500, partyNumber: customer.customerNumber, partyType: 'customer' },
    ],
  });
  assertProjectOnEveryLine(entry, project);
  assert.equal(entry.lines[1].partyNumber, customer.customerNumber, 'the Sub Account is unchanged');
  assert.equal(entry.lines[0].partyNumber, customer.customerNumber, 'every line carries the entry\'s Sub Account');
});

test('Case 1b - a client-supplied wrong projectNumber is replaced by the Project\'s real number', async () => {
  const entry = await accountingEventService.postAutomaticJournalEntry({
    accountingAction: 'ADVANCE_PAYMENT_PAID_VENDOR',
    sourceType: 'ADVANCED_PAYMENT',
    sourceId: new mongoose.Types.ObjectId(),
    description: 'number',
    project: project._id,
    lines: [
      { account: accounts[AutomaticJournalAccountCodes.advanceToSuppliers]._id, debit: 10, credit: 0, projectNumber: 'GUESSED' },
      { account: accounts.cash._id, debit: 0, credit: 10, projectNumber: 'GUESSED' },
    ],
  });
  assertProjectOnEveryLine(entry, project);
});

test('Case 2 - a genuinely non-project JE needs no Project and is still created', async () => {
  const entry = await accountingEventService.postAutomaticJournalEntry({
    accountingAction: 'ADVANCE_PAYMENT_RECEIVED_CUSTOMER',
    sourceType: 'ADVANCED_PAYMENT',
    sourceId: new mongoose.Types.ObjectId(),
    description: 'no project',
    lines: [
      { account: accounts.cash._id, debit: 75, credit: 0 },
      { account: accounts[AutomaticJournalAccountCodes.customerAdvancesPayable]._id, debit: 0, credit: 75 },
    ],
  });
  assert.equal(entry.project, null);
  entry.lines.forEach(line => {
    assert.equal(line.project, null);
    assert.equal(line.projectNumber, null);
  });
});

test('Case 3 - parent.project = Project A with a line.project = null is rejected by the model, and nothing is saved', async () => {
  const before = await JournalEntry.countDocuments({});
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber: 990001,
        status: 'posted',
        source: 'automatic',
        project: project._id,
        lines: [
          { account: accounts.cash._id, debit: 225000, credit: 0, project: null, projectNumber: null },
          { account: accounts[AutomaticJournalAccountCodes.suppliers]._id, debit: 0, credit: 225000, project: project._id, projectNumber: project.projectNumber },
        ],
      }),
    /Journal line 1 \(debit 225000\) is missing the Project of its journal entry/
  );
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber: 990002,
        status: 'posted',
        source: 'automatic',
        project: project._id,
        lines: [
          { account: accounts.cash._id, debit: 1, credit: 0, project: project._id, projectNumber: null },
          { account: accounts[AutomaticJournalAccountCodes.suppliers]._id, debit: 0, credit: 1, project: project._id, projectNumber: project.projectNumber },
        ],
      }),
    /missing the Project Number/
  );
  const otherProject = await Project.create({ projectNumber: `PRJ-OTHER-${Date.now()}`, startDate: new Date(), deliveryDate: new Date(Date.now() + 86400000) });
  await assert.rejects(
    () =>
      JournalEntry.create({
        entryNumber: 990003,
        status: 'posted',
        source: 'automatic',
        project: project._id,
        lines: [
          { account: accounts.cash._id, debit: 1, credit: 0, project: otherProject._id, projectNumber: otherProject.projectNumber },
          { account: accounts[AutomaticJournalAccountCodes.suppliers]._id, debit: 0, credit: 1, project: project._id, projectNumber: project.projectNumber },
        ],
      }),
    /references a different Project/
  );
  assert.equal(await JournalEntry.countDocuments({}), before, 'no invalid journal entry was saved');
});

test('Case 3b - a builder sending a line for a different Project fails with a clear 400', async () => {
  const otherProject = await Project.create({ projectNumber: `PRJ-OTHER2-${Date.now()}`, startDate: new Date(), deliveryDate: new Date(Date.now() + 86400000) });
  await assert.rejects(
    () =>
      accountingEventService.postAutomaticJournalEntry({
        accountingAction: 'PO_PAYMENT_RECORDED',
        sourceType: 'PAYMENT',
        sourceId: new mongoose.Types.ObjectId(),
        description: 'mixed',
        project: project._id,
        lines: [
          { account: accounts[AutomaticJournalAccountCodes.suppliers]._id, debit: 5, credit: 0, project: otherProject._id },
          { account: accounts.cash._id, debit: 0, credit: 5 },
        ],
      }),
    err => err.statusCode === 400 && /Journal line 1 references a different project/.test(err.message)
  );
});

test('Case 4 - PO_INVENTORY_RECEIPT: EVERY line (inventory, input VAT, suppliers, WHT) carries the PO Project and Project Number', async () => {
  const product = await makeProduct();
  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: '000000000005',
    vendorId: vendor._id,
    project: project._id,
    vatAmount: 14000,
    withholdingTaxAmount: 2000,
    createdAt: new Date(),
    items: [{ productId: product._id, subtotal: 225000 }],
  };

  const entries = await accountingEventService.postPurchaseOrderJournalEntries(fakePO, null);
  const receipt = entries.find(e => e.accountingAction === 'PO_INVENTORY_RECEIPT');
  assert.equal(receipt.lines.length, 4);
  assertProjectOnEveryLine(receipt, project);
  const suppliersLine = receipt.lines.find(l => idStr(l.account) === idStr(accounts[AutomaticJournalAccountCodes.suppliers]));
  assert.equal(suppliersLine.partyNumber, vendor.vendorNumber, 'the Vendor Sub Account is unchanged');
  assert.equal(suppliersLine.partyType, 'vendor');
  const inventoryLine = receipt.lines.find(l => idStr(l.account) === idStr(accounts[AutomaticJournalAccountCodes.materialsInventory]));
  assert.equal(inventoryLine.debit, 225000, 'the accounting itself is unchanged');
  assert.equal(receipt.totalDebit, receipt.totalCredit);

  const toWip = entries.find(e => e.accountingAction === 'PO_INVENTORY_TO_WIP');
  assertProjectOnEveryLine(toWip, project);

  // Stored that way too, not just in the returned object.
  const stored = await JournalEntry.findById(receipt._id).lean();
  stored.lines.forEach(l => assert.equal(l.projectNumber, project.projectNumber));
});

test('Case 5 - PO_SERVICE_TO_WIP (service purchase): every line carries the Project; the service PUC account is debited', async () => {
  const puc = accounts[AutomaticJournalAccountCodes.wipEngineeringDesign];
  const service = await makeService(puc);
  const fakePO = {
    _id: new mongoose.Types.ObjectId(),
    code: 'PO-SVC-LINES',
    vendorId: vendor._id,
    project: project._id,
    vatAmount: 1400,
    withholdingTaxAmount: 100,
    createdAt: new Date(),
    items: [{ productId: service._id, subtotal: 10000 }],
  };

  const [entry] = await accountingEventService.postPurchaseOrderJournalEntries(fakePO, null);
  assert.equal(entry.accountingAction, 'PO_SERVICE_TO_WIP');
  assertProjectOnEveryLine(entry, project);
  assert.ok(entry.lines.some(l => idStr(l.account) === idStr(puc) && l.debit === 10000));
  assert.equal(entry.lines.some(l => idStr(l.account) === idStr(accounts[AutomaticJournalAccountCodes.materialsInventory])), false);
});

test('Case 6 - Sales Order JEs (advance applied, revenue recognition) carry the Project on every line', async () => {
  const salesOrder = await SalesOrder.create({ customer: customer._id, orderSource: 'cashier', project: project._id, items: [] });
  const advanceJE = await accountingEventService.postSalesOrderAdvanceAppliedJE(salesOrder, 1000, null);
  assertProjectOnEveryLine(advanceJE, project);

  project.executedPercentage = 10;
  const entries = await accountingEventService.postProjectExecutionRecognitionJEs(project, null, salesOrder._id);
  assert.deepEqual(entries.map(e => e.accountingAction), ['PROJECT_REVENUE_RECOGNITION']);
  entries.forEach(e => assertProjectOnEveryLine(e, project));
});

test('a real Sales Order on a project whose Average Cost uses 50000004 Fuel & Logistics is created without any WIP mapping', async () => {
  const projectAccounting = require('../../services/project/projectAccountingService');
  project.averageCostLines = [
    { account: accounts['50000001']._id, amount: 100000 },
    { account: accounts.fuel._id, amount: 20000 },
  ];
  await project.save();

  const service = await makeService(accounts[AutomaticJournalAccountCodes.wipEngineeringDesign]);
  const salesOrder = await SalesOrder.create({
    customer: customer._id,
    orderSource: 'cashier',
    project: project._id,
    items: [{ product: service._id, unitPrice: 100000, starterQuantity: 1 }],
  });
  assert.equal(salesOrder.totalAmount, 100000);

  // The same call salesOrderCreation.service.js makes right after saving a Sales Order.
  await projectAccounting.recalculateExecutedPercentage(project._id, null, salesOrder._id);

  const updated = await Project.findById(project._id);
  assert.equal(updated.executedPercentage, 10, '100,000 / 1,000,000 contract value');
  const entries = await JournalEntry.find({ triggeredBySalesOrder: salesOrder._id });
  assert.deepEqual(entries.map(e => e.accountingAction), ['PROJECT_REVENUE_RECOGNITION']);
  entries.forEach(e => assertProjectOnEveryLine(e, project));
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'PROJECT_COST_RECOGNITION' }), 0);
  assert.equal(await JournalEntry.countDocuments({ 'lines.account': accounts[AutomaticJournalAccountCodes.materialsInventory]._id }), 0, 'a Sales Order never touches Materials Inventory');
});

test('inherently project-related actions are refused without a project', async () => {
  for (const accountingAction of ['PO_INVENTORY_RECEIPT', 'PO_SERVICE_TO_WIP', 'SO_CUSTOMER_ADVANCE_APPLIED', 'PROJECT_REVENUE_RECOGNITION']) {
    await assert.rejects(
      () =>
        accountingEventService.postAutomaticJournalEntry({
          accountingAction,
          sourceType: 'PO',
          sourceId: new mongoose.Types.ObjectId(),
          description: 'no project',
          lines: [
            { account: accounts.cash._id, debit: 1, credit: 0 },
            { account: accounts[AutomaticJournalAccountCodes.suppliers]._id, debit: 0, credit: 1 },
          ],
        }),
      new RegExp(`Project is required for this automatic Journal Entry \\(${accountingAction}\\)`)
    );
  }
});

test('reversing a historical project entry whose lines lack the Project fills them in (reversal keeps working)', async () => {
  // Historical shape (before RULE 3): parent has a project, lines do not - planted directly.
  const legacyId = new mongoose.Types.ObjectId();
  await JournalEntry.collection.insertOne({
    _id: legacyId,
    entryNumber: 990100,
    status: 'posted',
    source: 'automatic',
    project: project._id,
    lines: [
      { account: accounts.cash._id, debit: 40, credit: 0, project: null, projectNumber: null },
      { account: accounts[AutomaticJournalAccountCodes.suppliers]._id, debit: 0, credit: 40, project: null, projectNumber: null },
    ],
    totalDebit: 40,
    totalCredit: 40,
  });
  const { applyEntryProjectToLines } = require('../../services/accounting/journalEntryProjectService');
  const original = await JournalEntry.findById(legacyId);
  const reversal = await JournalEntry.create({
    entryNumber: 990101,
    status: 'posted',
    reversalOfEntry: original._id,
    project: original.project,
    lines: await applyEntryProjectToLines({
      project: original.project,
      allowLineProjectOverride: true,
      lines: original.lines.map(line => ({ account: line.account._id, debit: line.credit, credit: line.debit, project: null, projectNumber: null })),
    }),
  });
  assertProjectOnEveryLine(reversal, project);

  // Marking the historical original 'reversed' does not re-validate its old lines.
  original.status = 'reversed';
  original.reversedByEntry = reversal._id;
  await original.save();
});
