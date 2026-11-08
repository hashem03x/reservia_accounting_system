const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Equity module (services/equity/shareholderService.js + services/equity/companyCapitalService.js):
// shareholders with their own unique Shareholder Number and ownership (active shareholders <=
// 100% together), Issued/Paid-in/Unpaid Capital computed at read time, capital contributions
// posting Dr the payment account / Cr the equity account with the Shareholder Number as Sub
// Account - all-or-nothing - gated on a complete (Issued Capital set, active ownership = 100%)
// capital structure and never exceeding a shareholder's allocated share or Issued Capital itself.
//
// Capital contributions ALWAYS post to two FIXED accounts, resolved server-side by Chart of
// Accounts code (AutomaticJournalAccountCodes.capitalContributionBankAccount = '11000001',
// .capitalContributionEquityAccount = '20000001') - addContribution no longer reads
// `paymentAccount`/`equityAccount` from its input at all, so a caller can never redirect a
// contribution to a different account, not even accidentally. `accounts.bank`/`accounts.capital`
// below are seeded at exactly those two codes for this reason.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_shareholders';

let Shareholder, ChartOfAccount, JournalEntry, Counter, CompanyCapital;
let createShareholder, updateShareholder, addContribution, getEquityAccountOptions, setupCapitalStructure;
let setIssuedCapital, getCompanyCapital;
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
  CompanyCapital = require('../../models/equity/companyCapitalModel');
  ({ createShareholder, updateShareholder, addContribution, getEquityAccountOptions, setupCapitalStructure } = require('../../services/equity/shareholderService'));
  ({ setIssuedCapital, getCompanyCapital } = require('../../services/equity/companyCapitalService'));
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
  await Promise.all([Shareholder, ChartOfAccount, JournalEntry, Counter, CompanyCapital].map(M => M.deleteMany({})));
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
const setCapital = amount => inTx(session => setIssuedCapital(amount, null, session));

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

test('a contribution posts Dr bank / Cr equity with the Shareholder Number on the equity line only', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setCapital(2000000); // Ahmed's 50% allocates 1,000,000 - enough room for both contributions below
  const shareholder = await create({ name: 'Ahmed', ownershipPercentage: 50 });
  await create({ name: 'Mona', ownershipPercentage: 50 }); // completes the 100% capital structure
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
  const [bankLine, equityLine] = entry.lines;
  assert.equal(bankLine.partyNumber ?? null, null, 'no shareholder sub-account on the bank line');
  assert.equal(bankLine.partyType ?? null, null);
  assert.equal(equityLine.partyNumber, shareholder.shareholderNumber, 'Sub Account = Shareholder Number');
  assert.equal(equityLine.partyType, 'shareholder');
  for (const line of entry.lines) assert.equal(line.description, entry.description);

  // Submitting a DIFFERENT (even ineligible) equity/payment account has NO effect - the service
  // never reads either field - every contribution still lands on the same two fixed accounts.
  await contribute(shareholder, { amount: 1000, equityAccount: accounts.reserves._id, paymentAccount: accounts.revenue._id });
  const updated = await Shareholder.findById(shareholder._id).lean();
  assert.equal(updated.shareCapital, 501000);
  const second = updated.contributions[1];
  assert.equal(idStr(second.paymentAccount), idStr(accounts.bank._id), 'the submitted paymentAccount override was ignored');
  assert.equal(idStr(second.equityAccount), idStr(accounts.capital._id), 'the submitted equityAccount override was ignored');
});

test('a shareholder can be created with a first contribution in the same transaction', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setCapital(1000000);
  await create({ name: 'Omar', ownershipPercentage: 75 });
  const shareholder = await create({ name: 'Mona', ownershipPercentage: 25, contribution: { amount: 250000, paymentAccount: accounts.bank._id } });
  assert.equal((await Shareholder.findById(shareholder._id).lean()).shareCapital, 250000);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'SHAREHOLDER_CONTRIBUTION' }), 1);
});

test('a shareholder\'s own default equity account is still validated; non-positive contribution amounts are refused', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => create({ name: 'X', ownershipPercentage: 10, equityAccount: accounts.revenue._id }), /equity account/);
  await setCapital(1000000);
  const shareholder = await create({ name: 'Ahmed', ownershipPercentage: 100 });
  await assert.rejects(() => contribute(shareholder, { amount: 0 }), /greater than 0/);
  await assert.rejects(() => contribute(shareholder, { amount: -5 }), /greater than 0/);
  assert.equal(await JournalEntry.countDocuments({}), 0);
  assert.equal((await Shareholder.findById(shareholder._id).lean()).shareCapital, 0);
});

