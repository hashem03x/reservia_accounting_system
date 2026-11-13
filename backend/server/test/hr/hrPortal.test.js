const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');

// Reservia HR Portal - HR Portal Developer Spec section 11 test rules, against a REAL MongoDB over the
// REAL HTTP routes:
//   - workflow: a month cannot close from Draft; a closed month is read-only; reopen writes an audit
//     row (MD only); submit needs 0 unrecorded days or an override with a note;
//   - permissions: a line manager cannot read pay fields and sees only the team; Finance cannot edit
//     attendance; no HR membership = no access;
//   - side effects: approved leave writes attendance, a Done visit writes V days, claims need a
//     receipt unless the MD overrides; payslips are stored as versions on every close; the ERP post
//     needs an approved month and a journal reference; pay is encrypted at rest.
// authController.protect is replaced by a header login (x-test-user) that loads the REAL user; every
// check after it is production code. Self-skips without TEST_DB_URI.

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
let server, baseUrl, erpServer, erpUrl;
const erpCalls = [];
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
  // A stand-in ERP: answers 201 with a journal reference.
  erpServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      erpCalls.push({ auth: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reference: `JV-${erpCalls.length}` }));
    });
  });
  await new Promise(r => erpServer.listen(0, '127.0.0.1', r));
  erpUrl = `http://127.0.0.1:${erpServer.address().port}/journal`;
});

after(async () => {
  if (!RUN) return;
  await new Promise(r => server.close(r));
  await new Promise(r => erpServer.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  erpCalls.length = 0;
  const names = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name);
  await Promise.all(names.map(n => mongoose.connection.collection(n).deleteMany({})));
});

function mkUser(name, role) {
  seq++;
  return User.create({ name, email: `${name.toLowerCase().replace(/\s+/g, '.')}.${seq}@reservia.test`, password: 'x', role: 'operator', type: 'online', systemMemberships: role ? [{ system: 'HR', role, isActive: true }] : [] });
}

