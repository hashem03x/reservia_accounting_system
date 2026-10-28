const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Journal Entry table filtering/sorting (docs section "Table Filtering, Sorting, and Search" ->
// "Journal Entries table"). Exercises the real middleware chain directly: `createJournalEntryFilterObject`
// (builds req.filterObject from named query params, deleting each consumed param from req.query so
// apiFeatures.filter() never sees - and is broken by - a raw, non-schema query key) followed by
// `getJournalEntries` (applies the sort whitelist, then the existing generic list handler).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_je_filtering';

let JournalEntry, ChartOfAccount, Project, User;
let getJournalEntries, createJournalEntryFilterObject;

function callHandler(handlers, req) {
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
    const fullReq = { headers: {}, query: {}, body: {}, params: {}, ...req };
    const chain = Array.isArray(handlers) ? handlers : [handlers];

    function runNext(index) {
      if (index >= chain.length) return;
      Promise.resolve(
        chain[index](fullReq, res, err => {
          if (err) return reject(err);
          runNext(index + 1);
        }),
      ).catch(reject);
    }
    runNext(0);
  });
}

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  ({ getJournalEntries, createJournalEntryFilterObject } = require('../../controller/accounting/journalEntryController'));
  await Promise.all([JournalEntry.init(), ChartOfAccount.init(), Project.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
let bank, rent, manager, project1, project2;

beforeEach(async () => {
  await Promise.all(['journalentries', 'chartofaccounts', 'projects', 'users'].map(c => mongoose.connection.collection(c).deleteMany({})));
  seq += 1;
  bank = await ChartOfAccount.create({ code: `BANK-${seq}`, name: 'Bank', type: 'asset' });
  rent = await ChartOfAccount.create({ code: `RENT-${seq}`, name: 'Rent Expense', type: 'expense' });
  manager = await User.create({ name: 'JE Filter Manager', email: `je-filter-${seq}@example.com`, role: 'admin', type: 'online' });
  project1 = await Project.create({ projectNumber: `JEF-${seq}A`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  project2 = await Project.create({ projectNumber: `JEF-${seq}B`, projectManager: manager._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });

  await JournalEntry.collection.insertMany([
    { entryNumber: 100, date: new Date('2026-01-10'), description: 'Office rent payment', status: 'posted', source: 'manual', project: project1._id,
      lines: [{ account: bank._id, debit: 0, credit: 500, description: 'Bank', partyNumber: null }, { account: rent._id, debit: 500, credit: 0, description: 'Rent' }],
      totalDebit: 500, totalCredit: 500 },
    { entryNumber: 101, date: new Date('2026-02-15'), description: 'Equipment purchase', status: 'draft', source: 'manual', project: project2._id,
      lines: [{ account: bank._id, debit: 0, credit: 1200, description: 'Bank' }, { account: rent._id, debit: 1200, credit: 0, description: 'Equipment', partyNumber: 55 }],
      totalDebit: 1200, totalCredit: 1200 },
    { entryNumber: 102, date: new Date('2026-03-01'), description: 'General adjustment', status: 'posted', source: 'manual', project: null,
      lines: [{ account: bank._id, debit: 10, credit: 0, description: 'Adj' }, { account: rent._id, debit: 0, credit: 10, description: 'Adj' }],
      totalDebit: 10, totalCredit: 10 },
  ]);
});

async function list(query) {
  return callHandler([createJournalEntryFilterObject, getJournalEntries], { query });
}

// ===================== Filters =====================

test('filters by exact entryNumber', async () => {
  const res = await list({ entryNumber: '101' });
  assert.deepEqual(res.body.data.map(e => e.entryNumber), [101]);
});

test('filters by date range (dateFrom/dateTo)', async () => {
  const res = await list({ dateFrom: '2026-02-01', dateTo: '2026-02-28' });
  assert.deepEqual(res.body.data.map(e => e.entryNumber), [101]);
});

test('filters by account number - only entries with a line on that account', async () => {
  const res = await list({ accountNumber: rent.code });
  assert.deepEqual(res.body.data.map(e => e.entryNumber).sort(), [100, 101, 102]);
});

test('filters by an unknown account number - returns zero rows, never every row', async () => {
  const res = await list({ accountNumber: 'DOES-NOT-EXIST' });
  assert.equal(res.body.data.length, 0);
});

test('filters by account name (partial, case-insensitive)', async () => {
  const res = await list({ accountName: 'rent' });
  assert.deepEqual(res.body.data.map(e => e.entryNumber).sort(), [100, 101, 102]);
});

test('filters by subaccount/party number', async () => {
  const res = await list({ subAccount: '55' });
  assert.deepEqual(res.body.data.map(e => e.entryNumber), [101]);
});

test('filters by project number', async () => {
  const res = await list({ projectNumber: project1.projectNumber });
  assert.deepEqual(res.body.data.map(e => e.entryNumber), [100]);
});

test('filters by "general" projectNumber to find entries with no project', async () => {
  const res = await list({ projectNumber: 'general' });
  assert.deepEqual(res.body.data.map(e => e.entryNumber), [102]);
});

test('filters by description (partial, case-insensitive)', async () => {
  const res = await list({ description: 'equipment' });
  assert.deepEqual(res.body.data.map(e => e.entryNumber), [101]);
});

test('filters by debit/credit range', async () => {
  const res = await list({ debitMin: '600' });
  assert.deepEqual(res.body.data.map(e => e.entryNumber), [101]);
});

test('filters by status', async () => {
  const res = await list({ status: 'draft' });
  assert.deepEqual(res.body.data.map(e => e.entryNumber), [101]);
});

test('combines multiple filters (status + project)', async () => {
  const res = await list({ status: 'posted', projectNumber: project1.projectNumber });
  assert.deepEqual(res.body.data.map(e => e.entryNumber), [100]);
});

test('an unrecognized query param never leaks into the Mongo filter and breaks the list', async () => {
  const res = await list({ bogusParam: 'xyz' });
  assert.equal(res.body.data.length, 3, 'a param this controller does not know about must be ignored, not misapplied as a filter');
});

// ===================== Sorting (whitelisted) =====================

test('defaults to entryNumber ascending when no sort is given', async () => {
  const res = await list({});
  assert.deepEqual(res.body.data.map(e => e.entryNumber), [100, 101, 102]);
});

test('sorts by totalDebit descending when explicitly requested', async () => {
  const res = await list({ sort: '-totalDebit' });
  assert.deepEqual(res.body.data.map(e => e.entryNumber), [101, 100, 102]);
});

test('an unwhitelisted sort field falls back to the default (entryNumber ascending) instead of being passed through', async () => {
  const res = await list({ sort: 'description' });
  assert.deepEqual(res.body.data.map(e => e.entryNumber), [100, 101, 102]);
});

test('filters by Project / G&A classification - a legacy entry with a project reads as Project, one without is unclassified (never G&A)', async () => {
  await JournalEntry.collection.insertOne({
    entryNumber: 103,
    date: new Date('2026-03-05'),
    description: 'Office supplies (G&A)',
    status: 'posted',
    source: 'manual',
    project: null,
    classification: 'ga',
    currency: 'USD',
    currencyUnitsPerBase: 0.02,
    lines: [{ account: bank._id, debit: 0, credit: 20, description: 'G&A' }, { account: rent._id, debit: 20, credit: 0, description: 'G&A' }],
    totalDebit: 20,
    totalCredit: 20,
  });
  const numbers = async query => (await list(query)).body.data.map(e => e.entryNumber).sort((a, b) => a - b);
  assert.deepEqual(await numbers({ classification: 'project' }), [100, 101]);
  assert.deepEqual(await numbers({ classification: 'ga' }), [103]);
  assert.deepEqual(await numbers({ classification: 'unclassified' }), [102]);
  assert.deepEqual(await numbers({ classification: 'bogus' }), [], 'an unknown value returns no rows, never every row');
  // Combined with another filter.
  assert.deepEqual(await numbers({ classification: 'project', status: 'draft' }), [101]);

  // Currency: the entry currency, or EGP for entries recorded in the base currency.
  assert.deepEqual(await numbers({ currency: 'usd' }), [103]);
  assert.deepEqual(await numbers({ currency: 'EGP' }), [100, 101, 102]);
  assert.deepEqual(await numbers({ currency: 'EUR' }), []);
});

test('sorts oldest-first and newest-first by date and by entry number across the whole (paginated) result', async () => {
  const order = async sort => (await list({ sort, limit: '2', page: '1' })).body.data.map(e => e.entryNumber);
  assert.deepEqual(await order(undefined), [100, 101], 'default: entry number ascending');
  assert.deepEqual(await order('-entryNumber'), [102, 101], 'newest number first, from the whole set - not just the loaded page');
  assert.deepEqual(await order('date'), [100, 101]);
  assert.deepEqual(await order('-date'), [102, 101]);
});