// Regression/acceptance coverage for "manipulate account IDs through the API -> backend enforces
// fixed accounts": a wrong/ineligible `paymentAccount`/`equityAccount` submitted in the request no
// longer causes a validation error (the old "wrong accounts are refused" behavior) - the fields
// are simply never read, so the contribution posts normally, to the fixed accounts only.
test('manipulated or ineligible account ids in the request are silently ignored, never applied', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setCapital(1000000);
  const shareholder = await create({ name: 'Ahmed', ownershipPercentage: 100 });
  const fakeId = new mongoose.Types.ObjectId();
  await contribute(shareholder, { amount: 100, paymentAccount: accounts.revenue._id, equityAccount: accounts.revenue._id });
  await contribute(shareholder, { amount: 50, paymentAccount: fakeId, equityAccount: fakeId }); // ids that don't even exist
  const stored = await Shareholder.findById(shareholder._id).lean();
  assert.equal(stored.shareCapital, 150);
  for (const c of stored.contributions) {
    assert.equal(idStr(c.paymentAccount), idStr(accounts.bank._id));
    assert.equal(idStr(c.equityAccount), idStr(accounts.capital._id));
  }
  const entries = await JournalEntry.find({ accountingAction: 'SHAREHOLDER_CONTRIBUTION' }).lean();
  for (const entry of entries) {
    assert.deepEqual(entry.lines.map(l => codeOf(l.account)), ['bank', 'capital']);
  }
});

// Acceptance coverage: "If the NBE account or Capital account cannot be found or is inactive,
// return a clear validation error. Never silently select another account."
test('contributions are refused with a clear error if the fixed bank or capital account is missing or inactive', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setCapital(1000000);
  const shareholder = await create({ name: 'Ahmed', ownershipPercentage: 100 });

  await ChartOfAccount.updateOne({ _id: accounts.bank._id }, { $set: { isActive: false } });
  await assert.rejects(() => contribute(shareholder, { amount: 100 }), /account 11000001 \(NBE\)/);
  await ChartOfAccount.updateOne({ _id: accounts.bank._id }, { $set: { isActive: true } });

  await ChartOfAccount.deleteOne({ _id: accounts.capital._id });
  await assert.rejects(() => contribute(shareholder, { amount: 100 }), /account 20000001 \(Capital\)/);

  assert.equal(await JournalEntry.countDocuments({}), 0, 'nothing was posted for either failed attempt');
  assert.equal((await Shareholder.findById(shareholder._id).lean()).shareCapital, 0);
});

test('a failure while posting the contribution entry rolls everything back', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setCapital(1000000);
  const existing = await create({ name: 'Ahmed', ownershipPercentage: 90 });
  await create({ name: 'Mona', ownershipPercentage: 10 });
  const originalCreate = JournalEntry.create;
  JournalEntry.create = function (docs, ...rest) {
    if (Array.isArray(docs) && docs[0]?.accountingAction === 'SHAREHOLDER_CONTRIBUTION') throw new Error('forced contribution failure');
    return originalCreate.call(this, docs, ...rest);
  };
  try {
    await assert.rejects(() => contribute(existing, { amount: 1000 }), /forced contribution failure/);
  } finally {
    JournalEntry.create = originalCreate;
  }
  assert.equal((await Shareholder.findById(existing._id).lean()).shareCapital, 0);
  assert.equal(await Shareholder.countDocuments({}), 2);
  assert.equal(await JournalEntry.countDocuments({}), 0);
});

test('concurrent contributions are applied one at a time - the share capital always equals the posted entries', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setCapital(1000000);
  const shareholder = await create({ name: 'Ahmed', ownershipPercentage: 100 });
  await Promise.allSettled([contribute(shareholder, { amount: 100 }), contribute(shareholder, { amount: 200 }), contribute(shareholder, { amount: 300 })]);
  const stored = await Shareholder.findById(shareholder._id).lean();
  const posted = await JournalEntry.find({ accountingAction: 'SHAREHOLDER_CONTRIBUTION' }).lean();
  assert.equal(stored.shareCapital, posted.reduce((sum, e) => sum + e.totalDebit, 0));
  assert.equal(stored.contributions.length, posted.length);
});

// ===================== Company Capital (Issued / Paid-in / Unpaid) =====================