async function api(method, url, { user, body } = {}) {
  const res = await fetch(`${baseUrl}/api/v1/hr${url}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': String(user._id) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/pdf')) return { status: res.status, pdf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, text };
}

async function team() {
  const md = await mkUser('Mona MD', 'md');
  const hr = await mkUser('Hala HR', 'hr');
  const fin = await mkUser('Fady Finance', 'finance');
  const mgrUser = await mkUser('Karim Manager', 'manager');
  return { md, hr, fin, mgrUser };
}

const today = () => C.todayCairo();
const thisMonth = () => today().slice(0, 7);

maybeTest('no HR membership, or a placeholder role, has no access', async () => {
  const outsider = await mkUser('Out Sider', null);
  assert.equal((await api('GET', `/state?month=${thisMonth()}`, { user: outsider })).status, 403);
  const legacy = await User.create({ name: 'Legacy', email: `legacy.${++seq}@reservia.test`, password: 'x', role: 'operator', type: 'online', systemMemberships: [{ system: 'HR', role: 'MEMBER', isActive: true }] }).catch(() => null);
  if (legacy) assert.equal((await api('GET', `/state?month=${thisMonth()}`, { user: legacy })).status, 403);
});

maybeTest('example team loads; pay is encrypted at rest and the register matches the engine', async () => {
  const { hr, md } = await team();
  const r = await api('POST', '/example', { user: hr });
  assert.equal(r.status, 201, r.text);
  const raw = await mongoose.connection.collection('hremployees').findOne({ code: 'EMP-02' });
  assert.ok(raw.payBox.startsWith('v1:'), 'pay box is AES-GCM');
  assert.equal(raw.basic, undefined, 'no clear pay field');
  assert.ok(!JSON.stringify(raw).includes('28000'), 'the basic salary is not readable in the document');
  const s = (await api('GET', `/state?month=${thisMonth()}`, { user: md })).body.data;
  assert.equal(s.employees.length, 6);
  assert.equal(s.payroll.rows.length, 6);
  const karim = s.employees.find(e => e.code === 'EMP-02');
  assert.equal(karim.basic, 28000);
  const L = await C.loadMonth(thisMonth());
  const net = L.engine.empsIn(thisMonth()).map(e => L.engine.calcPay(e, thisMonth()).net);
  assert.deepEqual(s.payroll.rows.map(x => x.net), net);
});

maybeTest('a line manager sees only the team and never pay; Finance cannot edit attendance', async () => {
  const { hr, fin, mgrUser } = await team();
  await api('POST', '/example', { user: hr });
  const karim = await M.HrEmployee.findOne({ code: 'EMP-02' });
  await api('PATCH', `/employees/${karim._id}`, { user: hr, body: { user: String(mgrUser._id) } });
  const s = (await api('GET', `/state?month=${thisMonth()}`, { user: mgrUser })).body.data;
  assert.deepEqual(s.employees.map(e => e.code).sort(), ['EMP-02', 'EMP-03', 'EMP-04', 'EMP-06']);
  s.employees.forEach(e => ['basic', 'transport', 'incentive', 'commission', 'other', 'insBase'].forEach(k => assert.equal(e[k], undefined, `${e.code} ${k} hidden`)));
  assert.equal(s.payroll.rows.length, 0);
  assert.equal(s.canSeePay, false);
  assert.ok(!JSON.stringify(s).includes('28000'));
  const omar = await M.HrEmployee.findOne({ code: 'EMP-03' });
  assert.equal((await api('GET', `/payroll/${thisMonth()}/payslips/${omar._id}.pdf`, { user: mgrUser })).status, 403);
  const date = `${thisMonth()}-01`;
  const w = await api('POST', '/attendance/day', { user: fin, body: { date, rows: [{ empId: String(omar._id), s: 'P', in: '09:00', out: '18:00' }] } });
  assert.equal(w.status, 403);
  assert.equal((await api('PATCH', `/employees/${omar._id}`, { user: fin, body: { basic: 1 } })).status, 403);
  // The manager decides forms for a direct report, not for someone else's.
  const mona = await M.HrEmployee.findOne({ code: 'EMP-01' });
  const fOther = await api('POST', '/forms', { user: hr, body: { ft: 'ot', empId: String(mona._id), odate: '2099-01-05', kind: 'Weekday overtime', from: '18:00', to: '20:00', hours: 2 } });
  assert.equal((await api('POST', `/forms/${fOther.body.data.form._id}/decide`, { user: mgrUser, body: { status: 'Approved' } })).status, 403);
  const fTeam = await api('POST', '/forms', { user: hr, body: { ft: 'ot', empId: String(omar._id), odate: '2099-01-05', kind: 'Weekday overtime', from: '18:00', to: '20:00', hours: 2 } });
  assert.equal((await api('POST', `/forms/${fTeam.body.data.form._id}/decide`, { user: mgrUser, body: { status: 'Approved' } })).status, 200);
});

/** A clean month in the past with one employee fully recorded (no blank days). */
async function recordedMonth(hr, month = '2026-09') {
  const e = (await api('POST', '/employees', { user: hr, body: { name: 'Test Person', hire: '2026-01-01', dept: 'Admin', status: 'Active', basic: 20000, transport: 1000, email: 'test.person@example.invalid' } })).body.data;
  const fill = await api('POST', `/attendance/${e._id}/${month}/fill`, { user: hr });
  assert.equal(fill.status, 200, fill.text);
  return e;
}

maybeTest('workflow: no close from Draft; submit/approve/close; a closed month is read-only; MD-only reopen is audited; payslips are versioned', async () => {
  const { hr, md, fin } = await team();
  const month = '2026-09';
  const e = await recordedMonth(hr, month);
  assert.equal((await api('POST', `/payroll/${month}/close`, { user: hr })).status, 409, 'cannot close from Draft');
  assert.equal((await api('POST', `/payroll/${month}/submit`, { user: hr })).status, 200);
  assert.equal((await api('PUT', `/attendance/${e._id}/${month}`, { user: hr, body: { days: { [`${month}-02`]: { s: 'A' } } } })).status, 409, 'read-only under review');
  assert.equal((await api('POST', `/payroll/${month}/approve`, { user: hr })).status, 403, 'HR cannot approve');
  assert.equal((await api('POST', `/payroll/${month}/approve`, { user: md })).status, 200);
  const closed = await api('POST', `/payroll/${month}/close`, { user: hr });
  assert.equal(closed.status, 200, closed.text);
  const run = await mongoose.connection.collection('hrpayrollruns').findOne({ month });
  assert.equal(run.status, 'closed');
  assert.ok(run.rowsBox.startsWith('v1:'), 'frozen lines are encrypted');
  assert.equal((await api('PUT', `/attendance/${e._id}/${month}`, { user: hr, body: { days: { [`${month}-02`]: { s: 'A' } } } })).status, 409, 'closed month is read-only');
  assert.equal((await api('POST', '/visits', { user: hr, body: { empId: e._id, date: `${month}-10`, city: 'Cairo', site: 'X', status: 'Done' } })).status, 409);
  const slip = await api('GET', `/payroll/${month}/payslips/${e._id}.pdf`, { user: fin });
  assert.equal(slip.status, 200);
  assert.equal(slip.pdf.slice(0, 4).toString(), '%PDF');
  assert.equal((await api('POST', `/payroll/${month}/reopen`, { user: hr, body: { note: 'correction' } })).status, 403, 'reopen is MD only');
  assert.equal((await api('POST', `/payroll/${month}/reopen`, { user: md, body: {} })).status, 400, 'reopen needs a reason');
  assert.equal((await api('POST', `/payroll/${month}/reopen`, { user: md, body: { note: 'Late overtime claim' } })).status, 200);
  const auditRow = await M.HrAudit.findOne({ table: 'payroll_runs', rowId: month, action: 'reopen' }).lean();
  assert.ok(auditRow && auditRow.note === 'Late overtime claim');
  await api('POST', `/payroll/${month}/submit`, { user: hr });
  await api('POST', `/payroll/${month}/approve`, { user: md });
  await api('POST', `/payroll/${month}/close`, { user: hr });
  const files = await M.HrPayslipFile.find({ month, employee: e._id }).sort({ version: 1 }).lean();
  assert.deepEqual(files.map(f => f.version), [1, 2], 'closed PDFs kept as versions');
  const log = (await M.HrPayrollRun.findOne({ month }).lean()).log.map(l => l.s);
  assert.deepEqual(log, ['review', 'approved', 'closed', 'reopen', 'review', 'approved', 'closed']);
});

maybeTest('submit needs 0 unrecorded working days or an override with a note', async () => {
  const { hr } = await team();
  const month = '2026-08';
  await api('POST', '/employees', { user: hr, body: { name: 'Blank Days', hire: '2026-01-01', basic: 9000 } });
  const r1 = await api('POST', `/payroll/${month}/submit`, { user: hr });
  assert.equal(r1.status, 409);
  assert.match(r1.body.message, /not recorded/);
  assert.equal((await api('POST', `/payroll/${month}/submit`, { user: hr, body: { override: true, note: 'Paper timesheets, entered later' } })).status, 200);
});

maybeTest('approved leave posts to attendance; rejecting removes it; claims need a receipt unless the MD overrides', async () => {
  const { hr, md } = await team();
  const e = (await api('POST', '/employees', { user: hr, body: { name: 'Leave Taker', hire: '2026-01-01', basic: 9000 } })).body.data;
  const f = await api('POST', '/forms', { user: hr, body: { ft: 'leave', empId: e._id, ltype: 'Annual leave', from: '2099-03-01', to: '2099-03-05' } });
  assert.equal(f.status, 200, f.text);
  assert.equal(f.body.data.form.days, 5);
  const d = await api('POST', `/forms/${f.body.data.form._id}/decide`, { user: hr, body: { status: 'Approved' } });
  assert.equal(d.body.data.effects.attendanceDays, 5);
  let att = await M.HrAttendance.findOne({ employee: e._id, month: '2099-03' }).lean();
  assert.equal(Object.values(att.days).filter(x => x.s === 'L' && x.n.startsWith('HR-F01:')).length, 5);
  await api('POST', `/forms/${f.body.data.form._id}/decide`, { user: hr, body: { status: 'Rejected' } });
  att = await M.HrAttendance.findOne({ employee: e._id, month: '2099-03' }).lean();
  assert.equal(Object.keys(att.days).length, 0);
  // Overtime dated in the past needs a reason (an exception).
  assert.equal((await api('POST', '/forms', { user: hr, body: { ft: 'ot', empId: e._id, odate: '2026-01-05', hours: 2 } })).status, 400);
  assert.equal((await api('POST', '/forms', { user: hr, body: { ft: 'ot', empId: e._id, odate: '2026-01-05', hours: 2, reason: 'Urgent commissioning' } })).body.data.form.exception, true);
  const x = (await api('POST', '/expenses', { user: hr, body: { empId: e._id, date: '2099-04-02', type: 'Meals', amount: 120, receipt: false } })).body.data;
  assert.equal((await api('POST', `/expenses/${x._id}/decide`, { user: hr, body: { status: 'Approved' } })).status, 409);
  assert.equal((await api('POST', `/expenses/${x._id}/decide`, { user: hr, body: { status: 'Approved', receiptOverride: true } })).status, 403);
  const ok = await api('POST', `/expenses/${x._id}/decide`, { user: md, body: { status: 'Approved', receiptOverride: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.receiptOverride, true);
});

maybeTest('a Done site visit records V days and pays its allowance', async () => {
  const { hr, md } = await team();
  const e = (await api('POST', '/employees', { user: hr, body: { name: 'Site Engineer', hire: '2026-01-01', basic: 15000, transport: 0 } })).body.data;
  const v = await api('POST', '/visits', { user: hr, body: { empId: e._id, date: '2099-05-04', city: 'Alexandria', site: 'Factory roof', status: 'Done', days: 2, nights: 1, transport: 300 } });
  assert.equal(v.status, 200, v.text);
  assert.equal(v.body.data.attendanceDays, 2);
  const s = (await api('GET', '/state?month=2099-05', { user: md })).body.data;
  const row = s.payroll.rows.find(r => r.code === s.employees[0].code);
  // 2 days outside Greater Cairo: daily wage x (2.0 - 1) each + 250 per diem each; 300 reimbursed.
  assert.equal(Math.round(row.site), Math.round((15000 / 30) * 1 * 2 + 500));
  assert.equal(row.reimb, 300);
});

maybeTest('ERP post: approved month only, bearer token, reference stored, one post per closed version', async () => {
  const { hr, md, fin } = await team();
  process.env.HR_ERP_API_TOKEN = 'test-erp-token';
  const month = '2026-07';
  await recordedMonth(hr, month);
  // The stand-in ERP runs on http: settings validation requires https, so it is stored directly.
  process.env.HR_ERP_ALLOW_INSECURE = '1';
  await M.HrSettings.create({ effectiveMonth: '2026-01', values: { erpUrl } });
  assert.equal((await api('POST', `/payroll/${month}/erp`, { user: fin })).status, 409, 'draft cannot post');
  await api('POST', `/payroll/${month}/submit`, { user: hr });
  await api('POST', `/payroll/${month}/approve`, { user: md });
  await api('POST', `/payroll/${month}/close`, { user: hr });
  const post = await api('POST', `/payroll/${month}/erp`, { user: fin });
  assert.equal(post.status, 200, post.text);
  assert.equal(post.body.data.ok, true);
  assert.equal(post.body.data.reference, 'JV-1');
  assert.equal(erpCalls[0].auth, 'Bearer test-erp-token');
  const dr = erpCalls[0].body.lines.reduce((a, l) => a + l.debit, 0);
  const cr = erpCalls[0].body.lines.reduce((a, l) => a + l.credit, 0);
  assert.ok(Math.abs(dr - cr) < 0.05, 'balanced journal');
  assert.equal(erpCalls[0].body.status, 'closed');
  assert.equal((await api('POST', `/payroll/${month}/erp`, { user: fin })).status, 409, 'one post per run');
  delete process.env.HR_ERP_API_TOKEN;
  delete process.env.HR_ERP_ALLOW_INSECURE;
});

maybeTest('outputs: register PDF and CSV, journal CSV, form PDFs, exports limited to MD and HR, audit log hides pay', async () => {
  const { hr, md, fin } = await team();
  await api('POST', '/example', { user: hr });
  const m = thisMonth();
  const reg = await api('GET', `/payroll/${m}/register.pdf`, { user: fin });
  assert.equal(reg.pdf.slice(0, 4).toString(), '%PDF');
  const csv = await api('GET', `/payroll/${m}/register.csv`, { user: hr });
  assert.equal(csv.status, 200);
  assert.equal(csv.text.split('\n').length, 7);
  assert.equal((await api('GET', `/payroll/${m}/register.csv`, { user: fin })).status, 403, 'exports: MD or HR only');
  assert.equal((await api('GET', `/payroll/${m}/journal.csv`, { user: fin })).status, 200);
  for (const kind of ['personnel', 'org', 'training', 'leave']) assert.equal((await api('GET', `/exports/${kind}.csv?month=${m}`, { user: md })).status, 200, kind);
  const karim = await M.HrEmployee.findOne({ code: 'EMP-02' });
  for (const ft of ['hire', 'exit', 'belongings']) {
    const p = await api('GET', `/sheets/${ft}?empId=${karim._id}`, { user: hr });
    assert.equal(p.status, 200, ft);
    assert.equal(p.pdf.slice(0, 4).toString(), '%PDF');
  }
  assert.equal((await api('GET', '/sheets/leave?blank=1', { user: hr })).pdf.slice(0, 4).toString(), '%PDF');
  await api('PATCH', `/employees/${karim._id}`, { user: hr, body: { basic: 29000 } });
  const audit = (await api('GET', `/audit?table=employees&rowId=${karim._id}`, { user: md })).body.data;
  assert.ok(audit.length >= 1);
  assert.ok(!JSON.stringify(audit).includes('29000'), 'audit log never shows pay figures');
  const stored = await M.HrAudit.findOne({ table: 'employees', rowId: String(karim._id), action: 'update' }).lean();
  assert.ok(String(stored.after.pay).startsWith('v1:'), 'pay in the audit entry is sealed');
  const k2 = await M.HrEmployee.findById(karim._id).lean();
  assert.equal(k2.contractHistory.length, 1, 'previous contract terms kept');
});

maybeTest('settings are versioned by effective month; Finance may change only the ERP link', async () => {
  const { hr, fin } = await team();
  assert.equal((await api('POST', '/settings', { user: hr, body: { effectiveMonth: '2026-12', values: { insMax: 17000 } } })).status, 200);
  assert.equal((await C.settingsFor('2026-11')).values.insMax, undefined);
  assert.equal((await C.settingsFor('2026-12')).values.insMax, 17000);
  assert.equal((await api('POST', '/settings', { user: fin, body: { effectiveMonth: '2026-12', values: { insMax: 1 } } })).status, 403);
  assert.equal((await api('POST', '/settings', { user: fin, body: { effectiveMonth: '2026-12', values: { erpCo: 'RIES2' } } })).status, 200);
  assert.equal((await api('POST', '/settings', { user: hr, body: { effectiveMonth: '2026-12', values: { erpUrl: 'http://insecure' } } })).status, 400);
});
