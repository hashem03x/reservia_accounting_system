const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Currency Manager: the rate convention and conversion math (utils/currencyMath.js), currency CRUD
// and the EGP base invariants (services/accounting/currencyService.js), the real /currencies route
// stack (permissions + validation), and Journal Entries in a foreign currency - conversion to EGP,
// the frozen applied rate, reversals, and historical stability when a rate changes later.
//
// Convention throughout: 1 EGP = unitsPerBase units of the currency. USD @ 0.02 -> 1 USD = 50 EGP.

const DB_URI = process.env.TEST_DB_URI_CURRENCIES || 'mongodb://127.0.0.1:27017/reversia_test_currencies';

const math = require('../../utils/currencyMath');

let Currency, JournalEntry, ChartOfAccount, Project, User;
let currencyService, currencyRoute, journalEntryRoute;
let createJournalEntry, updateJournalEntry, postJournalEntry, reverseJournalEntry, getJournalEntries;
let getTrialBalance;
let admin, cash, revenue, project;
let transactionsSupported = true;

// Runs an express handler with a fake req/res; resolves { status, body } or rejects with the error.
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
    Promise.resolve(handler({ headers: {}, query: {}, body: {}, params: {}, user: admin, ...req }, res, err => (err ? reject(err) : resolve({ status: res.statusCode })))).catch(
      reject
    );
  });
}

// The real middleware stack of one route (permission check -> validators -> controller), minus the
// router-level `protect` (req.user is supplied directly). Resolves { status, body }; an error passed
// to next() resolves as { status: err.statusCode, error }.
function routeStack(router, method, path) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${path} exists`);
  return layer.route.stack.filter(s => s.method === method).map(s => s.handle);
}
async function runRoute(router, method, path, req) {
  const handlers = routeStack(router, method, path);
  const fullReq = { headers: {}, query: {}, body: {}, params: {}, user: admin, ...req };
  for (const handler of handlers) {
    // eslint-disable-next-line no-await-in-loop
    const outcome = await new Promise(resolve => {
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          resolve({ done: true, status: this.statusCode, body });
        },
      };
      Promise.resolve(handler(fullReq, res, err => resolve(err ? { done: true, status: err.statusCode || 500, error: err } : { done: false }))).catch(err =>
        resolve({ done: true, status: err.statusCode || 500, error: err })
      );
    });
    if (outcome.done) return outcome;
  }
  return { status: 200 };
}

const statusOf = async promise => {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    return `${err.statusCode || 'error'}: ${err.message}`;
  }
};

const erp = { systemMemberships: [{ system: 'ERP', isActive: true }] };
const userWith = permissions => ({ _id: new mongoose.Types.ObjectId(), role: 'moderator', permissions, ...erp });

const line = (account, debit, credit) => ({ account: account._id, description: 'Test line', debit, credit });

async function createEntry(body) {
  const { body: res } = await callHandler(createJournalEntry, { body: { project: project._id, description: 'Currency test', ...body } });
  return JournalEntry.findById(res.data._id);
}

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Currency = require('../../models/accounting/currencyModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  currencyService = require('../../services/accounting/currencyService');
  currencyRoute = require('../../routes/accounting/currencyRoute');
  journalEntryRoute = require('../../routes/accounting/journalEntryRoute');
  ({ createJournalEntry, updateJournalEntry, postJournalEntry, reverseJournalEntry, getJournalEntries } = require('../../controller/accounting/journalEntryController'));
  ({ getTrialBalance } = require('../../services/accounting/generalLedgerService'));
  await Promise.all([Currency.init(), JournalEntry.init(), ChartOfAccount.init(), Project.init()]);

  const probeSession = await mongoose.startSession();
  try {
    await probeSession.withTransaction(async () => {
      await mongoose.connection.collection('__txn_probe').insertOne({ ok: 1 }, { session: probeSession });
    });
    await mongoose.connection
      .collection('__txn_probe')
      .drop()
      .catch(() => {});
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
  await Promise.all([Currency.deleteMany({}), JournalEntry.deleteMany({}), ChartOfAccount.deleteMany({}), Project.deleteMany({}), User.deleteMany({})]);
  await mongoose.connection.collection('counters').deleteMany({});
  await mongoose.connection.collection('advancedpayments').deleteMany({});
  admin = await User.create({ name: 'Currency Admin', email: `cur-admin-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  admin = { ...admin.toObject(), role: 'admin', ...erp };
  cash = await ChartOfAccount.create({ code: '1000', name: 'Cash', type: 'asset' });
  revenue = await ChartOfAccount.create({ code: '4000', name: 'Revenue', type: 'revenue' });
  project = await Project.create({ projectNumber: `PRJ-CUR-${Date.now()}`, projectManager: admin._id, startDate: new Date(), deliveryDate: new Date(Date.now() + 86400000) });
});