test('company capital is null until Issued Capital is set, then issued/paid-in/unpaid stay in sync with real contributions', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  assert.equal(await getCompanyCapital(), null);
  await setCapital(1000000);
  assert.deepEqual(await getCompanyCapital(), { issuedCapital: 1000000, paidInCapital: 0, unpaidCapital: 1000000 });

  const a = await create({ name: 'Ahmed', ownershipPercentage: 60 });
  await create({ name: 'Mona', ownershipPercentage: 40 });
  await contribute(a, { amount: 200000 });
  assert.deepEqual(await getCompanyCapital(), { issuedCapital: 1000000, paidInCapital: 200000, unpaidCapital: 800000 });

  await contribute(a, { amount: 100000 });
  assert.deepEqual(await getCompanyCapital(), { issuedCapital: 1000000, paidInCapital: 300000, unpaidCapital: 700000 });
});

test('issued capital must be positive and cannot be set below what is already paid in', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => setCapital(0), /greater than 0/);
  await assert.rejects(() => setCapital(-5), /greater than 0/);
  await setCapital(1000000);
  const a = await create({ name: 'Ahmed', ownershipPercentage: 100 });
  await contribute(a, { amount: 600000 });
  await assert.rejects(() => setCapital(500000), /cannot be set below the 600000 already paid in/);
  await setCapital(600000); // exactly what's paid in is fine
  assert.equal((await getCompanyCapital()).issuedCapital, 600000);
});

// ===================== Finalization gate (active ownership must total 100%) =====================

test('contributions are refused until Issued Capital is set and active ownership totals exactly 100%', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const noCapitalSet = await create({ name: 'Ahmed', ownershipPercentage: 100 });
  await assert.rejects(() => contribute(noCapitalSet, { amount: 1000 }), /Set the company.s Issued Capital/);
  await inTx(session => updateShareholder(noCapitalSet._id, { status: 'inactive' }, session)); // free up its 100% for the real scenario below

  await setCapital(1000000);
  const a = await create({ name: 'Ahmed2', ownershipPercentage: 60 });
  await create({ name: 'Mona', ownershipPercentage: 30 }); // 90% total - not finalized yet
  await assert.rejects(() => contribute(a, { amount: 1000 }), /totals 90%, not 100%/);

  await create({ name: 'Omar', ownershipPercentage: 10 }); // now 100%
  await contribute(a, { amount: 1000 }); // succeeds
  assert.equal((await Shareholder.findById(a._id).lean()).shareCapital, 1000);
});

// ===================== Overpayment prevention =====================

test('a payment cannot push a shareholder above their allocated capital (ownership % x Issued Capital)', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setCapital(1000000);
  const a = await create({ name: 'Ahmed', ownershipPercentage: 60 }); // allocated 600,000
  await create({ name: 'Mona', ownershipPercentage: 40 });

  await contribute(a, { amount: 300000 });
  await assert.rejects(() => contribute(a, { amount: 350000 }), /above their allocated 600000/); // 300,000 + 350,000 = 650,000 > 600,000
  await contribute(a, { amount: 300000 }); // exactly reaches 600,000
  assert.equal((await Shareholder.findById(a._id).lean()).shareCapital, 600000);
  await assert.rejects(() => contribute(a, { amount: 1 }), /above their allocated 600000/); // fully paid - any more is refused
});

test('total payments across all shareholders cannot exceed Issued Capital', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setCapital(100);
  const a = await create({ name: 'Ahmed', ownershipPercentage: 100 });
  await assert.rejects(() => contribute(a, { amount: 150 }), /above their allocated 100/);
});

// ===================== Duplicate payment submissions (idempotency) =====================

test('a retried contribution with the same idempotencyKey is never posted twice', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await setCapital(1000000);
  const a = await create({ name: 'Ahmed', ownershipPercentage: 100 });
  await contribute(a, { amount: 50000, idempotencyKey: 'dialog-1' });
  await contribute(a, { amount: 50000, idempotencyKey: 'dialog-1' }); // the user double-clicked / the request was retried
  const stored = await Shareholder.findById(a._id).lean();
  assert.equal(stored.contributions.length, 1, 'only one contribution was recorded');
  assert.equal(stored.shareCapital, 50000);
  assert.equal(await JournalEntry.countDocuments({ accountingAction: 'SHAREHOLDER_CONTRIBUTION' }), 1);

  // A genuinely different payment (different key) is still recorded normally.
  await contribute(a, { amount: 25000, idempotencyKey: 'dialog-2' });
  assert.equal((await Shareholder.findById(a._id).lean()).shareCapital, 75000);
});

