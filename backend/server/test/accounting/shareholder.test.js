const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Equity module (services/equity/shareholderService.js): shareholders with their own unique
// Shareholder Number and ownership (active shareholders <= 100% together), and capital
// contributions posting Dr the payment account / Cr the equity account with the Shareholder
// Number as Sub Account - all-or-nothing.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_shareholders';

let Shareholder, ChartOfAccount, JournalEntry, Counter;
let createShareholder, updateShareholder, addContribution, getEquityAccountOptions;
let transactionsSupported = true;
let accounts;

const idStr = ref => String(ref?._id || ref);
const codeOf = id => Object.keys(accounts).find(key => idStr(accounts[key]) === idStr(id));

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Shareholder = require('../../models/equity/shareholderModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  Counter = require('../../models/config/counterModel');
  ({ createShareholder, updateShareholder, addContribution, getEquityAccountOptions } = require('../../services/equity/shareholderService'));
  await Promise.all([Shareholder.init(), ChartOfAccount.init(), JournalEntry.init()]);

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
  await Promise.all([Shareholder, ChartOfAccount, JournalEntry, Counter].map(M => M.deleteMany({})));
  accounts = {
    capital: await ChartOfAccount.create({ code: '20000001', name: 'Share Capital', type: 'equity' }),
    reserves: await ChartOfAccount.create({ code: '20000002', name: 'Legal Reserve', type: 'equity' }),
    revenue: await ChartOfAccount.create({ code: '60000001', name: 'Revenue', type: 'revenue' }),
    bank: await ChartOfAccount.create({ code: '11000001', name: 'Bank Misr', type: 'asset', parentGroupNameEn: 'Cash & Cash Equivalents' }),
  };
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

const create = data => inTx(session => createShareholder({ equityAccount: accounts.capital._id, ...data }, null, session));
const contribute = (shareholder, data) => inTx(session => addContribution(shareholder._id, { paymentAccount: accounts.bank._id, ...data }, null, session));

test('equity account options are the active equity accounts', async () => {
  assert.deepEqual((await getEquityAccountOptions()).map(a => a.name), ['Share Capital', 'Legal Reserve']);
});

test('shareholders get unique sequential numbers and keep their ownership percentage', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const a = await create({ name: 'Ahmed', ownershipPercentage: 60 });
  const b = await create({ name: 'Mona', ownershipPercentage: 40, shareholderNumber: 999 });
  assert.equal(a.shareholderNumber, 1);
  assert.equal(b.shareholderNumber, 2, 'a client-supplied number is ignored');
  assert.equal((await Shareholder.findById(a._id).lean()).ownershipPercentage, 60);
  await Shareholder.updateOne({ _id: a._id }, { $set: { shareholderNumber: 5 } });
  assert.equal((await Shareholder.findById(a._id).lean()).shareholderNumber, 1, 'the number never changes');
});

test('ownership must be 0-100% and active shareholders cannot exceed 100% together', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => create({ name: 'Too much', ownershipPercentage: 101 }), /cannot exceed 100/);
  await assert.rejects(() => create({ name: 'Negative', ownershipPercentage: -1 }), /cannot be negative/);
  const a = await create({ name: 'Ahmed', ownershipPercentage: 70 });
  await assert.rejects(() => create({ name: 'Mona', ownershipPercentage: 31 }), /would total 101% - it cannot exceed 100%/);
  await create({ name: 'Mona', ownershipPercentage: 30 });
  await inTx(session => updateShareholder(a._id, { status: 'inactive' }, session));
  await create({ name: 'Omar', ownershipPercentage: 70 }); // the inactive shareholder no longer counts
  assert.equal(await Shareholder.countDocuments({}), 3);
});