// ---------------------------------------------------------------- conversion math

test('math: inverse rate and conversion follow "1 EGP = X units" (USD @ 0.02 -> 1 USD = 50 EGP)', () => {
  assert.equal(math.basePerUnit(0.02), 50);
  assert.equal(math.toBaseAmount(100, 0.02), 5000, '100 USD / 0.02 = 5,000 EGP');
  assert.equal(math.basePerUnit(1), 1, 'EGP inverse is 1');
  // Full precision is used, never a rounded display value: 1 EGP = 0.0204 USD -> 1 USD = 49.0196... EGP.
  // 1000 / 0.0204 = 49,019.61; converting with the rounded inverse (49.02) would give 49,020.00.
  assert.equal(math.toBaseAmount(1000, 0.0204), 49019.61);
});

test('math: invalid rates are rejected (0, negative, NaN, Infinity, non-numbers)', () => {
  for (const bad of [0, -1, NaN, Infinity, -Infinity, '0.02', null, undefined]) {
    assert.equal(math.isValidRate(bad), false, `${String(bad)} is not a valid rate`);
  }
  assert.equal(math.parseRate('0.02'), 0.02);
  assert.equal(math.parseRate('abc'), null);
  assert.equal(math.parseRate('-5'), null);
  assert.throws(() => math.toBaseAmount(10, 0), /greater than zero/);
});

test('math: lines balanced in the currency stay balanced in EGP - rounding residue goes to the largest line', () => {
  // 3 x 33.33 + 0.01 debit vs 100 credit at 1 EGP = 0.03 USD: each line rounds separately.
  const lines = [
    { debit: 33.33, credit: 0 },
    { debit: 33.33, credit: 0 },
    { debit: 33.34, credit: 0 },
    { debit: 0, credit: 100 },
  ];
  const base = math.convertLinesToBase(lines, 0.03);
  const d = math.round2(base.reduce((s, l) => s + l.debit, 0));
  const c = math.round2(base.reduce((s, l) => s + l.credit, 0));
  assert.equal(d, c, 'EGP totals balance');
  assert.equal(c, 3333.33);
  assert.throws(
    () =>
      math.convertLinesToBase(
        [
          { debit: 100, credit: 0 },
          { debit: 0, credit: 90 },
        ],
        0.02
      ),
    /not balanced/,
    'a real imbalance is never absorbed'
  );
});

// ---------------------------------------------------------------- CRUD + base invariants

test('base currency: EGP is created once, even by concurrent callers, with rate 1', async () => {
  await Promise.all([currencyService.ensureBaseCurrency(), currencyService.ensureBaseCurrency(), currencyService.ensureBaseCurrency()]);
  const all = await Currency.find({});
  assert.equal(all.length, 1);
  assert.equal(all[0].code, 'EGP');
  assert.equal(all[0].isBase, true);
  assert.equal(all[0].unitsPerBase, 1);
});