// ===================== National ID, nameAr, address =====================

test('National ID must be a structurally valid 14-digit Egyptian ID and unique across shareholders', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(() => create({ name: 'Ahmed', ownershipPercentage: 10, nationalId: '12345' }), /valid 14-digit Egyptian National ID/);
  await assert.rejects(() => create({ name: 'Ahmed', ownershipPercentage: 10, nationalId: '29902301234567' }), /valid 14-digit Egyptian National ID/); // 30 Feb 1999 does not exist
  const a = await create({ name: 'Ahmed', nameAr: 'أحمد', address: 'Maadi, Cairo', ownershipPercentage: 10, nationalId: '29001011234567' });
  assert.equal(a.nationalId, '29001011234567');
  assert.equal(a.nameAr, 'أحمد');
  assert.equal(a.address, 'Maadi, Cairo');
  await assert.rejects(() => create({ name: 'Someone Else', ownershipPercentage: 10, nationalId: '29001011234567' }), /already exists/);
});

// ===================== Bulk capital structure setup (Scenario 1) =====================

test('setupCapitalStructure creates Issued Capital and every shareholder together, atomically', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const created = await inTx(session =>
    setupCapitalStructure(
      {
        issuedCapital: 1000000,
        shareholders: [
          { name: 'Ahmed', nameAr: 'أحمد', address: 'Maadi', nationalId: '29001011234561', ownershipPercentage: 60, equityAccount: accounts.capital._id },
          { name: 'Mona', nameAr: 'منى', address: 'Zamalek', nationalId: '29001011234562', ownershipPercentage: 40, equityAccount: accounts.capital._id },
        ],
      },
      null,
      session
    )
  );
  assert.equal(created.length, 2);
  assert.equal(created[0].shareholderNumber, 1);
  assert.equal(created[1].shareholderNumber, 2);
  assert.deepEqual(await getCompanyCapital(), { issuedCapital: 1000000, paidInCapital: 0, unpaidCapital: 1000000 });
  assert.equal(await Shareholder.countDocuments({}), 2);
});

test('setupCapitalStructure rolls back everything (Issued Capital included) if any shareholder is invalid', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await assert.rejects(
    () =>
      inTx(session =>
        setupCapitalStructure(
          {
            issuedCapital: 1000000,
            shareholders: [
              { name: 'Ahmed', nameAr: 'أحمد', address: 'Maadi', nationalId: '29001011234561', ownershipPercentage: 60, equityAccount: accounts.capital._id },
              { name: 'Mona', nameAr: 'منى', address: 'Zamalek', nationalId: '29001011234562', ownershipPercentage: 60, equityAccount: accounts.capital._id }, // 60+60 > 100%
            ],
          },
          null,
          session
        )
      ),
    /cannot exceed 100%/
  );
  assert.equal(await getCompanyCapital(), null, 'Issued Capital was rolled back too - nothing half-committed');
  assert.equal(await Shareholder.countDocuments({}), 0);
});

// Regression coverage for a reported bug: entering 15%/40%/45% (which sum to exactly 100%) in the
// Capital Structure Setup wizard produced "ownership would total 130%". Root cause: the FRONTEND
// wizard's own "is this 100% yet" calculation only summed the rows being entered and ignored any
// shareholder already created earlier via the separate "Add Shareholder" action (always available,
// independent of the wizard) - so its "100%, ready to finalize" claim could be wrong in a way the
// backend then (correctly) rejected. Fixed in frontend/.../ownership-math.ts +
// capital-structure-setup-modal.tsx (now sums existing active shareholders too, same as the
// backend). These tests prove the BACKEND side of that calculation was always correct - every
// combination below gives the exact total a human would expect, with no double-counting, no
// accumulation across separate submissions, and inactive shareholders excluded.
const ownershipScenarios = [
  { pcts: [15, 40, 45], expectRejected: false, label: '15/40/45 = 100%' },
  { pcts: [20, 30, 50], expectRejected: false, label: '20/30/50 = 100%' },
  { pcts: [25, 25, 25], expectRejected: false, label: '25/25/25 = 75% (partial, allowed)' },
  { pcts: [50, 40, 20], expectRejected: true, expectedTotal: 110, label: '50/40/20 = 110% (rejected)' },
  { pcts: [10, 40, 30, 20], expectRejected: false, label: '10/40/30/20 = 100%' },
];

