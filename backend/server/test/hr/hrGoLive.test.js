const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');

// Go-live Developer Pack section 5.7/D6/D7/F10 - verifies, against a REAL MongoDB over the REAL
// HTTP routes (same harness convention as hrPortal.test.js):
//   - every employee has self-service (own attendance/visits/claims/forms), never another
//     employee's, even by sending a different employee id in the request body;
//   - line_manager behaves exactly like the legacy manager role (approves direct reports only);
//   - "Decided by" is always the authenticated approver, never a value the client sent;
//   - an expense claim needs a REAL uploaded receipt file to be approved (not a tickable boolean);
//   - payroll requires a mandatory reason when the same person both submitted and approved it.
// Self-skips without TEST_DB_URI, like every other DB-backed suite in this repo.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;
process.env.HR_PAY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const ApiError = require('../../utils/apiError');
const authPath = require.resolve('../../controller/user/authController');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    protect: async (req, res, next) => {
      const id = req.header('x-test-user');
      if (!id) return next(new ApiError('You are not logged in.', 401));
      req.user = await mongoose.model('User').findById(id);
      return req.user ? next() : next(new ApiError('Unknown user.', 401));
    },
  },
};

let User, M, C;
let server, baseUrl;
let seq = 0;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  M = require('../../models/hr/hrModels');
  C = require('../../services/hr/hrCore');
  await Promise.all([User.init(), ...Object.values(M).map(m => m.init())]);
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/hr', require('../../routes/hr/hrRoute'));
  app.use(require('../../middleware/errorMiddleware'));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!RUN) return;
  await new Promise(r => server.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  const names = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name);
  await Promise.all(names.map(n => mongoose.connection.collection(n).deleteMany({})));
});

function mkUser(name, role) {
  seq++;
  return User.create({ name, email: `${name.toLowerCase().replace(/\s+/g, '.')}.${seq}@reservia.test`, password: 'x', role: 'operator', type: 'online', systemMemberships: role ? [{ system: 'HR', role, isActive: true }] : [] });
}

