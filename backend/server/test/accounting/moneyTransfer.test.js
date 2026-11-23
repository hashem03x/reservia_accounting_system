const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Transfer Money (services/accounting/moneyTransferService.js, controller/inventory/
// transferController.js#transferMoney): real Cash/Cash-Equivalent Chart of Accounts accounts
// (never a hardcoded paymentMethod string), one balanced automatic journal entry per transfer -
// Dr the destination account / Cr the source one - atomic with the two Payment records, reversible
// through the normal, generic Journal Entry "Reverse" action.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_money_transfer';

let ChartOfAccount, JournalEntry, Warehouse, Payment, Currency;
let transferMoney, reverseJournalEntry;
let transactionsSupported = true;
let warehouseA, warehouseB, accounts;

const idStr = ref => String(ref?._id || ref);
const codeOf = id => Object.keys(accounts).find(key => idStr(accounts[key]) === idStr(id));
const linesOf = entry => entry.lines.map(l => [codeOf(l.account?._id || l.account), l.debit, l.credit]);

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
    Promise.resolve(handler({ headers: {}, query: {}, body: {}, params: {}, user: { _id: new mongoose.Types.ObjectId() }, ...req }, res, err => (err ? reject(err) : resolve({ status: res.statusCode })))).catch(reject);
  });
}

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Warehouse = require('../../models/inventory/warehouseModel');
  Payment = require('../../models/vendor/paymentModel');
  // paymentModel.js's pre('save') hook unconditionally resolves the Vendor model by name.
  require('../../models/vendor/vendor');
  require('../../models/vendor/purchaseOrder');
  require('../../models/userModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  Currency = require('../../models/accounting/currencyModel');
  ({ transferMoney } = require('../../services/accounting/moneyTransferService'));
  ({ reverseJournalEntry } = require('../../controller/accounting/journalEntryController'));
  await Promise.all([Warehouse.init(), Payment.init(), ChartOfAccount.init(), JournalEntry.init(), Currency.init()]);

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
  await Promise.all([Warehouse, Payment, ChartOfAccount, JournalEntry, Currency].map(M => M.deleteMany({})));
  accounts = {
    cashA: await ChartOfAccount.create({ code: '11000001', name: 'Bank Misr', type: 'asset', parentGroupNameEn: 'Cash & Cash Equivalents' }),
    cashB: await ChartOfAccount.create({ code: '11000002', name: 'NBE Current', type: 'asset', state: 'cash-equivalent' }),
    expenseAcc: await ChartOfAccount.create({ code: '61000001', name: 'Office Rent', type: 'expense' }),
  };
  warehouseA = await Warehouse.create({ name: 'Head Office', location: 'Cairo', balance: 50000 });
  warehouseB = await Warehouse.create({ name: 'Branch', location: 'Giza', balance: 10000 });
});

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

const TRANSFER = (overrides = {}) => ({
  fromWarehouseId: warehouseA._id,
  toWarehouseId: warehouseB._id,
  fromAccount: accounts.cashA._id,
  toAccount: accounts.cashB._id,
  amount: 2000,
  date: new Date('2026-09-01'),
  ...overrides,
});
const run = (data, userId) => inTx(session => transferMoney(data, userId || new mongoose.Types.ObjectId(), session));

// 1. Happy path.
test('transferMoney posts Dr destination / Cr source for a same-currency transfer, and updates both warehouse balances', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const { paymentOut, paymentIn, journalEntry, amount } = await run(TRANSFER());
  assert.equal(amount, 2000);

  assert.equal(paymentOut.type, 'out');
  assert.equal(idStr(paymentOut.paymentAccount), idStr(accounts.cashA._id));
  assert.equal(paymentIn.type, 'in');
  assert.equal(idStr(paymentIn.paymentAccount), idStr(accounts.cashB._id));

  assert.equal(journalEntry.accountingAction, 'MONEY_TRANSFER');
  assert.equal(journalEntry.sourceType, 'PAYMENT');
  assert.equal(idStr(journalEntry.sourceId), idStr(paymentOut._id));
  assert.deepEqual(linesOf(journalEntry), [
    ['cashB', 2000, 0],
    ['cashA', 0, 2000],
  ]);

  assert.equal((await Warehouse.findById(warehouseA._id).lean()).balance, 48000);
  assert.equal((await Warehouse.findById(warehouseB._id).lean()).balance, 12000);
});

// 2. Only Cash/Cash-Equivalent accounts qualify.
test('only Cash/Cash-Equivalent accounts can be the source or destination; nothing is created otherwise', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => run(TRANSFER({ fromAccount: accounts.expenseAcc._id })), /Cash or Cash Equivalent/);
  assert.equal(await Payment.countDocuments({}), 0);
  assert.equal(await JournalEntry.countDocuments({}), 0);

  await assert.rejects(() => run(TRANSFER({ toAccount: accounts.expenseAcc._id })), /Cash or Cash Equivalent/);
  assert.equal(await Payment.countDocuments({}), 0);
});