for (const scenario of ownershipScenarios) {
  test(`ownership scenario table: ${scenario.label}`, async t => {
    if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
    const shareholders = scenario.pcts.map((pct, i) => ({
      name: `S${i}`,
      nameAr: `م${i}`,
      address: 'Cairo',
      nationalId: `2900101123456${i}`,
      ownershipPercentage: pct,
      equityAccount: accounts.capital._id,
    }));
    if (scenario.expectRejected) {
      await assert.rejects(
        () => inTx(session => setupCapitalStructure({ issuedCapital: 1000000, shareholders }, null, session)),
        new RegExp(`would total ${scenario.expectedTotal}%`)
      );
      assert.equal(await Shareholder.countDocuments({}), 0, 'nothing was left behind by the rejected attempt');
    } else {
      const created = await inTx(session => setupCapitalStructure({ issuedCapital: 1000000, shareholders }, null, session));
      assert.equal(created.length, scenario.pcts.length);
      const stored = await Shareholder.find({}).lean();
      const sum = Math.round(stored.reduce((s, sh) => s + sh.ownershipPercentage, 0) * 10000) / 10000;
      assert.equal(sum, scenario.pcts.reduce((s, p) => s + p, 0));
    }
  });
}

test('the exact reported repro: a pre-existing active shareholder (30%) is correctly counted when a new 15/40/45 bulk setup is attempted, giving 130% - not a bug, the backend math was always right', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  await create({ name: 'Pre-existing', nameAr: 'موجود', address: 'Cairo', nationalId: '29001011234599', ownershipPercentage: 30 });
  await assert.rejects(
    () =>
      inTx(session =>
        setupCapitalStructure(
          {
            issuedCapital: 1000000,
            shareholders: [
              { name: 'A', nameAr: 'أ', address: 'C', nationalId: '29001011234561', ownershipPercentage: 15, equityAccount: accounts.capital._id },
              { name: 'B', nameAr: 'ب', address: 'C', nationalId: '29001011234562', ownershipPercentage: 40, equityAccount: accounts.capital._id },
              { name: 'C', nameAr: 'ج', address: 'C', nationalId: '29001011234563', ownershipPercentage: 45, equityAccount: accounts.capital._id },
            ],
          },
          null,
          session
        )
      ),
    /would total 130%/
  );
  assert.equal(await Shareholder.countDocuments({}), 1, 'only the pre-existing shareholder remains - the rejected bulk attempt left nothing behind');
});

test('editing an existing shareholder REPLACES their ownership percentage, never adds to it', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const a = await create({ name: 'Ahmed', ownershipPercentage: 40 });
  await create({ name: 'Mona', ownershipPercentage: 50 });
  // 40 -> 60 with Mona still at 50 would total 110% - correctly rejected, and Ahmed's stored
  // percentage must stay at its old value (40%), not somehow end up added/blended.
  await assert.rejects(() => inTx(session => updateShareholder(a._id, { ownershipPercentage: 60 }, session)), /would total 110%/);
  assert.equal((await Shareholder.findById(a._id).lean()).ownershipPercentage, 40);
  // A change that fits (40 -> 10, total becomes 10+50=60%) is accepted and REPLACES the old value.
  await inTx(session => updateShareholder(a._id, { ownershipPercentage: 10 }, session));
  assert.equal((await Shareholder.findById(a._id).lean()).ownershipPercentage, 10);
  const all = await Shareholder.find({}).lean();
  assert.equal(
    Math.round(all.reduce((s, sh) => s + sh.ownershipPercentage, 0) * 10000) / 10000,
    60,
    'Ahmed counts once, at his NEW percentage - never his old one plus the new one'
  );
});

test('adding and removing shareholders updates the active ownership total correctly, with no stale leftovers', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const a = await create({ name: 'Ahmed', ownershipPercentage: 50 });
  const b = await create({ name: 'Mona', ownershipPercentage: 50 });
  // Deactivating Mona frees her 50% - a new shareholder can now take it without exceeding 100%.
  await inTx(session => updateShareholder(b._id, { status: 'inactive' }, session));
  const c = await create({ name: 'Omar', ownershipPercentage: 50 });
  const activeTotal = (await Shareholder.find({ status: 'active' }).lean()).reduce((s, sh) => s + sh.ownershipPercentage, 0);
  assert.equal(activeTotal, 100, 'Ahmed (50) + Omar (50) = 100% - Mona (inactive) is correctly excluded');
  assert.equal(await Shareholder.countDocuments({}), 3, 'Mona still exists, just inactive - removing/deactivating never deletes history');
});