async function api(method, url, { user, body } = {}) {
  const res = await fetch(`${baseUrl}/api/v1/hr${url}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': String(user._id) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, text };
}

const today = () => C.todayCairo();
const thisMonth = () => today().slice(0, 7);

/** Attaches a real PDF receipt to a claim via the actual upload service, as its own employee. */
async function attachRealReceipt(claimId, user, role) {
  const svc = require('../../services/hr/hrService');
  const pdfBuffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 65)]);
  return svc.uploadExpenseReceipt(claimId, [{ originalname: 'receipt.pdf', mimetype: 'application/pdf', buffer: pdfBuffer }], { user, role });
}

/** An HR login + a linked HrEmployee record, so myEmployee(ctx) resolves - the exact go-live shape. */
async function mkStaffer(name, hrRole) {
  const user = await mkUser(name, hrRole);
  seq++;
  const emp = await M.HrEmployee.create({ code: `EMP-GL-${seq}`, name, hire: '2026-01-01', status: 'Active', dept: 'Admin', user: user._id });
  return { user, emp };
}

maybeTest('employee self-service: a staffer can submit their OWN expense claim, but never another employee\'s - even by naming a different empId', async () => {
  const hr = await mkUser('Hala HR', 'hr');
  const alice = await mkStaffer('Alice Employee', 'employee');
  const bob = await mkStaffer('Bob Employee', 'employee');

  const ownClaim = await api('POST', '/expenses', { user: alice.user, body: { empId: String(alice.emp._id), date: `${thisMonth()}-02`, type: 'Meals', amount: 50 } });
  assert.equal(ownClaim.status, 200, ownClaim.text);

  const forSomeoneElse = await api('POST', '/expenses', { user: alice.user, body: { empId: String(bob.emp._id), date: `${thisMonth()}-02`, type: 'Meals', amount: 50 } });
  assert.equal(forSomeoneElse.status, 403);

  // md/hr can still act for anyone, unchanged.
  const hrOnBehalf = await api('POST', '/expenses', { user: hr, body: { empId: String(bob.emp._id), date: `${thisMonth()}-02`, type: 'Meals', amount: 50 } });
  assert.equal(hrOnBehalf.status, 200, hrOnBehalf.text);
});

maybeTest('employee self-service: editing an existing claim can never reassign it to a different employee', async () => {
  const alice = await mkStaffer('Alice Employee', 'employee');
  const bob = await mkStaffer('Bob Employee', 'employee');
  const created = await api('POST', '/expenses', { user: alice.user, body: { empId: String(alice.emp._id), date: `${thisMonth()}-02`, type: 'Meals', amount: 50 } });
  const claimId = created.body.data._id;

  // Bob cannot touch Alice's claim at all (the id belongs to Alice, not him).
  assert.equal((await api('PATCH', `/expenses/${claimId}`, { user: bob.user, body: { amount: 999, empId: String(bob.emp._id) } })).status, 403);

  // Alice editing her own claim, even if she tries to smuggle a different empId, stays hers.
  const edited = await api('PATCH', `/expenses/${claimId}`, { user: alice.user, body: { amount: 75, date: `${thisMonth()}-02`, empId: String(bob.emp._id) } });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.body.data.employee, String(alice.emp._id), 'the claim must stay assigned to Alice, never reassigned to Bob');
});

maybeTest('employee self-service: visits and forms follow the same own-record-only rule', async () => {
  const alice = await mkStaffer('Alice Employee', 'employee');
  const bob = await mkStaffer('Bob Employee', 'employee');

  const ownVisit = await api('POST', '/visits', { user: alice.user, body: { empId: String(alice.emp._id), date: `${thisMonth()}-03`, site: 'Client HQ', purpose: 'Install' } });
  assert.equal(ownVisit.status, 200, ownVisit.text);
  const forBob = await api('POST', '/visits', { user: alice.user, body: { empId: String(bob.emp._id), date: `${thisMonth()}-03`, site: 'Client HQ', purpose: 'Install' } });
  assert.equal(forBob.status, 403);

  const ownForm = await api('POST', '/forms', { user: alice.user, body: { ft: 'ot', empId: String(alice.emp._id), odate: today(), kind: 'Weekday', hours: 2, site: 'HQ' } });
  assert.equal(ownForm.status, 200, ownForm.text);
  const formForBob = await api('POST', '/forms', { user: alice.user, body: { ft: 'ot', empId: String(bob.emp._id), odate: today(), kind: 'Weekday', hours: 2, site: 'HQ' } });
  assert.equal(formForBob.status, 403);
});

maybeTest('F25: a self-service attendance submission can never record a future date', async () => {
  const alice = await mkStaffer('Alice Employee', 'employee');
  const future = `${Number(today().slice(0, 4)) + 1}-01-15`; // clearly in the future, whenever this test runs
  const r = await api('PUT', `/attendance/${alice.emp._id}/${future.slice(0, 7)}`, { user: alice.user, body: { days: { [future]: { s: 'P', in: '09:00', out: '18:00' } } } });
  assert.equal(r.status, 400);
  assert.match(r.body.message || r.text, /future/);

  // md/hr are unaffected by this restriction (e.g. recording a backdated correction differently).
  const hr = await mkUser('Hala HR', 'hr');
  const past = today();
  const asHr = await api('PUT', `/attendance/${alice.emp._id}/${past.slice(0, 7)}`, { user: hr, body: { days: { [past]: { s: 'P', in: '09:00', out: '18:00' } } } });
  assert.equal(asHr.status, 200, asHr.text);
});

maybeTest('go-live: line_manager behaves exactly like the legacy manager role - approves only direct reports', async () => {
  const lm = await mkStaffer('Laila LineManager', 'line_manager');
  const report = await mkStaffer('Reem Report', 'employee');
  await M.HrEmployee.updateOne({ _id: report.emp._id }, { $set: { mgrId: lm.emp._id } });
  const other = await mkStaffer('Omar Outsider', 'employee');

  const claim = await api('POST', '/expenses', { user: report.user, body: { empId: String(report.emp._id), date: `${thisMonth()}-02`, type: 'Meals', amount: 50 } });
  const claimId = claim.body.data._id;
  await attachRealReceipt(claimId, report.user, 'employee');

  // Approve as the line manager for their direct report - allowed.
  assert.equal((await api('POST', `/expenses/${claimId}/decide`, { user: lm.user, body: { status: 'Approved' } })).status, 200);

  const otherClaim = await api('POST', '/expenses', { user: other.user, body: { empId: String(other.emp._id), date: `${thisMonth()}-02`, type: 'Meals', amount: 50 } });
  const otherClaimId = otherClaim.body.data._id;
  await attachRealReceipt(otherClaimId, other.user, 'employee');
  // Not their direct report - refused.
  assert.equal((await api('POST', `/expenses/${otherClaimId}/decide`, { user: lm.user, body: { status: 'Approved' } })).status, 403);
});

maybeTest('F10: "Decided by" is always the authenticated approver, never a value the client sent', async () => {
  const hr = await mkUser('Hala HR', 'hr');
  const alice = await mkStaffer('Alice Employee', 'employee');
  const claim = await api('POST', '/expenses', { user: alice.user, body: { empId: String(alice.emp._id), date: `${thisMonth()}-02`, type: 'Meals', amount: 50 } });
  const claimId = claim.body.data._id;
  await attachRealReceipt(claimId, alice.user, 'employee');

  const decided = await api('POST', `/expenses/${claimId}/decide`, { user: hr, body: { status: 'Approved', by: 'Someone Else Entirely' } });
  assert.equal(decided.status, 200, decided.text);
  const stored = await M.HrExpense.findById(claimId).lean();
  assert.equal(stored.by, 'Hala HR', 'the spoofed "by" value must never be stored');
  assert.equal(String(stored.decidedBy), String(hr._id));
});

maybeTest('F10: an expense claim needs a REAL uploaded receipt to be approved - the old tickbox is ignored entirely', async () => {
  const hr = await mkUser('Hala HR', 'hr');
  const alice = await mkStaffer('Alice Employee', 'employee');
  // Even sending receipt:true on creation must not satisfy the requirement - it is no longer trusted.
  const claim = await api('POST', '/expenses', { user: alice.user, body: { empId: String(alice.emp._id), date: `${thisMonth()}-02`, type: 'Meals', amount: 50, receipt: true } });
  const claimId = claim.body.data._id;
  const stored = await M.HrExpense.findById(claimId).lean();
  assert.equal(stored.receipt, false, 'the receipt tickbox in the request body must be ignored');

  const refused = await api('POST', `/expenses/${claimId}/decide`, { user: hr, body: { status: 'Approved' } });
  assert.equal(refused.status, 409);

  // The real upload path (services/hr/hrService.js#uploadExpenseReceipt): self-service aware
  // (Alice, the claim's own employee, may attach her own receipt) and flips `receipt` true ONLY
  // once a file is actually stored.
  const svc = require('../../services/hr/hrService');
  const pdfBuffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 65)]);
  const uploadResult = await svc.uploadExpenseReceipt(claimId, [{ originalname: 'receipt.pdf', mimetype: 'application/pdf', buffer: pdfBuffer }], { user: alice.user, role: 'employee' });
  assert.equal(uploadResult.expense.receipt, true);
  assert.equal(uploadResult.attachments.length, 1);

  const approved = await api('POST', `/expenses/${claimId}/decide`, { user: hr, body: { status: 'Approved' } });
  assert.equal(approved.status, 200, approved.text);
});

maybeTest('F10: a different employee can never attach a receipt to someone else\'s claim', async () => {
  const alice = await mkStaffer('Alice Employee', 'employee');
  const bob = await mkStaffer('Bob Employee', 'employee');
  const claim = await api('POST', '/expenses', { user: alice.user, body: { empId: String(alice.emp._id), date: `${thisMonth()}-02`, type: 'Meals', amount: 50 } });
  const svc = require('../../services/hr/hrService');
  const pdfBuffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 65)]);
  await assert.rejects(
    svc.uploadExpenseReceipt(claim.body.data._id, [{ originalname: 'receipt.pdf', mimetype: 'application/pdf', buffer: pdfBuffer }], { user: bob.user, role: 'employee' }),
    /own record/
  );
});

maybeTest('F9/F10/D7: payroll approved by the SAME person who submitted it requires a mandatory reason, and is flagged on the run', async () => {
  const md = await mkUser('Mona MD', 'md');
  await api('POST', '/example', { user: md });
  const month = thisMonth();
  const submitted = await api('POST', `/payroll/${month}/submit`, { user: md, body: { override: true, note: 'go-live test submit' } });
  assert.equal(submitted.status, 200, submitted.text);

  const refused = await api('POST', `/payroll/${month}/approve`, { user: md, body: {} });
  assert.equal(refused.status, 400);
  assert.match(refused.body.message || refused.text, /submitted this payroll/);

  const approved = await api('POST', `/payroll/${month}/approve`, { user: md, body: { note: 'No finance officer hired yet - MD prepared and approves alone' } });
  assert.equal(approved.status, 200, approved.text);
  assert.equal(approved.body.data.selfApproved, true);
});

maybeTest('payroll approved by a DIFFERENT person than who submitted it needs no special reason and is not flagged', async () => {
  const md = await mkUser('Mona MD', 'md');
  const hr = await mkUser('Hala HR', 'hr');
  await api('POST', '/example', { user: hr });
  const month = thisMonth();
  await api('POST', `/payroll/${month}/submit`, { user: hr, body: { override: true, note: 'submitted by HR' } });

  const approved = await api('POST', `/payroll/${month}/approve`, { user: md, body: {} });
  assert.equal(approved.status, 200, approved.text);
  assert.equal(approved.body.data.selfApproved, false);
});