test('create: a currency is created with its rate, inverse rate and first history item', async () => {
  const usd = await currencyService.createCurrency({ code: ' usd ', name: 'US Dollar', symbol: '$', unitsPerBase: 0.02, rateEffectiveDate: '2026-01-01' }, admin._id);
  assert.equal(usd.code, 'USD', 'code is trimmed and upper-cased');
  assert.equal(usd.unitsPerBase, 0.02);
  assert.equal(usd.basePerUnit, 50);
  assert.equal(usd.isActive, true);
  assert.equal(usd.rateHistory.length, 1);

  const fetched = await currencyService.getCurrency('USD');
  assert.equal(fetched.name, 'US Dollar');
  assert.equal(fetched.usageCount, 0);
});

test('create: duplicate codes (any case), EGP, bad codes and invalid rates are refused', async () => {
  await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02 });
  assert.match(await statusOf(currencyService.createCurrency({ code: 'usd', name: 'Again', unitsPerBase: 0.02 })), /^400: .*already exists/);
  assert.match(await statusOf(currencyService.createCurrency({ code: 'EGP', name: 'Pound', unitsPerBase: 1 })), /^400: .*base currency/);
  assert.match(await statusOf(currencyService.createCurrency({ code: 'US', name: 'Bad', unitsPerBase: 1 })), /^400: .*3 letters/);
  for (const rate of [0, -0.5, 'abc', Infinity, '']) {
    // eslint-disable-next-line no-await-in-loop
    assert.match(await statusOf(currencyService.createCurrency({ code: 'EUR', name: 'Euro', unitsPerBase: rate })), /^400: Exchange rate/, `rate ${String(rate)}`);
  }
  assert.equal(await Currency.countDocuments({ code: 'EUR' }), 0);
});

test('base invariants: EGP cannot change rate, be deactivated or deleted; no other currency can be the base', async () => {
  const egp = await currencyService.ensureBaseCurrency();
  assert.match(await statusOf(currencyService.updateCurrency(egp._id, { unitsPerBase: 2 })), /^400: .*always has an exchange rate of 1/);
  assert.match(await statusOf(currencyService.updateCurrency(egp._id, { isActive: false })), /^400: .*cannot be deactivated/);
  assert.match(await statusOf(currencyService.deleteCurrency(egp._id)), /^400: .*cannot be deleted/);
  // Renaming the base currency is allowed.
  const renamed = await currencyService.updateCurrency(egp._id, { name: 'Egyptian Pound (EGP)' });
  assert.equal(renamed.name, 'Egyptian Pound (EGP)');
  // Model-level backstops, whatever code path writes.
  await assert.rejects(Currency.create({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02, isBase: true }), /Only EGP can be the base/);
  egp.unitsPerBase = 3;
  await assert.rejects(egp.save(), /always 1/);
});

test('update: a new rate is added to the history; the rate for a date follows the history; a back-dated rate does not replace the current one', async () => {
  const usd = await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02, rateEffectiveDate: '2026-01-01' });
  const v1 = await currencyService.updateCurrency(usd._id, { unitsPerBase: 0.025, rateEffectiveDate: '2026-03-01' });
  assert.equal(v1.unitsPerBase, 0.025);
  assert.equal(v1.basePerUnit, 40);
  assert.equal(v1.rateHistory.length, 2);

  const back = await currencyService.updateCurrency(usd._id, { unitsPerBase: 0.022, rateEffectiveDate: '2026-02-01' });
  assert.equal(back.unitsPerBase, 0.025, 'the latest-dated rate stays current');
  assert.equal(back.rateHistory.length, 3);

  const rateOn = async d => (await currencyService.getRateForDate('USD', new Date(d))).unitsPerBase;
  assert.equal(await rateOn('2026-01-15'), 0.02);
  assert.equal(await rateOn('2026-02-01'), 0.022, 'effective from the start of its day');
  assert.equal(await rateOn('2026-04-01'), 0.025);
  const early = await currencyService.getRateForDate('USD', new Date('2025-06-01'));
  assert.equal(early.unitsPerBase, 0.02);
  assert.equal(early.isFallback, true, 'before the first rate: earliest rate, flagged');

  // Same effective date again corrects that day's rate instead of adding a duplicate.
  const fixed = await currencyService.updateCurrency(usd._id, { unitsPerBase: 0.026, rateEffectiveDate: '2026-03-01' });
  assert.equal(fixed.rateHistory.length, 3);
  assert.equal(fixed.unitsPerBase, 0.026);
});

