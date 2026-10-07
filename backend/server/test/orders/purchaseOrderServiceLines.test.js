const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// A Purchase Order mixing Products and Services, persisted and processed exactly the way
// purchaseOrderController.js#createPurchaseOrder does it (create -> applyPurchaseToProducts ->
// postPurchaseOrderJournalEntries, in one transaction):
//   - every line persists and totals (subtotal / VAT / Total Amount) include both kinds;
//   - only Products touch stock and moving-average cost - Services never;
//   - Products post to Materials Inventory, Services to their own PUC accounts, never inventory.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_po_service_lines';

let Warehouse, PurchaseOrder, Product, Vendor, ChartOfAccount, Project, JournalEntry;
let applyPurchaseToProducts, postPurchaseOrderJournalEntries;
let transactionsSupported = true;
let accounts, vendor, warehouse, project;

const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');

const idStr = ref => String(ref?._id || ref);

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  // Warehouse before Payment (see orderTaxAndPayment.test.js for the circular-require note).
  Warehouse = require('../../models/inventory/warehouseModel');
  PurchaseOrder = require('../../models/vendor/purchaseOrder');
  require('../../models/vendor/paymentModel');
  Product = require('../../models/inventory/productModel');
  Vendor = require('../../models/vendor/vendor');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ({ applyPurchaseToProducts } = require('../../controller/PO/purchaseOrderController'));
  ({ postPurchaseOrderJournalEntries } = require('../../services/accounting/accountingEventService'));
  await Promise.all([PurchaseOrder.init(), Product.init(), Vendor.init(), ChartOfAccount.init(), Project.init(), JournalEntry.init()]);

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
  await Promise.all([PurchaseOrder.deleteMany({}), Product.deleteMany({}), Vendor.deleteMany({}), ChartOfAccount.deleteMany({}), Project.deleteMany({}), JournalEntry.deleteMany({}), Warehouse.deleteMany({})]);
  accounts = {};
  const codeToType = {
    [AutomaticJournalAccountCodes.materialsInventory]: 'asset',
    [AutomaticJournalAccountCodes.inputVat]: 'asset',
    [AutomaticJournalAccountCodes.suppliers]: 'liability',
    [AutomaticJournalAccountCodes.withholdingTaxPayable]: 'liability',
    [AutomaticJournalAccountCodes.wipRawMaterials]: 'asset',
    [AutomaticJournalAccountCodes.wipLabourWages]: 'asset',
    [AutomaticJournalAccountCodes.wipEngineeringDesign]: 'asset',
  };
  for (const [code, type] of Object.entries(codeToType)) {
    accounts[code] = await ChartOfAccount.create({ code, name: `Account ${code}`, type });
  }
  vendor = await Vendor.create({ name: 'Service Lines Vendor', contact: { phone: `010${Date.now()}`.slice(0, 11) } });
  warehouse = await Warehouse.create({ name: 'Service Lines Warehouse', location: 'Cairo' });
  project = await Project.create({ projectNumber: `PO-SVC-${Date.now()}`, startDate: new Date(), deliveryDate: new Date(Date.now() + 86400000) });
});

const createProduct = (name, cost, quantity) =>
  Product.create({
    type: 'product',
    title: { en: name, ar: `${name} ع` },
    description: { en: 'd', ar: 'د' },
    price: cost * 2,
    cost,
    category: new mongoose.Types.ObjectId(),
    subcategory: new mongoose.Types.ObjectId(),
    stock: [{ warehouse: warehouse._id, quantity }],
  });
const createService = (name, price, puc) =>
  Product.create({ type: 'service', title: { en: name, ar: `${name} ع` }, description: { en: 'd', ar: 'د' }, price, durationValue: 1, durationUnit: 'month', pucAccount: puc._id });

