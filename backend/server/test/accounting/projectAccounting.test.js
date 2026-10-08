const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_project_accounting';

let Project;
let JournalEntry;
let User;
let ChartOfAccount;
let SalesOrder;
let Sector;
let recalculateExecutedPercentage;
let AutomaticJournalAccountCodes;
let user;
let customer;
let cogsAccountA;
let cogsAccountB;
let nonCogsAccount;

// SalesOrder.create() needs a real Product ObjectId for `items.*.product` to satisfy the schema's
// `required: true` cast, but the model itself never checks the referenced Product actually exists
// (that's a controller/service-layer concern, not this model's) - a fresh fake id is fine here.
function fakeSalesOrder(overrides = {}) {
  return {
    customer: customer._id,
    orderSource: 'cashier',
    items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 100, starterQuantity: 1 }],
    ...overrides,
  };
}

// Project.create() no longer takes a session/journal-entry step - creating a project only ever
// creates the Project document (automatic journal-entry creation on project creation was removed,
// see docs/entities/projects.md). `startDate`/`deliveryDate` are now required on every project.
function baseProjectData(overrides = {}) {
  return {
    projectNumber: 'PRJ-000',
    contractValue: 1000,
    projectManager: user._id,
    startDate: new Date('2026-01-01'),
    deliveryDate: new Date('2026-06-01'),
    ...overrides,
  };
}

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Project = require('../../models/project/projectModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  User = require('../../models/userModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  SalesOrder = require('../../models/sales/salesOrderModel');
  Sector = require('../../models/project/sectorModel');
  require('../../models/inventory/productModel');
  ({ recalculateExecutedPercentage } = require('../../services/project/projectAccountingService'));
  ({ AutomaticJournalAccountCodes } = require('../../utils/accountingConstants'));
  await Promise.all([Project.init(), JournalEntry.init(), ChartOfAccount.init(), SalesOrder.init(), Sector.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Project.deleteMany({});
  await JournalEntry.deleteMany({});
  await User.deleteMany({});
  await ChartOfAccount.deleteMany({});
  await SalesOrder.deleteMany({});

  user = await User.create({ name: 'Test Manager', email: `manager-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  customer = await User.create({ name: 'Test Customer', email: `customer-${Date.now()}@example.com`, role: 'user', type: 'online' });
  cogsAccountA = await ChartOfAccount.create({ code: `COGS-A-${Date.now()}`, name: 'Direct Materials', type: 'cogs' });
  cogsAccountB = await ChartOfAccount.create({ code: `COGS-B-${Date.now()}`, name: 'Direct Labor', type: 'cogs' });
  nonCogsAccount = await ChartOfAccount.create({ code: `CASH-${Date.now()}`, name: 'Cash', type: 'asset' });

  // Required for recalculateExecutedPercentage's automatic PROJECT_REVENUE_RECOGNITION posting
  // (see accountingEventService.js#postProjectRevenueRecognitionJE) - without these well-known
  // codes existing, posting aborts with "required Chart of Accounts account ... was not found".
  // vatPayable/withholdingTaxReceivable are only actually looked up when a test's Sales Order
  // carries a non-zero VAT/withholding percentage (see postProjectRevenueRecognitionJE's own
  // `if (deltaVat > 0)`/`if (deltaWht > 0)` guards) - seeded unconditionally here anyway so no
  // individual test needs to remember to add them.
  await ChartOfAccount.create({ code: AutomaticJournalAccountCodes.accountsReceivableProjects, name: 'Accounts Receivable (Projects)', type: 'asset' });
  await ChartOfAccount.create({ code: AutomaticJournalAccountCodes.revenue, name: 'Revenue', type: 'revenue' });
  await ChartOfAccount.create({ code: AutomaticJournalAccountCodes.vatPayable, name: 'VAT Payable', type: 'liability' });
  await ChartOfAccount.create({ code: AutomaticJournalAccountCodes.withholdingTaxReceivable, name: 'Withholding Tax Receivable', type: 'asset' });

  // Valid sectors come from the admin-managed Sector collection (models/project/sectorModel.js).
  await Sector.deleteMany({});
  await Sector.create([{ name: 'Villa' }, { name: 'Industrials' }]);
});

test('creating a project does NOT create any journal entry', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-001' }));

  const foundProject = await Project.findById(project._id);
  assert.ok(foundProject, 'project should exist');
  assert.equal(foundProject.projectNumber, 'PRJ-001');
  assert.equal(foundProject.contractValue, 1000);

  const entries = await JournalEntry.find({ project: project._id });
  assert.equal(entries.length, 0, 'creating a project must not create any journal entry (automatic accounting was removed)');

  const anyEntries = await JournalEntry.countDocuments({});
  assert.equal(anyEntries, 0, 'no journal entry should exist anywhere as a side effect of project creation');
});

test('remainingMoney defaults to the full contractValue at creation (no payments yet)', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-002', contractValue: 5000, remainingMoney: 5000 }));
  assert.equal(project.remainingMoney, 5000);
});

test('duplicate project numbers are rejected', async () => {
  await Project.create(baseProjectData({ projectNumber: 'PRJ-003' }));

  await assert.rejects(() => Project.create(baseProjectData({ projectNumber: 'PRJ-003' })), err => err.code === 11000);

  const entries = await JournalEntry.find({});
  assert.equal(entries.length, 0, 'a rejected duplicate must not leave any journal entry behind');
});

test('an invalid (zero/negative) contract value is rejected', async () => {
  await assert.rejects(() => Project.create(baseProjectData({ projectNumber: 'PRJ-004', contractValue: 0 })), /greater than 0/);
  await assert.rejects(() => Project.create(baseProjectData({ projectNumber: 'PRJ-005', contractValue: -100 })), /greater than 0/);
});

test('contractValue, projectManager, startDate and deliveryDate are optional at the model level (enforced instead by createProjectValidators.js for real API requests)', async () => {
  // These four fields were deliberately made non-`required` on the Mongoose schema so a
  // genuinely partial record (e.g. a project known only by its number, imported from an external
  // source like accounting journal entries) can be stored honestly instead of forcing a
  // fabricated value. The real "Create Project" HTTP endpoint still requires all four - see
  // server/utils/validators/projectValidators.js's createProjectValidators - this test only
  // covers the model layer.
  const project = await Project.create({ projectNumber: 'PRJ-006' });
  assert.equal(project.contractValue, null);
  assert.equal(project.projectManager, null);
  assert.equal(project.startDate, null);
  assert.equal(project.deliveryDate, null);
});

test('deliveryDate cannot be before startDate', async () => {
  await assert.rejects(
    () =>
      Project.create(
        baseProjectData({
          projectNumber: 'PRJ-008',
          startDate: new Date('2026-06-01'),
          deliveryDate: new Date('2026-01-01'),
        })
      ),
    /Delivery date cannot be before the start date/
  );
});

test('deliveryDate equal to startDate is accepted (not "before")', async () => {
  const sameDay = new Date('2026-03-01');
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-009', startDate: sameDay, deliveryDate: sameDay }));
  assert.ok(project._id);
});

test('a project can be created with sector "Villa"', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-SECTOR-01', sector: 'Villa' }));
  const found = await Project.findById(project._id);
  assert.equal(found.sector, 'Villa');
});

test('a project can be created with sector "Industrials"', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-SECTOR-02', sector: 'Industrials' }));
  const found = await Project.findById(project._id);
  assert.equal(found.sector, 'Industrials');
});

test('an invalid sector value is rejected', async () => {
  await assert.rejects(() => Project.create(baseProjectData({ projectNumber: 'PRJ-SECTOR-03', sector: 'Marketing' })), /not a valid sector/);
});

test('a project created without a sector defaults to null and remains readable (backward compatibility)', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-SECTOR-04' }));
  assert.equal(project.sector, null);

  const found = await Project.findById(project._id);
  assert.equal(found.sector, null, 'a project with no sector must read back cleanly, not throw a cast/enum error');
});

test('sector can be updated after creation, and cleared back to null', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-SECTOR-05', sector: 'Villa' }));

  project.sector = 'Industrials';
  await project.save();
  assert.equal((await Project.findById(project._id)).sector, 'Industrials');

  project.sector = null;
  await project.save();
  assert.equal((await Project.findById(project._id)).sector, null, 'explicitly setting sector to null must actually clear it in the database');
});

test('project retrieval and update (name, contractValue, projectManager, dates)', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-010', name: 'Initial name' }));

  const found = await Project.findById(project._id);
  assert.equal(found.name, 'Initial name');
  assert.equal(found.projectManager._id.toString(), user._id.toString());

  found.name = 'Updated name';
  found.contractValue = 2000;
  await found.save();

  const updated = await Project.findById(project._id);
  assert.equal(updated.name, 'Updated name');
  assert.equal(updated.contractValue, 2000);
  // projectNumber must remain unchanged through a normal update path.
  assert.equal(updated.projectNumber, 'PRJ-010');

  // Updating still creates no journal entry.
  const entries = await JournalEntry.find({ project: project._id });
  assert.equal(entries.length, 0);
});

test('a project created before this phase (no startDate/deliveryDate) remains readable (backward compatibility)', async () => {
  // Simulates a pre-existing document written before startDate/deliveryDate existed - bypasses
  // Mongoose validation entirely (raw collection insert), the same way real historical data would
  // predate the new required fields. Reading it back must not throw, even though `required` would
  // reject creating a NEW document without these fields - Mongoose only enforces `required` on
  // write, never retroactively on read.
  await mongoose.connection.collection('projects').insertOne({
    projectNumber: 'PRJ-LEGACY-01',
    contractValue: 750,
    remainingMoney: 750,
    projectManager: user._id,
    status: 'active',
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const legacyProject = await Project.findOne({ projectNumber: 'PRJ-LEGACY-01' });
  assert.ok(legacyProject, 'a legacy project document missing the new required date fields must still be readable');
  // startDate/deliveryDate now have `default: null` on the schema, so a stored document that
  // lacks them hydrates as `null` (Mongoose applies schema defaults at hydration time too), not
  // `undefined` - functionally equivalent for every existing "missing" check in this codebase
  // (`!= null`), but the exact value to assert here.
  assert.equal(legacyProject.startDate, null);
  assert.equal(legacyProject.deliveryDate, null);
});

test('a project created before the projectAmount/executor/department rename (not yet migrated) is readable with contractValue/projectManager undefined, not throwing', async () => {
  // Regression test for the reported frontend crash: "Cannot read properties of undefined
  // (reading 'toLocaleString')" on the Projects page. Root cause was that a pre-rename document
  // (raw MongoDB field `projectAmount`, not `contractValue`) had never been run through
  // scripts/migrateProjectFieldRenames.js - Mongoose only exposes schema-defined paths, so
  // `contractValue`/`projectManager` come back `undefined` for such a document, which the
  // frontend's `.toLocaleString()` calls didn't guard against. This test locks in that reading
  // such a document (a) never throws at the model layer, and (b) leaves the old raw field
  // untouched (nothing silently deletes it), so migrateProjectFieldRenames.js still has something
  // to migrate later.
  await mongoose.connection.collection('projects').insertOne({
    projectNumber: 'PRJ-UNMIGRATED-01',
    projectAmount: 4200, // old field name - deliberately NOT contractValue
    remainingMoney: 4200,
    executor: user._id, // old field name - deliberately NOT projectManager
    department: 'Villa', // old field name - deliberately NOT sector
    status: 'active',
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const unmigrated = await Project.findOne({ projectNumber: 'PRJ-UNMIGRATED-01' });
  assert.ok(unmigrated, 'an unmigrated legacy project must still be readable, not throw');
  // contractValue/projectManager now have `default: null`, so they hydrate as `null` rather than
  // `undefined` for a document that never had them - the frontend's existing `!= null` guards
  // already treat both the same way (render "-", never fabricate 0).
  assert.equal(unmigrated.contractValue, null, 'contractValue is genuinely unset until migrated - this is what the frontend must render as "-", never as 0');
  assert.equal(unmigrated.projectManager, null);
  assert.equal(unmigrated.remainingMoney, 4200, 'remainingMoney was never renamed, so it survives untouched even before migration');

  const { recalculateRemainingMoney } = require('../../services/project/projectAccountingService');
  await recalculateRemainingMoney(unmigrated._id);
  const afterRecalc = await Project.findById(unmigrated._id);
  assert.equal(afterRecalc.remainingMoney, 4200, 'recalculateRemainingMoney must skip (not overwrite with NaN) when contractValue is missing');
});

test('a project can have a customer, and it persists/populates on read', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-CUST-01', customer: customer._id }));

  const found = await Project.findById(project._id);
  assert.equal(found.customer._id.toString(), customer._id.toString());
  assert.equal(found.customer.name, 'Test Customer');
});

test('a project with no customer defaults to null, not throwing', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-CUST-02' }));
  const found = await Project.findById(project._id);
  assert.equal(found.customer, null);
});

test('Average Cost: accepts COGS accounts and derives the total from the lines', async () => {
  const project = await Project.create(
    baseProjectData({
      projectNumber: 'PRJ-COST-01',
      averageCostLines: [
        { account: cogsAccountA._id, amount: 20000 },
        { account: cogsAccountB._id, amount: 10000 },
      ],
    })
  );

  assert.equal(project.averageCost, 30000);

  const found = await Project.findById(project._id);
  assert.equal(found.averageCost, 30000);
  assert.equal(found.averageCostLines.length, 2);
  assert.equal(found.averageCostLines[0].account.code, cogsAccountA.code, 'the account reference populates, not just a name/label');
});

test('Average Cost: rejects a non-COGS account', async () => {
  await assert.rejects(
    () => Project.create(baseProjectData({ projectNumber: 'PRJ-COST-02', averageCostLines: [{ account: nonCogsAccount._id, amount: 1000 }] })),
    /not eligible for Average Cost/
  );
});

test('Average Cost: rejects a duplicate account across lines', async () => {
  await assert.rejects(
    () =>
      Project.create(
        baseProjectData({
          projectNumber: 'PRJ-COST-03',
          averageCostLines: [
            { account: cogsAccountA._id, amount: 20000 },
            { account: cogsAccountA._id, amount: 5000 },
          ],
        })
      ),
    /can only appear once/
  );
});

test('Average Cost: a line amount must be greater than 0', async () => {
  await assert.rejects(
    () => Project.create(baseProjectData({ projectNumber: 'PRJ-COST-04', averageCostLines: [{ account: cogsAccountA._id, amount: 0 }] })),
    /Cost amount must be greater than 0/
  );
});

test('Average Cost: a project with no lines defaults averageCost to 0', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-COST-05' }));
  assert.equal(project.averageCost, 0);
});

test('Average Cost: updating lines recomputes the total', async () => {
  const project = await Project.create(
    baseProjectData({ projectNumber: 'PRJ-COST-06', averageCostLines: [{ account: cogsAccountA._id, amount: 20000 }] })
  );
  assert.equal(project.averageCost, 20000);

  project.averageCostLines = [
    { account: cogsAccountA._id, amount: 20000 },
    { account: cogsAccountB._id, amount: 15000 },
  ];
  await project.save();
  assert.equal(project.averageCost, 35000);
});

// ===================== Executed % = Sales (before tax) / Contract Value x 100 =====================

test('Executed %: defaults to 0 with no Sales Orders', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-EXEC-01', contractValue: 1000000 }));
  assert.equal(project.executedPercentage, 0);
});

test('Executed %: a single Sales Order contributes its pre-tax totalAmount, not its VAT-inclusive grandTotal', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-EXEC-02', contractValue: 1000000 }));

  await SalesOrder.create(fakeSalesOrder({
    project: project._id,
    items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 200000, starterQuantity: 1 }],
    vatPercentage: 14,
    withholdingTaxPercentage: 1,
  }));

  await recalculateExecutedPercentage(project._id);
  const updated = await Project.findById(project._id);
  // 200,000 / 1,000,000 x 100 = 20% - VAT/WHT must never be part of the numerator.
  assert.equal(updated.executedPercentage, 20);
});

test('Executed %: multiple Sales Orders for the SAME project are summed', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-EXEC-03', contractValue: 1000000 }));

  await SalesOrder.create(fakeSalesOrder({ project: project._id, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 200000, starterQuantity: 1 }] }));
  await SalesOrder.create(fakeSalesOrder({ project: project._id, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 100000, starterQuantity: 1 }] }));
  await SalesOrder.create(fakeSalesOrder({ project: project._id, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 50000, starterQuantity: 1 }] }));

  await recalculateExecutedPercentage(project._id);
  const updated = await Project.findById(project._id);
  // (200,000 + 100,000 + 50,000) / 1,000,000 x 100 = 35%
  assert.equal(updated.executedPercentage, 35);
});

test('Executed %: a Sales Order for a DIFFERENT project never contributes', async () => {
  const projectA = await Project.create(baseProjectData({ projectNumber: 'PRJ-EXEC-04A', contractValue: 1000000 }));
  const projectB = await Project.create(baseProjectData({ projectNumber: 'PRJ-EXEC-04B', contractValue: 1000000 }));

  await SalesOrder.create(fakeSalesOrder({ project: projectB._id, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 300000, starterQuantity: 1 }] }));

  await recalculateExecutedPercentage(projectA._id);
  await recalculateExecutedPercentage(projectB._id);

  assert.equal((await Project.findById(projectA._id)).executedPercentage, 0, "Project A must stay at 0% - it has no Sales Orders of its own");
  assert.equal((await Project.findById(projectB._id)).executedPercentage, 30);
});

test('Executed %: a canceled Sales Order is excluded from the total', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-EXEC-05', contractValue: 1000000 }));

  const order = await SalesOrder.create(fakeSalesOrder({ project: project._id, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 400000, starterQuantity: 1 }] }));
  await recalculateExecutedPercentage(project._id);
  assert.equal((await Project.findById(project._id)).executedPercentage, 40);

  order.orderStatus = 'canceled';
  await order.save();
  await recalculateExecutedPercentage(project._id);
  assert.equal((await Project.findById(project._id)).executedPercentage, 0, 'canceling the only Sales Order must drop Executed % back to 0, not leave the stale value');
});

test('Executed %: contractValue of 0 never produces NaN/Infinity, falls back to 0%', async () => {
  // contractValue has its own `min: 0.01` validator, so creating one at exactly 0 must bypass
  // Mongoose validation (raw collection insert) - the same way a genuinely invalid/legacy value
  // could reach the database by some other path. recalculateExecutedPercentage must still handle
  // it safely, never dividing by zero.
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-EXEC-06', contractValue: 1000000 }));
  await mongoose.connection.collection('projects').updateOne({ _id: project._id }, { $set: { contractValue: 0 } });

  await SalesOrder.create(fakeSalesOrder({ project: project._id, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 100000, starterQuantity: 1 }] }));

  await recalculateExecutedPercentage(project._id);
  const updated = await Project.findById(project._id);
  assert.equal(updated.executedPercentage, 0);
  assert.ok(Number.isFinite(updated.executedPercentage), 'must never be NaN or Infinity');
});

test('Executed %: over-selling beyond the contract value clamps to 100%, never exceeds the schema\'s own max', async () => {
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-EXEC-07', contractValue: 100000 }));
  await SalesOrder.create(fakeSalesOrder({ project: project._id, items: [{ product: new mongoose.Types.ObjectId(), unitPrice: 150000, starterQuantity: 1 }] }));

  await recalculateExecutedPercentage(project._id);
  assert.equal((await Project.findById(project._id)).executedPercentage, 100);
});

test('Executed %: a client-supplied executedPercentage is never accepted by Project.create via the controller field set (model-level default still applies)', async () => {
  // This locks in the model's own default - the controller-level "never accepted from the client"
  // behavior is covered by projectController.js no longer destructuring executedPercentage at all
  // (see createProject/updateProject), which is a controller-layer guarantee this model test
  // cannot directly exercise, but the schema default documented here is what it falls back to.
  const project = await Project.create(baseProjectData({ projectNumber: 'PRJ-EXEC-08', contractValue: 1000000 }));
  assert.equal(project.executedPercentage, 0);
});