test('update: a stale expectedVersion (concurrent edit) is refused with 409 and changes nothing', async () => {
  const usd = await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02 });
  const loadedVersion = usd.__v;
  await currencyService.updateCurrency(usd._id, { name: 'Dollar', expectedVersion: loadedVersion });
  assert.match(await statusOf(currencyService.updateCurrency(usd._id, { unitsPerBase: 0.03, expectedVersion: loadedVersion })), /^409: /);
  assert.equal((await Currency.findById(usd._id)).unitsPerBase, 0.02);
});

test('delete: an unused currency is deleted; one used by a journal entry (even a legacy lower-case line) or an advance is refused - deactivation still works', async () => {
  const eur = await currencyService.createCurrency({ code: 'EUR', name: 'Euro', unitsPerBase: 0.018 });
  await currencyService.deleteCurrency(eur._id);
  assert.equal(await Currency.countDocuments({ code: 'EUR' }), 0);

  const usd = await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02 });
  await JournalEntry.collection.insertOne({
    entryNumber: 1,
    date: new Date(),
    status: 'posted',
    lines: [{ account: cash._id, debit: 50, credit: 0, currency: 'usd', exchangeRate: 50 }],
  });
  assert.match(await statusOf(currencyService.deleteCurrency(usd._id)), /^400: .*used by 1 accounting record.*Deactivate/);
  const deactivated = await currencyService.updateCurrency(usd._id, { isActive: false });
  assert.equal(deactivated.isActive, false);
  assert.equal(deactivated.usageCount, 1);

  const try_ = await currencyService.createCurrency({ code: 'TRY', name: 'Lira', unitsPerBase: 0.6 });
  await mongoose.connection.collection('advancedpayments').insertOne({ currency: 'TRY', amount: 10 });
  assert.match(await statusOf(currencyService.deleteCurrency(try_._id)), /^400: /);
});

test('list: base first, keyword search, status filter, sorting and pagination', async () => {
  await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02 });
  await currencyService.createCurrency({ code: 'EUR', name: 'Euro', unitsPerBase: 0.018 });
  const cny = await currencyService.createCurrency({ code: 'CNY', name: 'Chinese Yuan', unitsPerBase: 0.15 });
  await currencyService.updateCurrency(cny._id, { isActive: false });

  const all = await currencyService.listCurrencies();
  assert.deepEqual(
    all.data.map(c => c.code),
    ['EGP', 'CNY', 'EUR', 'USD']
  );
  assert.equal(all.data[0].basePerUnit, 1);
  assert.equal(all.data[3].basePerUnit, 50);

  assert.deepEqual(
    (await currencyService.listCurrencies({ keyword: 'dollar' })).data.map(c => c.code),
    ['USD']
  );
  assert.deepEqual(
    (await currencyService.listCurrencies({ status: 'inactive' })).data.map(c => c.code),
    ['CNY']
  );
  assert.deepEqual(
    (await currencyService.listCurrencies({ status: 'active', sort: '-unitsPerBase' })).data.map(c => c.code),
    ['EGP', 'USD', 'EUR']
  );
  const page2 = await currencyService.listCurrencies({ page: 2, limit: 3 });
  assert.deepEqual(
    page2.data.map(c => c.code),
    ['USD']
  );
  assert.equal(page2.paginationResult.numberOfPages, 2);
  assert.equal(page2.totalCount, 4);
});

// ---------------------------------------------------------------- routes: permissions + validation