test('mixed PO (Product A, Service A, Product B, Service B): lines persist, totals include both, stock/accounting split by type', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');

  const productA = await createProduct('Product A', 50, 10);
  const productB = await createProduct('Product B', 20, 0);
  const serviceA = await createService('Service A', 1000, accounts[AutomaticJournalAccountCodes.wipEngineeringDesign]);
  const serviceB = await createService('Service B', 300, accounts[AutomaticJournalAccountCodes.wipLabourWages]);
  // A service has no `cost` at all - the shape that crashed the PO screen.
  assert.equal((await Product.findById(serviceA._id).lean()).cost, undefined);

  // Unit prices as the PO screen now seeds them: product -> cost, service -> price.
  const items = [
    { productId: productA._id, unitPrice: 50, starterQuantity: 10 }, // 500
    { productId: serviceA._id, unitPrice: 1000, starterQuantity: 2 }, // 2000
    { productId: productB._id, unitPrice: 20, starterQuantity: 5 }, // 100
    { productId: serviceB._id, unitPrice: 300, starterQuantity: 1 }, // 300
  ];

  const session = await mongoose.startSession();
  let order;
  let entries;
  await session.withTransaction(async () => {
    [order] = await PurchaseOrder.create([{ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, vatPercentage: 14, items }], { session });
    await applyPurchaseToProducts(order, warehouse._id.toString(), session);
    entries = await postPurchaseOrderJournalEntries(order, session);
  });
  session.endSession();

  // Lines + totals
  assert.equal(order.items.length, 4);
  assert.deepEqual(order.items.map(i => i.subtotal), [500, 2000, 100, 300]);
  assert.equal(order.totalAmount, 2900);
  assert.equal(order.vatAmount, 406);
  assert.equal(order.grandTotal, 3306);

  // Stock: products only
  const [freshA, freshB, freshSA, freshSB] = await Promise.all([productA, productB, serviceA, serviceB].map(p => Product.findById(p._id).lean()));
  assert.equal(freshA.stock.find(s => idStr(s.warehouse) === idStr(warehouse)).quantity, 20);
  assert.equal(freshB.stock.find(s => idStr(s.warehouse) === idStr(warehouse)).quantity, 5);
  assert.equal((freshSA.stock || []).length, 0, 'a service never gets stock');
  assert.equal((freshSB.stock || []).length, 0, 'a service never gets stock');
  assert.equal(freshSA.cost, undefined, 'a service never gets a moving-average cost');

  // Accounting
  const receipt = entries.find(e => e.accountingAction === 'PO_INVENTORY_RECEIPT');
  const serviceJE = entries.find(e => e.accountingAction === 'PO_SERVICE_TO_WIP');
  const inventoryId = idStr(accounts[AutomaticJournalAccountCodes.materialsInventory]);
  assert.equal(receipt.lines.find(l => idStr(l.account) === inventoryId).debit, 600, 'Materials Inventory = product lines only');
  assert.equal(serviceJE.lines.some(l => idStr(l.account) === inventoryId), false, 'a service never uses Materials Inventory');
  assert.equal(serviceJE.lines.find(l => idStr(l.account) === idStr(accounts[AutomaticJournalAccountCodes.wipEngineeringDesign])).debit, 2000);
  assert.equal(serviceJE.lines.find(l => idStr(l.account) === idStr(accounts[AutomaticJournalAccountCodes.wipLabourWages])).debit, 300);

  const suppliersId = idStr(accounts[AutomaticJournalAccountCodes.suppliers]);
  const supplierCredit = entries.flatMap(e => e.lines).filter(l => idStr(l.account) === suppliersId).reduce((s, l) => s + l.credit, 0);
  assert.equal(Math.round(supplierCredit * 100) / 100, 3306, 'supplier payable = order Total Amount');
  for (const e of entries) {
    assert.equal(e.totalDebit, e.totalCredit);
    e.lines.forEach(l => assert.equal(l.projectNumber, project.projectNumber));
  }
});

test('a no-tax PO with only a Service: VAT/WHT stay 0 and no tax lines are posted', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const service = await createService('Service Only', 750, accounts[AutomaticJournalAccountCodes.wipEngineeringDesign]);

  const session = await mongoose.startSession();
  let order;
  let entries;
  await session.withTransaction(async () => {
    [order] = await PurchaseOrder.create([{ vendorId: vendor._id, warehouseId: warehouse._id, project: project._id, items: [{ productId: service._id, unitPrice: 750, starterQuantity: 2 }] }], { session });
    await applyPurchaseToProducts(order, warehouse._id.toString(), session);
    entries = await postPurchaseOrderJournalEntries(order, session);
  });
  session.endSession();

  assert.equal(order.vatAmount, 0);
  assert.equal(order.withholdingTaxAmount, 0);
  assert.equal(order.grandTotal, 1500);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].accountingAction, 'PO_SERVICE_TO_WIP');
  assert.equal(entries[0].lines.length, 2, 'Dr PUC / Cr Suppliers only - no VAT/WHT lines');
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'PO_INVENTORY_RECEIPT' }), 0);
});
