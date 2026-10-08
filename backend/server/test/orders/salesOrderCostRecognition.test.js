const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Sales Order Cost Recognition (accountingEventService.js#postSalesOrderCostRecognitionJE), run
// through the real creation path (salesOrderCreation.service.js#createSalesOrder): Cost of Items x
// the project's ACCUMULATED Executed % right after the order, fixed per order. Also: orders are
// created without a payment method or shipping cost, every JE line carries the Sub Account, and
// documents can be attached to existing Sales/Purchase Orders.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_so_cost_recognition';

const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');

let Warehouse, SalesOrder, PurchaseOrder, Product, Project, User, Vendor, ChartOfAccount, JournalEntry;
let createSalesOrder, postSalesOrderCostRecognitionJE, createOrderDocumentHandlers;
let transactionsSupported = true;
let warehouse, customer, manager, project, product, service, accounts;

const idStr = ref => String(ref?._id || ref);

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  // Warehouse before Payment (see orderTaxAndPayment.test.js for the circular-require note).
  Warehouse = require('../../models/inventory/warehouseModel');
  SalesOrder = require('../../models/sales/salesOrderModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  require('../../models/vendor/paymentModel');
  Product = require('../../models/inventory/productModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ({ createSalesOrder } = require('../../services/sales/salesOrderCreation.service'));
  ({ postSalesOrderCostRecognitionJE } = require('../../services/accounting/accountingEventService'));
  ({ createOrderDocumentHandlers } = require('../../controller/orderDocumentController'));
  await Promise.all([SalesOrder.init(), PurchaseOrder.init(), Product.init(), Project.init(), ChartOfAccount.init(), JournalEntry.init()]);

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

beforeEach(async () => {
  await Promise.all(
    [Warehouse, SalesOrder, PurchaseOrder, Product, Project, User, Vendor, ChartOfAccount, JournalEntry].map(M => M.deleteMany({}))
  );
  accounts = {};
  const codeToType = {
    [AutomaticJournalAccountCodes.accountsReceivableProjects]: 'asset',
    [AutomaticJournalAccountCodes.revenue]: 'revenue',
    [AutomaticJournalAccountCodes.vatPayable]: 'liability',
    [AutomaticJournalAccountCodes.withholdingTaxReceivable]: 'asset',
    [AutomaticJournalAccountCodes.materialsInventory]: 'asset',
    [AutomaticJournalAccountCodes.costOfGoodsSold]: 'cogs',
  };
  for (const [code, type] of Object.entries(codeToType)) {
    accounts[code] = await ChartOfAccount.create({ code, name: `Account ${code}`, type });
  }
  warehouse = await Warehouse.create({ name: 'Cost Warehouse', location: 'Cairo' });
  manager = await User.create({ name: 'Cost Manager', email: `cost-mgr-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  customer = await User.create({ name: 'Cost Customer', email: `cost-cust-${Date.now()}@example.com`, role: 'user', type: 'online' });
  project = await Project.create({
    projectNumber: `PRJ-COST-${Date.now()}`,
    contractValue: 1000000,
    customer: customer._id,
    startDate: new Date(),
    deliveryDate: new Date(Date.now() + 86400000),
  });
  product = await Product.create({
    type: 'product',
    title: { en: 'Panel', ar: 'لوح' },
    description: { en: 'd', ar: 'د' },
    price: 2000,
    cost: 4000,
    category: new mongoose.Types.ObjectId(),
    subcategory: new mongoose.Types.ObjectId(),
    stock: [{ warehouse: warehouse._id, quantity: 1000 }],
  });
  const puc = await ChartOfAccount.create({ code: 'PUC-COST', name: 'PUC', type: 'asset' });
  service = await Product.create({ type: 'service', title: { en: 'Install', ar: 'تركيب' }, description: { en: 'd', ar: 'د' }, price: 5000, durationValue: 1, durationUnit: 'month', pucAccount: puc._id });
});

const sell = items =>
  createSalesOrder({
    customer: customer._id,
    warehouse: warehouse._id.toString(),
    project: project._id,
    items,
    createdBy: manager._id,
    employee: manager._id,
  });

test('Scenario A + D: a Sales Order with no payment method and no shipping cost is created; 20% accumulated x cost 400,000 = 80,000 recognized', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');

  // 100 x 2,000 = 200,000 sales on a 1,000,000 contract -> 20%; cost 100 x 4,000 = 400,000.
  const order = await sell([{ product: product._id, unitPrice: 2000, starterQuantity: 100 }]);
  const stored = await SalesOrder.findById(order._id).lean();

  assert.equal(stored.paymentMethod, null, 'no payment method');
  assert.equal(stored.shippingCost, 0, 'no shipping cost');
  assert.equal(stored.grandTotal, 200000, 'order total does not include shipping');
  assert.deepEqual(
    { pct: stored.costRecognition.executedPercentage, cost: stored.costRecognition.costOfItems, recognized: stored.costRecognition.recognizedCost },
    { pct: 20, cost: 400000, recognized: 80000 }
  );

  const entry = await JournalEntry.findById(stored.costRecognition.journalEntry).lean();
  assert.equal(entry.accountingAction, 'SO_COST_RECOGNITION');
  assert.equal(entry.module, 'Sales Order');
  assert.equal(entry.totalDebit, 80000);
  assert.equal(entry.totalCredit, 80000);
  const cogsLine = entry.lines.find(l => idStr(l.account) === idStr(accounts[AutomaticJournalAccountCodes.costOfGoodsSold]));
  const inventoryLine = entry.lines.find(l => idStr(l.account) === idStr(accounts[AutomaticJournalAccountCodes.materialsInventory]));
  assert.equal(cogsLine.debit, 80000, 'Dr Cost of Goods Sold');
  assert.equal(inventoryLine.credit, 80000, 'Cr Materials Inventory');
  for (const line of entry.lines) {
    assert.equal(line.partyNumber, customer.customerNumber, 'Sub Account on every line');
    assert.equal(line.partyType, 'customer');
    assert.equal(line.projectNumber, project.projectNumber, 'Project Number on every line');
  }
});

test('Scenario E: the next order uses the ACCUMULATED 30%, not its own 10%, and the earlier order is not revisited', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');

  const first = await sell([{ product: product._id, unitPrice: 2000, starterQuantity: 100 }]); // -> 20%
  // 50 x 2,000 = 100,000 more sales -> 30% accumulated; this order's cost = 50 x 4,000 = 200,000.
  const second = await sell([{ product: product._id, unitPrice: 2000, starterQuantity: 50 }]);

  const secondStored = await SalesOrder.findById(second._id).lean();
  assert.equal(secondStored.costRecognition.executedPercentage, 30, 'accumulated project %');
  assert.equal(secondStored.costRecognition.costOfItems, 200000);
  assert.equal(secondStored.costRecognition.recognizedCost, 60000, '30% x 200,000 (not 10% x 200,000 = 20,000)');

  const firstStored = await SalesOrder.findById(first._id).lean();
  assert.equal(firstStored.costRecognition.executedPercentage, 20, 'the first order keeps its own snapshot');
  assert.equal(firstStored.costRecognition.recognizedCost, 80000);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'SO_COST_RECOGNITION' }), 2);
  assert.equal((await Project.findById(project._id)).executedPercentage, 30);
});

test('idempotent: re-running cost recognition for an order changes nothing and posts no second entry', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const order = await sell([{ product: product._id, unitPrice: 2000, starterQuantity: 100 }]);
  const before = (await SalesOrder.findById(order._id).lean()).costRecognition;

  const again = await postSalesOrderCostRecognitionJE(await SalesOrder.findById(order._id), null);
  assert.equal(again.entry, null);
  assert.equal(again.costRecognition.recognizedCost, before.recognizedCost);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'SO_COST_RECOGNITION', sourceId: order._id }), 1);
});

test('a service-only order has no item cost: the snapshot records 0 and no journal entry is posted', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const order = await sell([{ product: service._id, unitPrice: 5000, starterQuantity: 2 }]);
  const stored = await SalesOrder.findById(order._id).lean();
  assert.equal(stored.costRecognition.costOfItems, 0);
  assert.equal(stored.costRecognition.recognizedCost, 0);
  assert.equal(stored.costRecognition.journalEntry, null);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'SO_COST_RECOGNITION' }), 0);
});

test('mixed product + service order: only the product carries cost', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // 100 x 2,000 + 1 x 5,000 = 205,000 -> 20.5%; cost = 100 x 4,000 = 400,000 -> 82,000.
  const order = await sell([
    { product: product._id, unitPrice: 2000, starterQuantity: 100 },
    { product: service._id, unitPrice: 5000, starterQuantity: 1 },
  ]);
  const { costRecognition } = await SalesOrder.findById(order._id).lean();
  assert.equal(costRecognition.executedPercentage, 20.5);
  assert.equal(costRecognition.costOfItems, 400000);
  assert.equal(costRecognition.recognizedCost, 82000);
});

test('the order\'s revenue recognition entry also carries the Sub Account on every line', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const order = await sell([{ product: product._id, unitPrice: 2000, starterQuantity: 100 }]);
  const revenue = await JournalEntry.findOne({ accountingAction: 'PROJECT_REVENUE_RECOGNITION', triggeredBySalesOrder: order._id }).lean();
  assert.ok(revenue);
  revenue.lines.forEach(line => assert.equal(line.partyNumber, customer.customerNumber));
});

// ---------------------------------------------------------------- documents

function mockResponse() {
  const res = { statusCode: null, body: null };
  res.status = code => {
    res.statusCode = code;
    return res;
  };
  res.json = body => {
    res.body = body;
    return res;
  };
  return res;
}

async function runHandler(handler, req) {
  const res = mockResponse();
  let error = null;
  await handler(req, res, err => {
    error = err;
  });
  return { res, error };
}

test('Scenario G: documents can be added to an existing Sales Order and Purchase Order, persist, and be removed', async () => {
  const salesOrder = await SalesOrder.create({ customer: customer._id, orderSource: 'cashier', project: project._id, employee: manager._id, items: [{ product: product._id, unitPrice: 10, starterQuantity: 1 }] });
  const vendor = await Vendor.create({ name: 'Doc Vendor', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  const purchaseOrder = await PurchaseOrder.create({ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, items: [{ productId: product._id, unitPrice: 10, starterQuantity: 1 }] });

  for (const [Model, order, label] of [
    [SalesOrder, salesOrder, 'Sales order'],
    [PurchaseOrder, purchaseOrder, 'Purchase order'],
  ]) {
    const { uploadOrderDocument, deleteOrderDocument } = createOrderDocumentHandlers(Model, label);
    const file = { path: 'https://files.example/contract.pdf', filename: `uploads/test/contract-${Date.now()}`, originalname: 'contract.pdf', mimetype: 'application/pdf' };

    const added = await runHandler(uploadOrderDocument, { params: { id: String(order._id) }, file, user: { _id: manager._id } });
    assert.equal(added.error, null);
    assert.equal(added.res.statusCode, 201);
    assert.equal(added.res.body.data.documents.length, 1);

    const reloaded = await Model.findById(order._id).lean(); // "refresh the page"
    assert.equal(reloaded.documents.length, 1);
    assert.equal(reloaded.documents[0].filename, 'contract.pdf');
    assert.equal(reloaded.documents[0].url, file.path);
    assert.equal(idStr(reloaded.documents[0].uploadedBy), idStr(manager._id));
    assert.equal(reloaded.grandTotal, (await Model.findById(order._id)).grandTotal, 'attaching a document does not touch the order');

    const removed = await runHandler(deleteOrderDocument, { params: { id: String(order._id), documentId: String(reloaded.documents[0]._id) } });
    assert.equal(removed.error, null);
    assert.equal(removed.res.body.data.documents.length, 0);
    assert.equal((await Model.findById(order._id).lean()).documents.length, 0);

    const missing = await runHandler(uploadOrderDocument, { params: { id: String(new mongoose.Types.ObjectId()) }, file, user: { _id: manager._id } });
    assert.equal(missing.error?.statusCode, 404);
    const noFile = await runHandler(uploadOrderDocument, { params: { id: String(order._id) }, user: { _id: manager._id } });
    assert.equal(noFile.error?.statusCode, 400);
  }
});

test('Scenario H: an older order with shipping cost, a payment method and no documents still loads', async () => {
  const _id = new mongoose.Types.ObjectId();
  await SalesOrder.collection.insertOne({
    _id,
    customer: customer._id,
    orderSource: 'cashier',
    paymentMethod: 'account',
    shippingCost: 150,
    shippingCostPaid: false,
    items: [],
    totalAmount: 1000,
    paidAmount: 0,
    createdAt: new Date(),
  });
  const legacy = await SalesOrder.findById(_id);
  assert.equal(legacy.shippingCost, 150, 'historical shipping cost preserved');
  assert.equal(legacy.paymentMethod, 'account');
  assert.deepEqual(legacy.toJSON().documents, []);
  assert.equal(legacy.costRecognition, null);
});