test('routes: managing currencies needs the currencies permission; reading also works with journalEntries:read', async () => {
  const jeReader = userWith([{ resource: 'journalEntries', actions: ['read'] }]);
  const list = await runRoute(currencyRoute, 'get', '/', { user: jeReader });
  assert.equal(list.status, 200);
  assert.equal(list.body.data[0].code, 'EGP');

  const create = await runRoute(currencyRoute, 'post', '/', { user: jeReader, body: { code: 'USD', name: 'US Dollar', unitsPerBase: 0.02 } });
  assert.equal(create.status, 403);

  const nobody = userWith([]);
  assert.equal((await runRoute(currencyRoute, 'get', '/', { user: nobody })).status, 403);
  const noErp = { ...userWith([{ resource: 'currencies', actions: ['read'] }]), systemMemberships: [] };
  assert.equal((await runRoute(currencyRoute, 'get', '/', { user: noErp })).status, 403, 'ERP access is required');

  const manager = userWith([{ resource: 'currencies', actions: ['create', 'read', 'update', 'delete'] }]);
  const created = await runRoute(currencyRoute, 'post', '/', { user: manager, body: { code: 'USD', name: 'US Dollar', unitsPerBase: '0.02' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.unitsPerBase, 0.02);
  assert.equal(await Currency.countDocuments({}), 2);
});

test('routes: invalid requests are refused by the server-side validators', async () => {
  const bad = async body => (await runRoute(currencyRoute, 'post', '/', { body })).status;
  assert.equal(await bad({ code: 'USD', name: 'US Dollar', unitsPerBase: 0 }), 400);
  assert.equal(await bad({ code: 'USD', name: 'US Dollar', unitsPerBase: -1 }), 400);
  assert.equal(await bad({ code: 'USD', name: 'US Dollar', unitsPerBase: 'abc' }), 400);
  assert.equal(await bad({ code: 'USD', name: 'US Dollar' }), 400, 'rate is required');
  assert.equal(await bad({ code: 'USDX', name: 'US Dollar', unitsPerBase: 0.02 }), 400);
  assert.equal(await bad({ code: 'USD', name: '   ', unitsPerBase: 0.02 }), 400);

  const usd = await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02 });
  const rename = await runRoute(currencyRoute, 'patch', '/:id', { params: { id: String(usd._id) }, body: { code: 'EUR' } });
  assert.equal(rename.status, 400, 'the code can never change');

  const je = await runRoute(journalEntryRoute, 'post', '/', {
    body: { project: String(project._id), currency: 'USD', exchangeRate: 0, lines: [line(cash, 100, 0), line(revenue, 0, 100)] },
  });
  assert.equal(je.status, 400, 'a journal entry with rate 0 is refused');
});

// ---------------------------------------------------------------- journal entries

test('journal entry in USD: amounts entered in USD are stored in EGP, with the currency amounts and the applied rate', async () => {
  await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02 });
  const entry = await createEntry({ currency: 'usd', exchangeRate: 0.02, lines: [line(cash, 100, 0), line(revenue, 0, 100)] });

  assert.equal(entry.currency, 'USD');
  assert.equal(entry.currencyUnitsPerBase, 0.02);
  assert.equal(entry.totalDebit, 5000, 'EGP totals: 100 USD / 0.02');
  assert.equal(entry.totalCredit, 5000);
  const [dr, cr] = entry.lines;
  assert.equal(dr.debit, 5000);
  assert.equal(dr.currencyDebit, 100);
  assert.equal(cr.credit, 5000);
  assert.equal(cr.currencyCredit, 100);
  assert.equal(dr.currency, 'USD');
  assert.equal(dr.exchangeRate, 50, 'the legacy per-line rate keeps its EGP-per-unit convention');

  const { body } = await callHandler(getJournalEntries, { query: {} });
  const listed = body.data.find(e => String(e._id) === String(entry._id));
  assert.equal(listed.currency, 'USD');
  assert.equal(listed.rate, 50);
});

