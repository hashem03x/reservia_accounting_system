const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');

// HR - a regular employee sees and downloads their OWN attendance, site visits, expense claims and
// the documents on them, and nobody else's. Over the REAL HTTP routes (multipart uploads included)
// on a REAL MongoDB:
//   - GET /hr/state for an employee returns only their own employee record, time, visits, claims;
//   - receipts, attendance documents and visit documents: the owner, their line manager and
//     MD/HR/Finance can list and download them; another employee gets 404 for a hand-made list or
//     download request (the receipt endpoints used to answer ANY HR member for ANY claim);
//   - an employee can add documents only to their own records; HR keeps full management.
// Self-skips without TEST_DB_URI.

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
  require('../../models/system/attachmentModel');
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
/** A portal login linked to its HrEmployee record (HrEmployee.user) - the real user-to-employee mapping. */
async function mkStaffer(name, role, extra = {}) {
  const user = await mkUser(name, role);
  seq++;
  const emp = await M.HrEmployee.create({ code: `EMP-A-${seq}`, name, hire: '2026-01-01', status: 'Active', dept: 'Admin', user: user._id, ...extra });
  return { user, emp };
}
async function api(method, url, { user, body } = {}) {
  const res = await fetch(`${baseUrl}/api/v1/hr${url}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': String(user._id) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await res.arrayBuffer());
  let json;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    json = null;
  }
  return { status: res.status, body: json, buf, type: res.headers.get('content-type') || '' };
}
/** A real multipart upload of a small PDF, through multer and the attachment service. */
async function upload(url, user, name = 'doc.pdf') {
  const form = new FormData();
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(`file ${name}\n`), Buffer.alloc(120, 65)]);
  form.append('files', new Blob([pdf], { type: 'application/pdf' }), name);
  const res = await fetch(`${baseUrl}/api/v1/hr${url}`, { method: 'POST', headers: { 'x-test-user': String(user._id) }, body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const month = () => C.todayCairo().slice(0, 7);
const pastDay = () => `${month()}-01`;

async function setup() {
  const hr = await mkUser('Hala HR', 'hr');
  const finance = await mkUser('Fady Finance', 'finance');
  const mgr = await mkStaffer('Karim Manager', 'line_manager');
  const a = await mkStaffer('Alice Employee', 'employee', { mgrId: mgr.emp._id });
  const b = await mkStaffer('Bob Employee', 'employee');
  return { hr, finance, mgr, a, b };
}

maybeTest('an employee sees only their own records in the HR month view', async () => {
  const t = await setup();
  const visit = await api('POST', '/visits', { user: t.hr, body: { empId: String(t.a.emp._id), date: pastDay(), city: 'Cairo', site: 'Alice site', status: 'Planned' } });
  assert.equal(visit.status, 200, JSON.stringify(visit.body));
  await api('POST', '/visits', { user: t.hr, body: { empId: String(t.b.emp._id), date: pastDay(), city: 'Cairo', site: 'Bob site', status: 'Planned' } });
  assert.equal((await api('POST', '/expenses', { user: t.a.user, body: { empId: String(t.a.emp._id), date: pastDay(), type: 'Meals', amount: 80 } })).status, 200);
  assert.equal((await api('POST', '/expenses', { user: t.b.user, body: { empId: String(t.b.emp._id), date: pastDay(), type: 'Meals', amount: 90 } })).status, 200);
  const s = (await api('GET', `/state?month=${month()}`, { user: t.a.user })).body.data;
  assert.equal(s.role, 'employee');
  assert.equal(s.me, String(t.a.emp._id), 'the login maps to its HrEmployee record via HrEmployee.user');
  assert.deepEqual(s.employees.map(e => e._id), [String(t.a.emp._id)]);
  assert.deepEqual(Object.keys(s.time), [String(t.a.emp._id)], 'own attendance only');
  assert.deepEqual(s.visits.map(v => v.site), ['Alice site']);
  assert.deepEqual(s.expenses.map(x => x.amount), [80]);
  assert.equal(s.canSeePay, false);
  assert.ok(!JSON.stringify(s).includes('Bob'), 'nothing of another employee');
  // An unlinked employee login sees nothing (and the screen says so), never everyone.
  const loose = await mkUser('Unlinked Employee', 'employee');
  const sl = (await api('GET', `/state?month=${month()}`, { user: loose })).body.data;
  assert.equal(sl.me, null);
  assert.equal(sl.employees.length, 0);
});

maybeTest('expense receipts: owner, line manager, HR and Finance can list and download; another employee cannot', async () => {
  const t = await setup();
  const claim = (await api('POST', '/expenses', { user: t.a.user, body: { empId: String(t.a.emp._id), date: pastDay(), type: 'Meals', amount: 80 } })).body.data;
  const up = await upload(`/files/expense/${claim._id}`, t.a.user, 'alice-receipt.pdf');
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const list = await api('GET', `/files/expense/${claim._id}`, { user: t.a.user });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  const fileId = list.body.data[0]._id;
  const dl = await api('GET', `/files/download/${fileId}`, { user: t.a.user });
  assert.equal(dl.status, 200);
  assert.equal(dl.buf.slice(0, 5).toString(), '%PDF-');
  assert.ok(dl.buf.toString().includes('alice-receipt.pdf'));
  for (const who of [t.mgr.user, t.hr, t.finance]) {
    assert.equal((await api('GET', `/files/expense/${claim._id}`, { user: who })).status, 200);
    assert.equal((await api('GET', `/files/download/${fileId}`, { user: who })).status, 200);
  }
  // Bob, by hand-made requests - new and legacy routes alike.
  assert.equal((await api('GET', `/files/expense/${claim._id}`, { user: t.b.user })).status, 404);
  assert.equal((await api('GET', `/files/download/${fileId}`, { user: t.b.user })).status, 404);
  assert.equal((await api('GET', `/expenses/${claim._id}/receipts`, { user: t.b.user })).status, 404);
  assert.equal((await api('GET', `/expenses/receipts/${fileId}/download`, { user: t.b.user })).status, 404);
  assert.equal((await upload(`/files/expense/${claim._id}`, t.b.user)).status, 404, 'cannot add to another employee\'s claim');
  // The claim shows its receipt; HR still decides it.
  assert.equal((await M.HrExpense.findById(claim._id).lean()).receipt, true);
  assert.equal((await api('POST', `/expenses/${claim._id}/decide`, { user: t.hr, body: { status: 'Approved' } })).status, 200);
});

maybeTest('attendance documents: an employee files their own month and downloads it; nobody else\'s', async () => {
  const t = await setup();
  const m = month();
  assert.deepEqual((await api('GET', `/attendance/${t.a.emp._id}/${m}/files`, { user: t.a.user })).body.data, [], 'no month record yet: empty, not an error');
  const up = await upload(`/attendance/${t.a.emp._id}/${m}/files`, t.a.user, 'sick-note.pdf');
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const list = (await api('GET', `/attendance/${t.a.emp._id}/${m}/files`, { user: t.a.user })).body.data;
  assert.equal(list.length, 1);
  assert.equal(list[0].originalName, 'sick-note.pdf');
  assert.equal((await api('GET', `/files/download/${list[0]._id}`, { user: t.a.user })).status, 200);
  assert.equal((await api('GET', `/attendance/${t.a.emp._id}/${m}/files`, { user: t.mgr.user })).body.data.length, 1, 'line manager sees the team member\'s document');
  assert.equal((await api('GET', `/attendance/${t.a.emp._id}/${m}/files`, { user: t.hr })).body.data.length, 1);
  assert.equal((await api('GET', `/attendance/${t.a.emp._id}/${m}/files`, { user: t.b.user })).status, 404);
  assert.equal((await api('GET', `/files/download/${list[0]._id}`, { user: t.b.user })).status, 404);
  assert.equal((await upload(`/attendance/${t.a.emp._id}/${m}/files`, t.b.user)).status, 404, 'Bob cannot file into Alice\'s month');
  // The month record created for the document carries no days: attendance itself is unchanged.
  const att = await M.HrAttendance.findOne({ employee: t.a.emp._id, month: m }).lean();
  assert.deepEqual(att.days, {});
  // HR files a document for anyone.
  assert.equal((await upload(`/attendance/${t.b.emp._id}/${m}/files`, t.hr, 'signed-timesheet.pdf')).status, 201);
});

maybeTest('site-visit documents: the visit\'s own employee and HR; not another employee', async () => {
  const t = await setup();
  const visit = (await api('POST', '/visits', { user: t.hr, body: { empId: String(t.a.emp._id), date: pastDay(), city: 'Alexandria', site: 'Factory roof', status: 'Planned' } })).body.data.visit;
  assert.equal((await upload(`/files/visit/${visit._id}`, t.a.user, 'site-report.pdf')).status, 201);
  const list = (await api('GET', `/files/visit/${visit._id}`, { user: t.a.user })).body.data;
  assert.equal(list.length, 1);
  assert.equal((await api('GET', `/files/download/${list[0]._id}`, { user: t.hr })).status, 200);
  assert.equal((await api('GET', `/files/visit/${visit._id}`, { user: t.b.user })).status, 404);
  assert.equal((await api('GET', `/files/download/${list[0]._id}`, { user: t.b.user })).status, 404);
  assert.equal((await upload(`/files/visit/${visit._id}`, t.b.user)).status, 404);
  assert.equal((await api('GET', '/files/payroll/123', { user: t.hr })).status, 404, 'unknown record type');
});

maybeTest('a line manager sees the team member, but not their personal file data or payment method', async () => {
  const t = await setup();
  await api('PATCH', `/employees/${t.a.emp._id}`, { user: t.hr, body: { sin: 'SIN-123456', paym: 'Bank transfer' } });
  const s = (await api('GET', `/state?month=${month()}`, { user: t.mgr.user })).body.data;
  const alice = s.employees.find(e => e._id === String(t.a.emp._id));
  assert.ok(alice, 'the direct report is visible');
  assert.equal(alice.sin, undefined);
  assert.equal(alice.paym, undefined);
  assert.equal(alice.docs, undefined);
  assert.ok(!s.employees.some(e => e._id === String(t.b.emp._id)), 'not another team\'s employee');
});