test('a contribution posts Dr bank / Cr equity with the Shareholder Number on every line', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const shareholder = await create({ name: 'Ahmed', ownershipPercentage: 50 });
  await contribute(shareholder, { amount: 500000, date: '2026-09-15', reference: 'DEP-1' });

  const stored = await Shareholder.findById(shareholder._id).lean();
  assert.equal(stored.shareCapital, 500000);
  assert.equal(stored.contributions.length, 1);
  const entry = await JournalEntry.findById(stored.contributions[0].journalEntry).lean();
  assert.equal(entry.accountingAction, 'SHAREHOLDER_CONTRIBUTION');
  assert.equal(entry.module, 'Equity');
  assert.equal(entry.description, 'Capital contribution - Ahmed (DEP-1)');
  assert.deepEqual(
    entry.lines.map(l => [codeOf(l.account), l.debit, l.credit]),
    [
      ['bank', 500000, 0],
      ['capital', 0, 500000],
    ]
  );
  assert.equal(entry.totalDebit, entry.totalCredit);
  for (const line of entry.lines) {
    assert.equal(line.partyNumber, shareholder.shareholderNumber, 'Sub Account = Shareholder Number');
    assert.equal(line.partyType, 'shareholder');
    assert.equal(line.description, entry.description);
  }

  // Another equity account can be chosen for a contribution.
  await contribute(shareholder, { amount: 1000, equityAccount: accounts.reserves._id });
  assert.equal((await Shareholder.findById(shareholder._id).lean()).shareCapital, 501000);
});

test('a shareholder can be created with a first contribution in the same transaction', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const shareholder = await create({ name: 'Mona', ownershipPercentage: 25, contribution: { amount: 250000, paymentAccount: accounts.bank._id } });
  assert.equal((await Shareholder.findById(shareholder._id).lean()).shareCapital, 250000);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'SHAREHOLDER_CONTRIBUTION' }), 1);
});

test('wrong accounts and amounts are refused', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => create({ name: 'X', ownershipPercentage: 10, equityAccount: accounts.revenue._id }), /equity account/);
  const shareholder = await create({ name: 'Ahmed', ownershipPercentage: 10 });
  await assert.rejects(() => contribute(shareholder, { amount: 100, paymentAccount: accounts.capital._id }), /Cash or Cash Equivalent/);
  await assert.rejects(() => contribute(shareholder, { amount: 100, equityAccount: accounts.revenue._id }), /equity account/);
  await assert.rejects(() => contribute(shareholder, { amount: 0 }), /greater than 0/);
  assert.equal(await JournalEntry.countDocuments({}), 0);
  assert.equal((await Shareholder.findById(shareholder._id).lean()).shareCapital, 0);
});

test('a failure while posting the contribution entry rolls everything back', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const existing = await create({ name: 'Ahmed', ownershipPercentage: 10 });
  const originalCreate = JournalEntry.create;
  JournalEntry.create = function (docs, ...rest) {
    if (Array.isArray(docs) && docs[0]?.accountingAction === 'SHAREHOLDER_CONTRIBUTION') throw new Error('forced contribution failure');
    return originalCreate.call(this, docs, ...rest);
  };
  try {
    await assert.rejects(() => contribute(existing, { amount: 1000 }), /forced contribution failure/);
    await assert.rejects(() => create({ name: 'Mona', ownershipPercentage: 10, contribution: { amount: 5000, paymentAccount: accounts.bank._id } }), /forced contribution failure/);
  } finally {
    JournalEntry.create = originalCreate;
  }
  assert.equal((await Shareholder.findById(existing._id).lean()).shareCapital, 0);
  assert.equal(await Shareholder.countDocuments({}), 1, 'the new shareholder was rolled back');
  assert.equal(await JournalEntry.countDocuments({}), 0);
});

test('concurrent contributions are applied one at a time - the share capital always equals the posted entries', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const shareholder = await create({ name: 'Ahmed', ownershipPercentage: 10 });
  await Promise.allSettled([contribute(shareholder, { amount: 100 }), contribute(shareholder, { amount: 200 }), contribute(shareholder, { amount: 300 })]);
  const stored = await Shareholder.findById(shareholder._id).lean();
  const posted = await JournalEntry.find({ accountingAction: 'SHAREHOLDER_CONTRIBUTION' }).lean();
  assert.equal(stored.shareCapital, posted.reduce((sum, e) => sum + e.totalDebit, 0));
  assert.equal(stored.contributions.length, posted.length);
});