test('journal entry: an omitted rate uses the currency rate effective on the entry date', async () => {
  const usd = await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02, rateEffectiveDate: '2026-01-01' });
  await currencyService.updateCurrency(usd._id, { unitsPerBase: 0.025, rateEffectiveDate: '2026-06-01' });

  const january = await createEntry({ date: '2026-02-10', currency: 'USD', lines: [line(cash, 10, 0), line(revenue, 0, 10)] });
  assert.equal(january.currencyUnitsPerBase, 0.02);
  assert.equal(january.totalDebit, 500);
  const july = await createEntry({ date: '2026-07-10', currency: 'USD', lines: [line(cash, 10, 0), line(revenue, 0, 10)] });
  assert.equal(july.currencyUnitsPerBase, 0.025);
  assert.equal(july.totalDebit, 400);
});

test('journal entry: unknown or inactive currencies, a non-1 EGP rate and invalid rates are refused by the backend', async () => {
  const usd = await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02 });
  const lines = [line(cash, 100, 0), line(revenue, 0, 100)];
  assert.match(await statusOf(createEntry({ currency: 'XYZ', lines })), /^400: .*not a configured currency/);
  assert.match(await statusOf(createEntry({ currency: 'EGP', exchangeRate: 2, lines })), /^400: .*rate of 1/);
  assert.match(await statusOf(createEntry({ currency: 'USD', exchangeRate: -3, lines })), /^400: Exchange rate/);
  await currencyService.updateCurrency(usd._id, { isActive: false });
  assert.match(await statusOf(createEntry({ currency: 'USD', lines })), /^400: .*inactive/);
  assert.equal(await JournalEntry.countDocuments({}), 0);
});

test('journal entry in EGP (and with no currency at all) behaves exactly as before', async () => {
  const entry = await createEntry({ lines: [line(cash, 123.45, 0), line(revenue, 0, 123.45)] });
  assert.equal(entry.currency, 'EGP');
  assert.equal(entry.currencyUnitsPerBase, 1);
  assert.equal(entry.totalDebit, 123.45);
  assert.equal(entry.lines[0].currency, null);
  assert.equal(entry.lines[0].currencyDebit, null);

  // A client cannot smuggle its own line currency fields in.
  const smuggled = await createEntry({ lines: [{ ...line(cash, 10, 0), currency: 'USD', exchangeRate: 99, currencyDebit: 1 }, line(revenue, 0, 10)] });
  assert.equal(smuggled.lines[0].currency, null);
  assert.equal(smuggled.lines[0].exchangeRate, null);
  assert.equal(smuggled.lines[0].currencyDebit, null);

  // An entry written before this feature (no currency fields at all) still reads as EGP @ 1.
  await JournalEntry.collection.insertOne({
    entryNumber: 999,
    date: new Date(),
    status: 'posted',
    lines: [
      { account: cash._id, debit: 5, credit: 0 },
      { account: revenue._id, debit: 0, credit: 5 },
    ],
    totalDebit: 5,
    totalCredit: 5,
  });
  const legacy = await JournalEntry.findOne({ entryNumber: 999 });
  assert.equal(legacy.currency, 'EGP');
  assert.equal(legacy.currencyUnitsPerBase, 1);
});

test('historical stability: changing a currency rate later never changes existing entries or the trial balance', async () => {
  const usd = await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02, rateEffectiveDate: '2026-01-01' });
  const entry = await createEntry({ date: '2026-02-01', currency: 'USD', lines: [line(cash, 100, 0), line(revenue, 0, 100)] });
  await callHandler(postJournalEntry, { params: { id: String(entry._id) } });
  const trialBalanceBefore = await getTrialBalance();

  await currencyService.updateCurrency(usd._id, { unitsPerBase: 0.04, rateEffectiveDate: '2026-01-01' });
  await currencyService.updateCurrency(usd._id, { unitsPerBase: 0.05 });

  const reloaded = await JournalEntry.findById(entry._id);
  assert.equal(reloaded.currencyUnitsPerBase, 0.02);
  assert.equal(reloaded.totalDebit, 5000);
  assert.equal(reloaded.lines[0].debit, 5000);
  assert.deepEqual(await getTrialBalance(), trialBalanceBefore);
});

