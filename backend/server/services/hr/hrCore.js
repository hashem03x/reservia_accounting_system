'use strict';

// Reservia HR Portal - shared core: settings (versioned), audit log, role scope, record shaping and
// the bridge from the database to the pure payroll engine (services/hr/payrollEngine.js).

const ApiError = require('../../utils/apiError');
const M = require('../../models/hr/hrModels');
const P = require('./payrollEngine');
const crypto = require('./hrCrypto');

const PAY_ROLES = ['md', 'hr', 'finance']; // spec section 2: pay fields go only to MD, HR and Finance
const EDIT_ROLES = ['md', 'hr']; // people, contracts, documents, time, visits, claims
const PAY_FIELDS = ['basic', 'transport', 'incentive', 'commission', 'other', 'insBase'];

const canSeePay = role => PAY_ROLES.includes(role);
const userName = user => (user && (user.name || user.email)) || 'Unknown user';

function assertRole(ctx, roles, what) {
  if (!roles.includes(ctx.role)) throw new ApiError(`Your HR role (${ctx.role}) cannot ${what}.`, 403);
}

/** Today's date in Cairo (YYYY-MM-DD) - the company's working day, whatever the server's zone. */
function todayCairo(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function assertMonth(m, label = 'Month') {
  if (!MONTH_RE.test(String(m || ''))) throw new ApiError(`${label} must be YYYY-MM.`, 400);
  return m;
}
function assertDate(d, label = 'Date', optional = false) {
  if (optional && !d) return '';
  if (!DATE_RE.test(String(d || ''))) throw new ApiError(`${label} must be a date (YYYY-MM-DD).`, 400);
  return d;
}
function num(v, label, { min = 0, max = 1e9, optional = true } = {}) {
  if (v === '' || v === null || v === undefined) {
    if (optional) return undefined;
    throw new ApiError(`${label} is required.`, 400);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(`${label} must be a number between ${min} and ${max}.`, 400);
  return n;
}
const str = (v, max = 500) => (v === undefined || v === null ? undefined : String(v).trim().slice(0, max));

/* ---------- audit ---------- */
function redactPay(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const o = JSON.parse(JSON.stringify(obj));
  // Pay stays boxed in the audit trail too; the box itself is kept so a change can be proven.
  if (o.pay) o.pay = crypto.seal(o.pay);
  return o;
}
async function audit(ctx, table, rowId, action, before, after, note) {
  await M.HrAudit.create({ table, rowId: String(rowId || ''), action, before: redactPay(before), after: redactPay(after), user: ctx.user?._id, userName: userName(ctx.user), note });
}

/* ---------- settings (spec section 5, versioned) ---------- */
async function settingsFor(month) {
  const doc = await M.HrSettings.findOne({ effectiveMonth: { $lte: month } }).sort({ effectiveMonth: -1, createdAt: -1 }).lean();
  return { values: doc ? doc.values : {}, version: doc ? { id: doc._id, effectiveMonth: doc.effectiveMonth, at: doc.createdAt, byName: doc.byName } : null };
}

const SETTING_KEYS = Object.keys(P.DEFAULTS);
const ERP_KEYS = ['erpName', 'erpUrl', 'erpCo', 'erpAuto', 'gl'];

function validateSettings(patch) {
  const out = {};
  Object.keys(patch || {}).forEach(k => {
    if (!SETTING_KEYS.includes(k)) throw new ApiError(`Unknown setting: ${k}.`, 400);
    const def = P.DEFAULTS[k];
    const v = patch[k];
    if (typeof def === 'number') out[k] = num(v, k, { min: 0, max: 1e7, optional: false });
    else if (typeof def === 'boolean') out[k] = !!v;
    else if (typeof def === 'string') {
      out[k] = String(v ?? '').slice(0, 4000);
      if (k === 'shiftStart' && !TIME_RE.test(out[k])) throw new ApiError('Shift start must be HH:MM.', 400);
      if (k === 'otBase' && !['gross', 'basic'].includes(out[k])) throw new ApiError('Overtime base must be gross or basic.', 400);
      if (k === 'insBaseMode' && !['all', 'basicother', 'basic'].includes(out[k])) throw new ApiError('Insurable wage base is all, basicother or basic.', 400);
      if (k === 'erpUrl' && out[k] && !/^https:\/\//.test(out[k])) throw new ApiError('The ERP endpoint must start with https://', 400);
    } else if (k === 'workWeek') {
      if (!Array.isArray(v) || v.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new ApiError('Working days are weekday numbers 0 (Sun) to 6 (Sat).', 400);
      out[k] = [...new Set(v)].sort();
    } else if (k === 'brackets') {
      if (!Array.isArray(v) || !v.length) throw new ApiError('Tax brackets are required.', 400);
      out[k] = v.map((b, i) => {
        const last = i === v.length - 1;
        const up = last ? null : num(b[0], 'Bracket limit', { optional: false });
        return [up, num(b[1], 'Bracket rate', { min: 0, max: 100, optional: false })];
      });
      for (let i = 1; i < out[k].length - 1; i++) if (out[k][i][0] <= out[k][i - 1][0]) throw new ApiError('Bracket limits must increase.', 400);
    } else if (k === 'cities') {
      if (!Array.isArray(v)) throw new ApiError('Cities must be a list.', 400);
      out[k] = v.map(c => ({ n: String(c.n || '').trim().slice(0, 80), z: String(c.z || '').trim().slice(0, 80) })).filter(c => c.n);
    } else if (k === 'req') {
      if (!Array.isArray(v)) throw new ApiError('Required training must be a list.', 400);
      out[k] = v.map(r => ({ n: String(r.n || '').trim().slice(0, 120), m: num(r.m, 'Validity (months)', { min: 0, max: 240, optional: false }), d: r.d === 'all' || P.DEPTS.includes(r.d) ? r.d : 'all' })).filter(r => r.n);
    } else if (k === 'gl') {
      const g = Object.assign({}, P.DEFAULTS.gl);
      Object.keys(v || {}).forEach(x => {
        if (!(x in g)) throw new ApiError(`Unknown GL mapping: ${x}.`, 400);
        g[x] = String(v[x] || '').slice(0, 120);
      });
      out[k] = g;
    }
  });
  return out;
}

async function saveSettings(patch, effectiveMonth, ctx, note) {
  const keys = Object.keys(patch || {});
  if (!keys.length) throw new ApiError('Nothing to change.', 400);
  // Finance maintains the ERP link and account mapping (spec section 9); MD and HR the rest.
  if (ctx.role === 'finance') {
    if (keys.some(k => !ERP_KEYS.includes(k))) throw new ApiError('Finance can change the ERP link and account mapping only.', 403);
  } else assertRole(ctx, EDIT_ROLES, 'change HR settings');
  assertMonth(effectiveMonth, 'Effective month');
  const clean = validateSettings(patch);
  const cur = await settingsFor(effectiveMonth);
  const values = Object.assign({}, cur.values, clean);
  const doc = await M.HrSettings.create({ effectiveMonth, values, note: str(note), by: ctx.user?._id, byName: userName(ctx.user) });
  await audit(ctx, 'settings', doc._id, 'update', { effectiveMonth, values: cur.values }, { effectiveMonth, values }, note);
  return doc;
}

/* ---------- scope ---------- */
async function myEmployee(ctx) {
  if (!ctx.user?._id) return null;
  return M.HrEmployee.findOne({ user: ctx.user._id }).lean();
}

/** Employee ids the caller may see: everyone for MD/HR/Finance; the direct reports (and self) for a line manager. */
async function visibleEmployeeIds(ctx) {
  if (ctx.role !== 'manager') return null; // null = no restriction
  const me = await myEmployee(ctx);
  if (!me) return [];
  const team = await M.HrEmployee.find({ mgrId: me._id }, { _id: 1 }).lean();
  return [String(me._id), ...team.map(t => String(t._id))];
}

/** A line manager may decide only for a direct report; MD and HR for anyone. */
async function assertCanDecideFor(ctx, employeeId) {
  if (EDIT_ROLES.includes(ctx.role)) return;
  if (ctx.role !== 'manager') throw new ApiError('Your HR role cannot approve this.', 403);
  const me = await myEmployee(ctx);
  const emp = await M.HrEmployee.findById(employeeId, { mgrId: 1 }).lean();
  if (!me || !emp || String(emp.mgrId || '') !== String(me._id)) throw new ApiError('A line manager can approve only for their direct reports.', 403);
}

/* ---------- shaping ---------- */
function payOf(emp) {
  return crypto.open(emp.payBox, {}) || {};
}
const docsObj = docs => (docs instanceof Map ? Object.fromEntries(docs) : docs || {});

/** The engine's view of an employee (prototype field names, pay opened). */
function engineEmployee(e) {
  const pay = payOf(e);
  const o = {
    id: String(e._id), code: e.code, name: e.name, role: e.role, dept: e.dept, status: e.status, type: e.type, hire: e.hire, end: e.end || '',
    city: e.city, mgr: e.mgr, insured: e.insured !== false, docs: docsObj(e.docs), probEnd: e.probEnd, cend: e.cend, email: e.email,
  };
  PAY_FIELDS.forEach(k => {
    o[k] = +pay[k] || 0;
  });
  return o;
}

/** An employee as returned by the API: pay only for pay roles. */
function shapeEmployee(e, role) {
  const o = {
    _id: String(e._id), code: e.code, name: e.name, role: e.role, dept: e.dept, status: e.status, type: e.type, hire: e.hire, end: e.end || '',
    city: e.city, mgr: e.mgr, mgrId: e.mgrId ? String(e.mgrId) : null, user: e.user ? String(e.user) : null, phone: e.phone, email: e.email,
    emg: e.emg, emgp: e.emgp, file: e.file, nat: e.nat, sin: e.sin, edu: e.edu, cno: e.cno, offerDate: e.offerDate, cstart: e.cstart,
    cend: e.cend, probEnd: e.probEnd, paym: e.paym, insured: e.insured !== false, docs: docsObj(e.docs),
    exit: e.exit ? { last: e.exit.last, reason: e.exit.reason, steps: docsObj(e.exit.steps) } : null, example: !!e.example,
  };
  if (role === 'manager') {
    delete o.docs;
    delete o.sin;
    delete o.paym;
  }
  if (canSeePay(role)) {
    const pay = payOf(e);
    PAY_FIELDS.forEach(k => {
      o[k] = +pay[k] || 0;
    });
  }
  return o;
}

/* ---------- engine bridge ---------- */
const monthRange = m => ({ first: `${m}-01`, last: `${m}-${P.pad(P.daysIn(m))}` });

/**
 * Loads everything the engine needs for `month` (plus the year, for leave balances) and returns
 * { engine, cfgVersion, raw } where raw holds the lean documents for shaping.
 */
async function loadMonth(month, { today = todayCairo(), employeeFilter = null } = {}) {
  const year = month.slice(0, 4);
  const [cfg, employees, attendance, targets, visits, expenses, adjustments, forms, trainings] = await Promise.all([
    settingsFor(month),
    M.HrEmployee.find(employeeFilter ? { _id: { $in: employeeFilter } } : {}).lean(),
    M.HrAttendance.find({ month: { $gte: `${year}-01`, $lte: `${year}-12` } }).lean(),
    M.HrTarget.find({ month }).lean(),
    M.HrVisit.find({}).lean(),
    M.HrExpense.find({}).lean(),
    M.HrAdjustment.find({ month }).lean(),
    M.HrForm.find({}).lean(),
    M.HrTraining.find({}).lean(),
  ]);
  const att = {};
  attendance.forEach(a => {
    att[`${a.employee}_${a.month}`] = { days: a.days || {}, appr: a.approval?.at ? a.approval : null };
  });
  const tg = {};
  targets.forEach(t => {
    tg[`${t.employee}_${t.month}`] = t.pct;
  });
  const withEmp = r => Object.assign({}, r, { id: String(r._id), empId: String(r.employee) });
  const engine = P.createEngine({
    cfg: cfg.values,
    today,
    employees: employees.map(engineEmployee),
    attendance: att,
    targets: tg,
    visits: visits.map(withEmp),
    expenses: expenses.map(withEmp),
    adjustments: adjustments.map(withEmp),
    forms: forms.map(withEmp),
    trainings: trainings.map(withEmp),
  });
  return { engine, cfgVersion: cfg.version, raw: { employees, attendance, targets, visits, expenses, adjustments, forms, trainings }, today };
}

/* ---------- month locks (spec section 7) ---------- */
async function runOf(month) {
  return M.HrPayrollRun.findOne({ month }).lean();
}
/** Inputs of a month can change only while its payroll is a Draft. */
async function assertMonthOpen(month) {
  const run = await runOf(month);
  const st = run?.status || 'draft';
  if (st === 'closed') throw new ApiError(`${P.mLabel(month)} payroll is closed. The MD can reopen it on the Payroll page.`, 409);
  if (st === 'review' || st === 'approved') throw new ApiError(`${P.mLabel(month)} payroll is ${st === 'review' ? 'under review' : 'approved'} and read-only. Send it back to HR to change it.`, 409);
}
async function assertTimesheetOpen(employeeId, month) {
  const a = await M.HrAttendance.findOne({ employee: employeeId, month }, { approval: 1 }).lean();
  if (a?.approval?.at) throw new ApiError(`The ${P.mLabel(month)} timesheet of this employee is approved. Reopen it first.`, 409);
}

module.exports = {
  PAY_ROLES, EDIT_ROLES, PAY_FIELDS, canSeePay, userName, assertRole, todayCairo, assertMonth, assertDate, num, str, TIME_RE, DATE_RE,
  audit, settingsFor, saveSettings, myEmployee, visibleEmployeeIds, assertCanDecideFor, payOf, engineEmployee, shapeEmployee, loadMonth,
  monthRange, runOf, assertMonthOpen, assertTimesheetOpen, docsObj,
};