// 3. Source and destination must differ.
test('transferring an account to itself is rejected', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => run(TRANSFER({ toAccount: accounts.cashA._id })), /must be different/);
  assert.equal(await Payment.countDocuments({}), 0);
});

// 4. Nonexistent warehouse rejected.
test('a nonexistent source or target warehouse is rejected, nothing created', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => run(TRANSFER({ fromWarehouseId: new mongoose.Types.ObjectId() })), /Source warehouse does not exist/);
  assert.equal(await Payment.countDocuments({}), 0);
  await assert.rejects(() => run(TRANSFER({ toWarehouseId: new mongoose.Types.ObjectId() })), /Target warehouse does not exist/);
});

// 5. Amount must be positive.
test('amount must be greater than 0', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => run(TRANSFER({ amount: 0 })), /greater than 0/);
  await assert.rejects(() => run(TRANSFER({ amount: -5 })), /greater than 0/);
});

// 6. Atomic rollback: a failure while posting the journal entry leaves no Payment behind either.
test('a failure while posting the journal entry rolls back the Payments too - never a half-written transfer', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const originalCreate = JournalEntry.create;
  JournalEntry.create = function () {
    throw new Error('simulated posting failure');
  };
  try {
    await assert.rejects(() => run(TRANSFER()), /simulated posting failure/);
  } finally {
    JournalEntry.create = originalCreate;
  }
  assert.equal(await Payment.countDocuments({}), 0);
  assert.equal((await Warehouse.findById(warehouseA._id).lean()).balance, 50000);
  assert.equal((await Warehouse.findById(warehouseB._id).lean()).balance, 10000);
});

// 7. Reversal through the normal, generic Journal Entry "Reverse" action - never deletes the original.
test('the transfer entry can be reversed through the normal Journal Entry Reverse action, which never deletes the original', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const { journalEntry } = await run(TRANSFER());

  const { status, body } = await callHandler(reverseJournalEntry, { params: { id: String(journalEntry._id) }, body: { reversalDate: new Date('2026-09-02') } });
  assert.equal(status, 201);

  const original = await JournalEntry.findById(journalEntry._id).lean();
  assert.equal(original.status, 'reversed');
  assert.ok(original.reversedByEntry, 'the original entry still exists, just marked reversed');

  const reversal = await JournalEntry.findById(original.reversedByEntry).lean();
  assert.equal(reversal.reversalOfEntry.toString(), original._id.toString());
  assert.deepEqual(linesOf(reversal), [
    ['cashB', 0, 2000],
    ['cashA', 2000, 0],
  ]);
  assert.ok(body);
});

// 8. Two independent transfers each get their own entry - legitimate repeats are never deduplicated.
test('two separate transfers each post their own independent journal entry', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const first = await run(TRANSFER());
  const second = await run(TRANSFER({ amount: 500 }));
  assert.notEqual(idStr(first.journalEntry._id), idStr(second.journalEntry._id));
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'MONEY_TRANSFER' }), 2);
  assert.equal((await Warehouse.findById(warehouseA._id).lean()).balance, 50000 - 2000 - 500);
});

// 9. Multi-currency: foreignAmount/currency convert to the real EGP amount via the Currency registry.
test('a foreign-currency transfer converts to EGP using the real Currency Manager rate - both legs carry the identical EGP amount, no gain/loss', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  // 1 EGP = 0.02 USD -> 1 USD = 50 EGP.
  await Currency.create({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02, isBase: false, isActive: true, rateEffectiveDate: new Date('2026-01-01') });

  const { amount, journalEntry } = await run(TRANSFER({ amount: undefined, currency: 'USD', foreignAmount: 100 }));
  assert.equal(amount, 5000);
  assert.deepEqual(linesOf(journalEntry), [
    ['cashB', 5000, 0],
    ['cashA', 0, 5000],
  ]);
  assert.match(journalEntry.description, /100\.00 USD @ 50\.0000/);
});

// 10. An unconfigured/inactive currency is rejected clearly - never an invented rate.
test('an unconfigured currency is rejected clearly, never falling back to an invented rate', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => run(TRANSFER({ amount: undefined, currency: 'XYZ', foreignAmount: 100 })), /not a configured currency/);
  assert.equal(await Payment.countDocuments({}), 0);

  await Currency.create({ code: 'EUR', name: 'Euro', unitsPerBase: 0.018, isBase: false, isActive: false });
  await assert.rejects(() => run(TRANSFER({ amount: undefined, currency: 'EUR', foreignAmount: 100 })), /inactive/);
});

// 11. A foreign-currency transfer requires a positive foreign amount.
test('a foreign-currency transfer requires a positive foreign amount', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await Currency.create({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02, isBase: false, isActive: true });
  await assert.rejects(() => run(TRANSFER({ amount: undefined, currency: 'USD', foreignAmount: 0 })), /foreign amount greater than 0/);
});