test('draft edit: re-sent lines keep the applied rate; an explicit new rate re-converts the stored currency amounts', async () => {
  await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02 });
  const entry = await createEntry({ currency: 'USD', exchangeRate: 0.02, lines: [line(cash, 100, 0), line(revenue, 0, 100)] });

  const relined = await callHandler(updateJournalEntry, { params: { id: String(entry._id) }, body: { lines: [line(cash, 200, 0), line(revenue, 0, 200)] } });
  assert.equal(relined.body.data.currencyUnitsPerBase, 0.02);
  assert.equal(relined.body.data.totalDebit, 10000);

  const repriced = await callHandler(updateJournalEntry, { params: { id: String(entry._id) }, body: { exchangeRate: 0.04 } });
  assert.equal(repriced.body.data.currencyUnitsPerBase, 0.04);
  assert.equal(repriced.body.data.lines[0].currencyDebit, 200, 'currency amounts unchanged');
  assert.equal(repriced.body.data.totalDebit, 5000, '200 USD / 0.04');

  const toEgp = await callHandler(updateJournalEntry, { params: { id: String(entry._id) }, body: { currency: 'EGP' } });
  assert.equal(toEgp.body.data.currency, 'EGP');
  assert.equal(toEgp.body.data.totalDebit, 200, 'switching to EGP keeps the entered amounts, now in EGP');
  assert.equal(toEgp.body.data.lines[0].currencyDebit, null);
});

test('posted entries: currency and rate are frozen (model backstop); reversal mirrors them at the same applied rate', async t => {
  await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.02 });
  const entry = await createEntry({ currency: 'USD', exchangeRate: 0.02, lines: [line(cash, 100, 0), line(revenue, 0, 100)] });
  await callHandler(postJournalEntry, { params: { id: String(entry._id) } });

  const posted = await JournalEntry.findById(entry._id);
  posted.currencyUnitsPerBase = 0.03;
  await assert.rejects(posted.save(), /cannot have their currency or exchange rate changed/);
  await assert.rejects(callHandler(updateJournalEntry, { params: { id: String(entry._id) }, body: { exchangeRate: 0.03 } }), /Only draft/);

  if (!transactionsSupported) {
    t.skip('MongoDB transactions are not available on this server');
    return;
  }
  const { body } = await callHandler(reverseJournalEntry, { params: { id: String(entry._id) }, body: { reversalDate: new Date().toISOString() } });
  const reversal = await JournalEntry.findById(body.data._id);
  assert.equal(reversal.currency, 'USD');
  assert.equal(reversal.currencyUnitsPerBase, 0.02);
  assert.equal(reversal.lines[0].credit, 5000);
  assert.equal(reversal.lines[0].currencyCredit, 100);
  assert.equal(reversal.lines[1].currencyDebit, 100);
  const cashRow = (await getTrialBalance()).find(r => r.account.code === '1000');
  assert.equal(cashRow.debit, 5000);
  assert.equal(cashRow.credit, 5000);
  assert.equal(cashRow.balance, 0, 'original + reversal net to zero in EGP');
});

test('rounding: a 3-line USD entry balanced in USD is saved balanced in EGP', async () => {
  await currencyService.createCurrency({ code: 'USD', name: 'US Dollar', unitsPerBase: 0.03 });
  const entry = await createEntry({
    currency: 'USD',
    exchangeRate: 0.03,
    lines: [line(cash, 33.33, 0), line(cash, 33.33, 0), line(cash, 33.34, 0), line(revenue, 0, 100)],
  });
  assert.equal(entry.totalDebit, entry.totalCredit);
  assert.equal(entry.totalCredit, 3333.33);
});
