'use strict';

// Reservia HR Portal - records and workflows (HR Portal Developer Spec sections 4 and 7). Every
// rule below is the reference prototype's or the spec's; where the two differ the spec wins (it
// says so itself): e.g. inputs of a month under review are read-only, and a month closes only from
// Approved. Every write is audited (hrCore.audit).

const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const M = require('../../models/hr/hrModels');
const P = require('./payrollEngine');
const C = require('./hrCore');
const crypto = require('./hrCrypto');
const { buildExampleTeam } = require('./exampleTeam');

const { assertRole, EDIT_ROLES, audit, str, num, assertDate, assertMonth, TIME_RE } = C;
const oid = id => {
  if (!mongoose.Types.ObjectId.isValid(String(id || ''))) throw new ApiError('Record not found.', 404);
  return new mongoose.Types.ObjectId(String(id));
};
async function found(Model, id, label) {
  const doc = await Model.findById(oid(id));
  if (!doc) throw new ApiError(`${label} not found.`, 404);
  return doc;
}
const plain = d => (d && d.toObject ? d.toObject() : d);

/* ===================== employees ===================== */
const EMP_FIELDS = ['code', 'name', 'role', 'dept', 'status', 'type', 'hire', 'end', 'city', 'mgr', 'phone', 'email', 'emg', 'emgp', 'file', 'nat', 'sin', 'edu', 'cno', 'offerDate', 'cstart', 'cend', 'probEnd', 'paym', 'signedFile'];

async function nextCode() {
  const all = await M.HrEmployee.find({}, { code: 1 }).lean();
  let n = all.length + 1;
  const used = new Set(all.map(e => e.code));
  while (used.has(`EMP-${P.pad(n)}`)) n++;
  return `EMP-${P.pad(n)}`;
}

async function cleanEmployee(body, existing) {
  const o = {};
  EMP_FIELDS.forEach(k => {
    if (body[k] !== undefined) o[k] = str(body[k], 300) || '';
  });
  if (existing === null || o.name !== undefined) if (!(o.name ?? existing?.name)) throw new ApiError('Enter the employee name.', 400);
  if (existing === null || o.hire !== undefined) assertDate(o.hire ?? existing?.hire, 'Joining date');
  ['end', 'offerDate', 'cstart', 'cend', 'probEnd'].forEach(k => {
    if (o[k]) assertDate(o[k], k);
  });
  if (o.end && (o.hire || existing?.hire) && o.end < (o.hire || existing.hire)) throw new ApiError('The leaving date is before the joining date.', 400);
  if (o.status && !P.EMP_STATUS.includes(o.status)) throw new ApiError('Status is Active, Probation or Left.', 400);
  if (o.dept && !P.DEPTS.includes(o.dept)) throw new ApiError('Unknown department.', 400);
  if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) throw new ApiError('The email address is not valid.', 400);
  if (body.insured !== undefined) o.insured = !!body.insured;
  if (body.mgrId !== undefined) o.mgrId = body.mgrId ? oid(body.mgrId) : null;
  if (body.user !== undefined) o.user = body.user ? oid(body.user) : null;
  // "Reports to" by name (as in the prototype) links the manager record when the name matches one.
  if (o.mgr !== undefined && body.mgrId === undefined) {
    const m = o.mgr ? await M.HrEmployee.findOne({ name: new RegExp(`^${o.mgr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, { _id: 1 }).lean() : null;
    o.mgrId = m && (!existing || String(m._id) !== String(existing._id)) ? m._id : null;
  }
  const pay = {};
  let payTouched = false;
  C.PAY_FIELDS.forEach(k => {
    if (body[k] !== undefined) {
      payTouched = true;
      pay[k] = num(body[k], k, { min: 0, max: 10000000 }) || 0;
    }
  });
  return { o, pay, payTouched };
}

async function createEmployee(body, ctx) {
  assertRole(ctx, EDIT_ROLES, 'add employees');
  const { o, pay } = await cleanEmployee(body, null);
  if (!o.code) o.code = await nextCode();
  if (await M.HrEmployee.exists({ code: o.code })) throw new ApiError(`Employee code ${o.code} is already used.`, 409);
  if (!o.cend && (o.cstart || o.hire)) o.cend = P.addMonthsTo(o.cstart || o.hire, 12);
  if (!o.probEnd && o.hire) o.probEnd = P.addMonthsTo(o.hire, 3);
  const full = Object.assign({ basic: 0, transport: 0, incentive: 0, commission: 0, other: 0, insBase: 0 }, pay);
  const doc = await M.HrEmployee.create(Object.assign(o, { payBox: crypto.seal(full), createdBy: ctx.user?._id, updatedBy: ctx.user?._id }));
  await audit(ctx, 'employees', doc._id, 'create', null, { ...o, pay: full });
  return C.shapeEmployee(doc.toObject(), ctx.role);
}

async function updateEmployee(id, body, ctx) {
  assertRole(ctx, EDIT_ROLES, 'edit employees');
  const doc = await found(M.HrEmployee, id, 'Employee');
  const before = plain(doc);
  const { o, pay, payTouched } = await cleanEmployee(body, before);
  if (o.code && o.code !== doc.code && (await M.HrEmployee.exists({ code: o.code }))) throw new ApiError(`Employee code ${o.code} is already used.`, 409);
  const oldPay = C.payOf(before);
  const newPay = payTouched ? Object.assign({}, oldPay, pay) : oldPay;
  const contractChanged = payTouched && C.PAY_FIELDS.some(k => (+oldPay[k] || 0) !== (+newPay[k] || 0));
  if (contractChanged || (o.cno && o.cno !== doc.cno)) {
    // One current contract; the previous terms are kept (spec section 4: "history kept").
    doc.contractHistory.push({ at: new Date(), by: ctx.user?._id, cno: doc.cno, cstart: doc.cstart, cend: doc.cend, payBox: doc.payBox });
  }
  Object.assign(doc, o);
  if (payTouched || !crypto.isEncrypted(doc.payBox)) doc.payBox = crypto.seal(newPay);
  doc.updatedBy = ctx.user?._id;
  await doc.save();
  await audit(ctx, 'employees', doc._id, 'update', { ...pick(before, Object.keys(o)), pay: payTouched ? oldPay : undefined }, { ...o, pay: payTouched ? newPay : undefined });
  return C.shapeEmployee(doc.toObject(), ctx.role);
}
const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj?.[k]]));

async function deleteEmployee(id, ctx) {
  assertRole(ctx, EDIT_ROLES, 'delete employees');
  const doc = await found(M.HrEmployee, id, 'Employee');
  if (!doc.example) {
    // Personnel and payroll records are kept 5 years after exit (spec section 10): a person with any
    // time or pay history is marked Left, never deleted.
    const used = await Promise.all([M.HrAttendance.exists({ employee: doc._id }), M.HrVisit.exists({ employee: doc._id }), M.HrExpense.exists({ employee: doc._id }), M.HrPayslipFile.exists({ employee: doc._id })]);
    if (used.some(Boolean)) throw new ApiError('This employee has attendance, visit, claim or payroll records, which are kept 5 years. Set the status to Left instead.', 409);
  }
  await doc.deleteOne();
  await audit(ctx, 'employees', doc._id, 'delete', { code: doc.code, name: doc.name }, null);
}

async function saveDocument(id, k, body, ctx) {
  assertRole(ctx, EDIT_ROLES, 'record documents');
  const def = P.DOCS.find(d => d.k === k);
  if (!def) throw new ApiError('Unknown document.', 400);
  const doc = await found(M.HrEmployee, id, 'Employee');
  const st = body.st;
  if (!['pending', 'ok', 'na'].includes(st)) throw new ApiError('Status is pending, ok or na.', 400);
  const rec = { st, date: assertDate(body.date, 'Date received', true), loc: str(body.loc, 300) || '' };
  if (def.exp) rec.exp = assertDate(body.exp, 'Expiry date', true);
  const before = doc.docs.get(k);
  doc.docs.set(k, rec);
  doc.updatedBy = ctx.user?._id;
  await doc.save();
  await audit(ctx, 'documents', `${doc._id}:${k}`, 'update', before ? plain(before) : null, rec);
  return rec;
}

async function saveExit(id, body, ctx) {
  assertRole(ctx, EDIT_ROLES, 'update the exit clearance');
  const doc = await found(M.HrEmployee, id, 'Employee');
  const steps = {};
  Object.keys(body.steps || {}).forEach(i => {
    if (/^\d+$/.test(i) && +i < 12) steps[i] = !!body.steps[i];
  });
  const exit = { last: assertDate(body.last, 'Last working day', true), reason: ['Resignation', 'Termination', 'End of contract'].includes(body.reason) ? body.reason : 'Resignation', steps };
  const before = doc.exit ? plain(doc.exit) : null;
  doc.exit = exit;
  await doc.save();
  await audit(ctx, 'employees', doc._id, 'exit', before, exit);
  return exit;
}

/* ===================== attendance & timesheets ===================== */
function cleanDay(rec) {
  if (!rec) return null;
  const s = String(rec.s || '');
  if (s && !P.ATT_CODES.includes(s)) throw new ApiError(`Unknown attendance code ${s}.`, 400);
  const tin = String(rec.in || '');
  const tout = String(rec.out || '');
  if (tin && !TIME_RE.test(tin)) throw new ApiError('Time in must be HH:MM.', 400);
  if (tout && !TIME_RE.test(tout)) throw new ApiError('Time out must be HH:MM.', 400);
  if (!s && !tin && !tout && !rec.n) return null;
  return { s, in: tin, out: tout, n: str(rec.n, 200) || '', src: ['manual', 'form', 'device'].includes(rec.src) ? rec.src : 'manual' };
}

/** Writes day records { 'YYYY-MM-DD': rec|null } for one employee, all in one month. */
async function writeDays(employeeId, month, updates, ctx, { skipLocks = false, action = 'update' } = {}) {
  if (!skipLocks) {
    await C.assertMonthOpen(month);
    await C.assertTimesheetOpen(employeeId, month);
  }
  const emp = await M.HrEmployee.findById(employeeId, { hire: 1, end: 1 }).lean();
  if (!emp) throw new ApiError('Employee not found.', 404);
  let doc = await M.HrAttendance.findOne({ employee: employeeId, month });
  if (!doc) doc = new M.HrAttendance({ employee: employeeId, month, days: {}, createdBy: ctx.user?._id });
  const days = Object.assign({}, doc.days || {});
  const before = {};
  const after = {};
  Object.keys(updates).forEach(date => {
    if (date.slice(0, 7) !== month) throw new ApiError('All days must be in the same month.', 400);
    assertDate(date);
    if ((emp.hire && date < emp.hire) || (emp.end && date > emp.end)) throw new ApiError(`${date} is outside the employment dates.`, 400);
    const dd = date.slice(8);
    before[dd] = days[dd] || null;
    const rec = cleanDay(updates[date]);
    if (rec) days[dd] = rec;
    else delete days[dd];
    after[dd] = rec;
  });
  doc.days = days;
  doc.markModified('days');
  doc.updatedBy = ctx.user?._id;
  await doc.save();
  await audit(ctx, 'attendance', `${employeeId}:${month}`, action, before, after);
  return doc;
}

async function saveDay(date, rows, ctx) {
  assertRole(ctx, EDIT_ROLES, 'record attendance');
  assertDate(date);
  const month = date.slice(0, 7);
  await C.assertMonthOpen(month);
  let n = 0;
  for (const r of rows || []) {
    await C.assertTimesheetOpen(r.empId, month);
    await writeDays(oid(r.empId), month, { [date]: { s: r.s, in: r.in, out: r.out, n: r.n } }, ctx);
    n++;
  }
  return { saved: n };
}

async function saveTimesheetDays(employeeId, month, updates, ctx) {
  assertRole(ctx, EDIT_ROLES, 'edit timesheets');
  assertMonth(month);
  return writeDays(oid(employeeId), month, updates || {}, ctx);
}

/** "Mark blank working days present" - the prototype's tsfill (shift start to start + hours + break). */
async function fillBlanks(employeeId, month, ctx) {
  assertRole(ctx, EDIT_ROLES, 'edit timesheets');
  assertMonth(month);
  const { engine } = await C.loadMonth(month);
  const e = engine.empById(String(employeeId));
  if (!e) throw new ApiError('Employee not found.', 404);
  const s = P.mins(engine.cfg.shiftStart) || 540;
  const t = [s, s + (engine.cfg.stdHours + engine.cfg.breakH) * 60].map(x => `${P.pad(Math.floor(x / 60) % 24)}:${P.pad(x % 60)}`);
  const upd = {};
  for (let i = 1; i <= P.daysIn(month); i++) {
    const date = `${month}-${P.pad(i)}`;
    const inf = engine.dayInfo(e, date);
    if (!inf.emp || inf.s || inf.rest || inf.hol) continue;
    upd[date] = { s: 'P', in: t[0], out: t[1] };
  }
  if (Object.keys(upd).length) await writeDays(oid(employeeId), month, upd, ctx, { action: 'fill' });
  return { filled: Object.keys(upd).length };
}

async function approveTimesheet(employeeId, month, ctx) {
  assertMonth(month);
  await C.assertCanDecideFor(ctx, employeeId);
  await C.assertMonthOpen(month);
  const { engine } = await C.loadMonth(month);
  const e = engine.empById(String(employeeId));
  if (!e) throw new ApiError('Employee not found.', 404);
  const unrec = engine.calcPay(e, month).t.unrec;
  if (unrec) throw new ApiError(`Fill the ${unrec} blank working day${unrec > 1 ? 's' : ''} first.`, 409);
  const approval = { at: new Date(), by: ctx.user?._id, byName: C.userName(ctx.user) };
  await M.HrAttendance.updateOne({ employee: oid(employeeId), month }, { $set: { approval }, $setOnInsert: { days: {} } }, { upsert: true });
  await audit(ctx, 'timesheets', `${employeeId}:${month}`, 'approve', null, approval);
  return approval;
}

async function reopenTimesheet(employeeId, month, ctx) {
  assertMonth(month);
  await C.assertCanDecideFor(ctx, employeeId);
  // Reopen is allowed until the payroll month is closed (spec section 7).
  const run = await C.runOf(month);
  if (run?.status === 'closed') throw new ApiError(`${P.mLabel(month)} payroll is closed.`, 409);
  await M.HrAttendance.updateOne({ employee: oid(employeeId), month }, { $unset: { approval: 1 } });
  await audit(ctx, 'timesheets', `${employeeId}:${month}`, 'reopen', null, null);
}

/* ===================== site visits ===================== */
function cleanVisit(b, cfg) {
  const v = {
    employee: oid(b.empId), date: assertDate(b.date, 'First day'), city: str(b.city, 80) || '', site: str(b.site, 200) || '', purpose: P.PURPOSES.includes(b.purpose) ? b.purpose : P.PURPOSES[0],
    status: P.VISIT_STATUS.includes(b.status) ? b.status : 'Planned', days: Math.max(1, Math.round(num(b.days, 'Days', { min: 1, max: 60 }) || 1)), nights: Math.max(0, Math.round(num(b.nights, 'Nights', { min: 0, max: 60 }) || 0)),
    transport: num(b.transport, 'Transport') || 0, accom: num(b.accom, 'Accommodation') || 0, meals: num(b.meals, 'Meals') || 0, mealsProvided: !!b.mealsProvided,
    ref: str(b.ref, 120) || '', notes: str(b.notes, 2000) || '', report: str(b.report, 4000) || '',
  };
  if (cfg && v.city && !cfg.cities.some(c => c.n === v.city)) throw new ApiError(`City ${v.city} is not in the city table (Settings).`, 400);
  return v;
}

/** Marking a visit Done records its working days as V in Attendance (prototype savevis). */
async function postVisitDays(v, ctx) {
  if (v.status !== 'Done') return 0;
  const months = {};
  for (let i = 0; i < v.days; i++) {
    const dt = P.dAdd(v.date, i);
    (months[dt.slice(0, 7)] = months[dt.slice(0, 7)] || []).push(dt);
  }
  let n = 0;
  for (const month of Object.keys(months)) {
    const run = await C.runOf(month);
    if (run && run.status !== 'draft') continue;
    const a = await M.HrAttendance.findOne({ employee: v.employee, month }).lean();
    if (a?.approval?.at) continue;
    const { engine } = await C.loadMonth(month);
    const e = engine.empById(String(v.employee));
    if (!e) continue;
    const upd = {};
    months[month].forEach(dt => {
      if (!engine.inEmp(e, dt)) return;
      const inf = engine.dayInfo(e, dt);
      if (!inf.s && !inf.rest && !inf.hol) upd[dt] = { s: 'V', in: '08:30', out: '17:30', n: '', src: 'form' };
    });
    if (Object.keys(upd).length) {
      await writeDays(v.employee, month, upd, ctx, { skipLocks: true, action: 'visit' });
      n += Object.keys(upd).length;
    }
  }
  return n;
}

async function saveVisit(id, body, ctx) {
  assertRole(ctx, EDIT_ROLES, 'log site visits');
  const { values } = await C.settingsFor(String(body.date || '').slice(0, 7) || '2026-01');
  const v = cleanVisit(body, P.config(values));
  await C.assertMonthOpen(v.date.slice(0, 7));
  let doc;
  let before = null;
  if (id) {
    doc = await found(M.HrVisit, id, 'Visit');
    before = plain(doc);
    if (before.status === 'Done') await C.assertMonthOpen(before.date.slice(0, 7));
    Object.assign(doc, v, { updatedBy: ctx.user?._id });
    await doc.save();
  } else doc = await M.HrVisit.create(Object.assign(v, { createdBy: ctx.user?._id }));
  const posted = await postVisitDays(doc.toObject(), ctx);
  await audit(ctx, 'visits', doc._id, id ? 'update' : 'create', before, v);
  return { visit: doc.toObject(), attendanceDays: posted };
}

async function deleteVisit(id, ctx) {
  assertRole(ctx, EDIT_ROLES, 'delete site visits');
  const doc = await found(M.HrVisit, id, 'Visit');
  if (doc.status === 'Done') await C.assertMonthOpen(doc.date.slice(0, 7));
  await doc.deleteOne();
  await audit(ctx, 'visits', doc._id, 'delete', plain(doc), null);
}

/* ===================== expense claims ===================== */
async function saveExpense(id, body, ctx) {
  assertRole(ctx, EDIT_ROLES, 'record expense claims');
  const x = {
    employee: oid(body.empId), date: assertDate(body.date, 'Date paid'), type: P.EXPENSE_TYPES.includes(body.type) ? body.type : 'Other',
    amount: num(body.amount, 'Amount', { min: 0.01, max: 10000000, optional: false }), payMonth: assertMonth(body.payMonth || String(body.date).slice(0, 7), 'Reimburse with payroll of'),
    ref: str(body.ref, 120) || '', desc: str(body.desc, 300) || '', receipt: !!body.receipt,
  };
  let doc;
  let before = null;
  if (id) {
    doc = await found(M.HrExpense, id, 'Claim');
    before = plain(doc);
    if (doc.status === 'Approved') await C.assertMonthOpen(doc.payMonth);
    if (doc.status !== 'Pending' && ctx.role !== 'md') throw new ApiError('A decided claim can be changed by the MD only.', 403);
    Object.assign(doc, x, { updatedBy: ctx.user?._id });
    await doc.save();
  } else doc = await M.HrExpense.create(Object.assign(x, { status: 'Pending', created: C.todayCairo(), createdBy: ctx.user?._id }));
  await audit(ctx, 'expenses', doc._id, id ? 'update' : 'create', before, x);
  return doc.toObject();
}

async function decideExpense(id, body, ctx) {
  const doc = await found(M.HrExpense, id, 'Claim');
  await C.assertCanDecideFor(ctx, doc.employee);
  const status = body.status;
  if (!P.FORM_STATUS.includes(status)) throw new ApiError('Status is Pending, Approved or Rejected.', 400);
  const before = plain(doc);
  if (status === 'Approved') {
    // Receipt file required unless the MD overrides (spec section 7).
    const override = !!body.receiptOverride;
    if (override && ctx.role !== 'md') throw new ApiError('Only the MD can approve a claim without a receipt.', 403);
    if (!doc.receipt && !override) throw new ApiError('A receipt is required. The MD can approve without one.', 409);
    doc.receiptOverride = override && !doc.receipt;
    if (body.payMonth) doc.payMonth = assertMonth(body.payMonth, 'Reimburse with payroll of');
    await C.assertMonthOpen(doc.payMonth);
  }
  if (before.status === 'Approved') await C.assertMonthOpen(before.payMonth);
  doc.status = status;
  doc.by = str(body.by, 120) || C.userName(ctx.user);
  doc.decidedBy = ctx.user?._id;
  doc.decided = status === 'Pending' ? undefined : C.todayCairo();
  doc.note = str(body.note, 500) || '';
  await doc.save();
  await audit(ctx, 'expenses', doc._id, 'decide', { status: before.status }, { status, payMonth: doc.payMonth, receiptOverride: doc.receiptOverride, note: doc.note });
  return doc.toObject();
}

async function deleteExpense(id, ctx) {
  assertRole(ctx, EDIT_ROLES, 'delete claims');
  const doc = await found(M.HrExpense, id, 'Claim');
  if (doc.status === 'Approved') await C.assertMonthOpen(doc.payMonth);
  await doc.deleteOne();
  await audit(ctx, 'expenses', doc._id, 'delete', plain(doc), null);
}

/* ===================== forms HR-F01 / F02 / F03 ===================== */
async function cleanForm(ft, b, engine) {
  if (!['leave', 'ot', 'visit'].includes(ft)) throw new ApiError('Unknown form.', 400);
  const f = { ft, employee: oid(b.empId), reason: str(b.reason, 2000) || '' };
  const e = engine.empById(String(f.employee));
  if (!e) throw new ApiError('Employee not found.', 404);
  const warnings = [];
  if (ft === 'leave') {
    Object.assign(f, { ltype: P.LEAVE_TYPES.includes(b.ltype) ? b.ltype : 'Annual leave', from: assertDate(b.from, 'First day of leave'), to: assertDate(b.to, 'Last day of leave'), cover: str(b.cover, 120) || '', phone: str(b.phone, 40) || '' });
    if (f.to < f.from) throw new ApiError('Check the leave dates.', 400);
    f.days = engine.wdList(e, f.from, f.to).length;
    if (!f.days) throw new ApiError('No working days in that range.', 400);
    const yr = f.from.slice(0, 4);
    const used = engine.leaveUsed(String(f.employee), yr);
    const ent = engine.leaveEnt(e, yr);
    // Balance and casual-leave rules warn, never block (spec section 7).
    if ((f.ltype === 'Annual leave' || f.ltype === 'Casual leave') && used + f.days > ent) warnings.push(`This takes the annual balance to ${used + f.days} of ${ent} days.`);
    if (f.ltype === 'Casual leave') {
      if (f.days > 2) warnings.push('More than 2 days of casual leave at once.');
      if (engine.casualUsed(String(f.employee), yr) + f.days > 7) warnings.push('Casual leave above 7 days this year.');
    }
    if (f.ltype === 'Annual leave' && P.diffDays(f.from, engine.today) < 14) warnings.push('Policy asks for 14 working days notice before the first day of annual leave.');
    if (f.ltype === 'Unpaid leave') warnings.push('Unpaid leave needs the written approval of the MD.');
  }
  if (ft === 'ot') {
    Object.assign(f, { odate: assertDate(b.odate, 'Date of the work'), kind: P.OT_KINDS.includes(b.kind) ? b.kind : P.OT_KINDS[0], from: TIME_RE.test(b.from || '') ? b.from : '', to: TIME_RE.test(b.to || '') ? b.to : '', hours: num(b.hours, 'Hours', { min: 0.25, max: 24, optional: false }), site: str(b.site, 200) || '' });
    // Approval comes before the work; a past date is allowed as an exception with a reason.
    f.exception = f.odate < engine.today;
    if (f.exception && f.reason.length < 3) throw new ApiError('This date has passed: record it as an exception and give the reason.', 400);
    if (f.hours > 3 && f.kind === P.OT_KINDS[0]) warnings.push('Time at work, overtime included, is capped at 12 hours a day.');
  }
  if (ft === 'visit') {
    Object.assign(f, { from: assertDate(b.from, 'First day'), city: str(b.city, 80) || '', site: str(b.site, 200) || '', purpose: P.PURPOSES.includes(b.purpose) ? b.purpose : P.PURPOSES[0], days: Math.max(1, Math.round(+b.days || 1)), nights: Math.max(0, Math.round(+b.nights || 0)), back: assertDate(b.back || b.from, 'Expected return'), transport: str(b.transport, 80) || '', stay: str(b.stay, 80) || '', meals: str(b.meals, 80) || '', ref: str(b.ref, 120) || '' });
    if (!f.site) throw new ApiError('Enter the client or site.', 400);
  }
  return { f, warnings };
}

async function unpostLeave(formId, ctx) {
  const tag = `HR-F01:${formId}`;
  const docs = await M.HrAttendance.find({}).lean();
  for (const a of docs) {
    const hit = Object.keys(a.days || {}).filter(dd => a.days[dd]?.n === tag);
    if (!hit.length) continue;
    const run = await C.runOf(a.month);
    if (run && run.status !== 'draft') continue;
    await writeDays(a.employee, a.month, Object.fromEntries(hit.map(dd => [`${a.month}-${dd}`, null])), ctx, { skipLocks: true, action: 'leave-unpost' });
  }
}

/** Approved leave writes attendance rows with the form reference (prototype postLeave). */
async function postLeave(form, ctx) {
  const code = P.LEAVE_CODE[form.ltype] || 'L';
  const months = {};
  let n = 0;
  const { engine } = await C.loadMonth(form.from.slice(0, 7));
  const e = engine.empById(String(form.employee));
  engine.wdList(e, form.from, form.to).forEach(dt => {
    (months[dt.slice(0, 7)] = months[dt.slice(0, 7)] || []).push(dt);
  });
  for (const month of Object.keys(months)) {
    const run = await C.runOf(month);
    if (run && run.status !== 'draft') continue;
    const { engine: em } = await C.loadMonth(month);
    const upd = {};
    months[month].forEach(dt => {
      if (!em.dayInfo(em.empById(String(form.employee)), dt).s) upd[dt] = { s: code, in: '', out: '', n: `HR-F01:${form._id}`, src: 'form' };
    });
    if (Object.keys(upd).length) {
      await writeDays(form.employee, month, upd, ctx, { skipLocks: true, action: 'leave-post' });
      n += Object.keys(upd).length;
    }
  }
  return n;
}

async function saveForm(id, body, ctx) {
  assertRole(ctx, EDIT_ROLES, 'submit forms');
  const { engine } = await C.loadMonth(C.todayCairo().slice(0, 7));
  let doc;
  let before = null;
  let ft = body.ft;
  if (id) {
    doc = await found(M.HrForm, id, 'Form');
    ft = doc.ft;
    before = plain(doc);
    if (doc.status !== 'Pending') throw new ApiError('A decided form cannot be edited. Change the decision first.', 409);
  }
  const { f, warnings } = await cleanForm(ft, body, engine);
  if (doc) {
    Object.assign(doc, f, { updatedBy: ctx.user?._id });
    await doc.save();
  } else doc = await M.HrForm.create(Object.assign(f, { status: 'Pending', created: C.todayCairo(), createdBy: ctx.user?._id }));
  await audit(ctx, 'forms', doc._id, id ? 'update' : 'create', before, f);
  return { form: doc.toObject(), warnings };
}

async function decideForm(id, body, ctx) {
  const doc = await found(M.HrForm, id, 'Form');
  await C.assertCanDecideFor(ctx, doc.employee);
  const status = body.status;
  if (!P.FORM_STATUS.includes(status)) throw new ApiError('Status is Pending, Approved or Rejected.', 400);
  const before = plain(doc);
  doc.status = status;
  doc.by = str(body.by, 120) || C.userName(ctx.user);
  doc.decidedBy = ctx.user?._id;
  doc.decided = status === 'Pending' ? undefined : before.status === status && before.decided ? before.decided : C.todayCairo();
  doc.dnote = str(body.dnote, 500) || '';
  await doc.save();
  const effects = {};
  if (doc.ft === 'leave') {
    await unpostLeave(String(doc._id), ctx);
    if (status === 'Approved') effects.attendanceDays = await postLeave(doc.toObject(), ctx);
  }
  if (doc.ft === 'visit' && status === 'Approved' && !doc.visit) {
    const v = await M.HrVisit.create({ employee: doc.employee, date: doc.from, city: doc.city, site: doc.site, purpose: doc.purpose, status: 'Planned', days: doc.days || 1, nights: doc.nights || 0, ref: doc.ref || '', notes: doc.reason || '', mealsProvided: doc.meals !== 'Not provided', form: doc._id, createdBy: ctx.user?._id });
    doc.visit = v._id;
    await doc.save();
    effects.visit = String(v._id);
  }
  await audit(ctx, 'forms', doc._id, 'decide', { status: before.status }, { status, by: doc.by, dnote: doc.dnote, ...effects });
  return { form: doc.toObject(), effects };
}

async function deleteForm(id, ctx) {
  assertRole(ctx, EDIT_ROLES, 'delete forms');
  const doc = await found(M.HrForm, id, 'Form');
  if (doc.ft === 'leave') await unpostLeave(String(doc._id), ctx);
  await doc.deleteOne();
  await audit(ctx, 'forms', doc._id, 'delete', plain(doc), null);
}

/* ===================== targets & adjustments ===================== */
async function setTarget(employeeId, month, pct, ctx) {
  assertRole(ctx, EDIT_ROLES, 'enter targets');
  assertMonth(month);
  await C.assertMonthOpen(month);
  const employee = oid(employeeId);
  const before = await M.HrTarget.findOne({ employee, month }).lean();
  if (pct === '' || pct === null || pct === undefined) await M.HrTarget.deleteOne({ employee, month });
  else await M.HrTarget.updateOne({ employee, month }, { $set: { pct: num(pct, 'Target achieved', { min: 0, max: 1000, optional: false }), setBy: ctx.user?._id, setByName: C.userName(ctx.user) } }, { upsert: true });
  await audit(ctx, 'targets', `${employeeId}:${month}`, 'set', before ? { pct: before.pct } : null, { pct });
}

async function addAdjustment(employeeId, month, body, ctx) {
  assertRole(ctx, EDIT_ROLES, 'add adjustments');
  assertMonth(month);
  await C.assertMonthOpen(month);
  const a = { employee: oid(employeeId), month, label: str(body.label, 120), type: body.type === 'ded' ? 'ded' : 'add', amount: num(body.amount, 'Amount', { min: 0.01, max: 10000000, optional: false }), taxable: body.taxable !== false, createdBy: ctx.user?._id };
  if (!a.label) throw new ApiError('Add a description.', 400);
  const doc = await M.HrAdjustment.create(a);
  await audit(ctx, 'adjustments', doc._id, 'create', null, a);
  return doc.toObject();
}

async function deleteAdjustment(id, ctx) {
  assertRole(ctx, EDIT_ROLES, 'remove adjustments');
  const doc = await found(M.HrAdjustment, id, 'Adjustment');
  await C.assertMonthOpen(doc.month);
  await doc.deleteOne();
  await audit(ctx, 'adjustments', doc._id, 'delete', plain(doc), null);
}

/* ===================== training, assets, performance, candidates ===================== */
const SIMPLE = {
  training: {
    Model: M.HrTraining, label: 'Training record',
    clean: b => ({ employee: oid(b.empId), kind: P.CERT_KINDS.includes(b.kind) ? b.kind : P.CERT_KINDS[0], course: str(b.course, 160), provider: str(b.provider, 160) || '', date: assertDate(b.date, 'Date completed'), hours: num(b.hours, 'Hours', { max: 1000 }), exp: assertDate(b.exp, 'Valid until', true), cost: num(b.cost, 'Cost'), cert: !!b.cert }),
    check: x => {
      if (!x.course) throw new ApiError('Choose an employee, a course and a date.', 400);
    },
  },
  assets: {
    Model: M.HrAsset, label: 'Asset',
    clean: b => ({ employee: oid(b.empId), type: P.ASSET_TYPES.includes(b.type) ? b.type : 'Other', desc: str(b.desc, 200) || '', serial: str(b.serial, 120) || '', issued: assertDate(b.issued, 'Issued on'), returned: assertDate(b.returned, 'Returned on', true), cond: str(b.cond, 120) || '', value: num(b.value, 'Value'), note: str(b.note, 1000) || '' }),
  },
  performance: {
    Model: M.HrPerformance, label: 'Review',
    clean: b => {
      const goals = (Array.isArray(b.goals) ? b.goals : []).map(g => ({ t: str(g.t, 200), w: num(g.w, 'Weight', { max: 100 }) || 0, s: Math.min(5, Math.max(1, Math.round(+g.s || 3))) })).filter(g => g.t);
      const tw = goals.reduce((a, g) => a + g.w, 0);
      // Weighted score = sum(w*s)/sum(w) (spec section 4).
      const rating = tw ? Math.round((goals.reduce((a, g) => a + g.w * g.s, 0) / tw) * 10) / 10 : 0;
      return { employee: oid(b.empId), cycle: str(b.cycle, 40) || '', date: assertDate(b.date, 'Review date'), by: str(b.by, 120) || '', goals, rating, note: str(b.note, 4000) || '' };
    },
    check: x => {
      if (!x.goals.length) throw new ApiError('Enter at least one goal.', 400);
    },
  },
  candidates: {
    Model: M.HrCandidate, label: 'Candidate',
    clean: b => ({ name: str(b.name, 120), role: str(b.role, 120) || '', dept: P.DEPTS.includes(b.dept) ? b.dept : 'Sales', stage: P.STAGES.includes(b.stage) ? b.stage : 'Applied', src: str(b.src, 80) || '', phone: str(b.phone, 40) || '', email: str(b.email, 120) || '', offer: num(b.offer, 'Offer'), start: assertDate(b.start, 'Planned start', true), notes: str(b.notes, 4000) || '' }),
    check: x => {
      if (!x.name) throw new ApiError('Enter the candidate name.', 400);
    },
  },
};

async function saveSimple(kind, id, body, ctx) {
  assertRole(ctx, EDIT_ROLES, `edit ${kind}`);
  const S = SIMPLE[kind];
  if (!S) throw new ApiError('Unknown record type.', 404);
  const x = S.clean(body || {});
  if (S.check) S.check(x);
  let doc;
  let before = null;
  if (id) {
    doc = await found(S.Model, id, S.label);
    before = plain(doc);
    Object.assign(doc, x, { updatedBy: ctx.user?._id });
    await doc.save();
  } else doc = await S.Model.create(Object.assign(x, { createdBy: ctx.user?._id }));
  await audit(ctx, kind, doc._id, id ? 'update' : 'create', before, x);
  return doc.toObject();
}

async function deleteSimple(kind, id, ctx) {
  assertRole(ctx, EDIT_ROLES, `delete ${kind}`);
  const S = SIMPLE[kind];
  if (!S) throw new ApiError('Unknown record type.', 404);
  const doc = await found(S.Model, id, S.label);
  await doc.deleteOne();
  await audit(ctx, kind, doc._id, 'delete', plain(doc), null);
}

/** Convert a candidate: creates the employee and a draft contract (spec section 4). */
async function hireCandidate(id, ctx) {
  assertRole(ctx, EDIT_ROLES, 'convert candidates');
  const cand = await found(M.HrCandidate, id, 'Candidate');
  if (cand.employee) throw new ApiError('This candidate is already an employee.', 409);
  const start = cand.start || C.todayCairo();
  const emp = await createEmployee({ name: cand.name, role: cand.role, dept: cand.dept || 'Admin', status: 'Probation', type: 'Contract', hire: start, cstart: start, cend: P.addMonthsTo(start, 12), probEnd: P.addMonthsTo(start, 3), city: 'Cairo', basic: cand.offer || 0, paym: 'Bank transfer', insured: true, phone: cand.phone, email: cand.email, mgr: '' }, ctx);
  cand.stage = 'Hired';
  cand.employee = emp._id;
  await cand.save();
  await audit(ctx, 'candidates', cand._id, 'hire', null, { employee: emp._id });
  return emp;
}

/* ===================== example team ===================== */
async function loadExampleTeam(ctx) {
  assertRole(ctx, ['md', 'hr'], 'load the example team');
  if (await M.HrEmployee.exists({ example: true })) throw new ApiError('The example team is already loaded.', 409);
  const today = C.todayCairo();
  const { values } = await C.settingsFor(today.slice(0, 7));
  const t = buildExampleTeam(today, values);
  const codes = t.emp.map(e => e.code);
  if (await M.HrEmployee.exists({ code: { $in: codes } })) throw new ApiError('Employee codes EMP-01 to EMP-06 are already used, so the example team cannot be loaded.', 409);
  const ids = {};
  for (const e of t.emp) {
    const pay = { basic: e.basic, transport: e.transport, incentive: e.incentive, commission: e.commission, other: e.other, insBase: 0 };
    const rec = Object.assign({}, e);
    C.PAY_FIELDS.forEach(k => delete rec[k]);
    delete rec.mgrKey;
    const doc = await M.HrEmployee.create(Object.assign(rec, { payBox: crypto.seal(pay), createdBy: ctx.user?._id }));
    ids[e.key] = doc._id;
  }
  for (const e of t.emp) if (e.mgrKey) await M.HrEmployee.updateOne({ _id: ids[e.key] }, { $set: { mgrId: ids[e.mgrKey] } });
  const emp = r => ({ employee: ids[r.empKey], example: true, key: r.key });
  const strip = r => {
    const o = Object.assign({}, r);
    delete o.empKey;
    return o;
  };
  await M.HrTarget.insertMany(t.tgt.map(r => Object.assign(strip(r), emp(r))));
  await M.HrAsset.insertMany(t.ast.map(r => Object.assign(strip(r), emp(r))));
  await M.HrExpense.insertMany(t.exp.map(r => Object.assign(strip(r), emp(r), { created: today })));
  await M.HrPerformance.insertMany(t.perf.map(r => Object.assign(strip(r), emp(r))));
  await M.HrTraining.insertMany(t.trn.map(r => Object.assign(strip(r), emp(r))));
  await M.HrCandidate.insertMany(t.cand.map(r => Object.assign({}, r, { offer: r.offer || undefined })));
  await M.HrVisit.insertMany(t.vis.map(r => Object.assign(strip(r), emp(r))));
  await M.HrAttendance.insertMany(t.att.map(r => Object.assign(strip(r), emp(r))));
  await M.HrForm.insertMany(t.frm.map(r => Object.assign(strip(r), emp(r))));
  await audit(ctx, 'example', 'team', 'load', null, { employees: t.emp.length, today });
  return { employees: t.emp.length };
}

async function removeExampleTeam(ctx) {
  assertRole(ctx, ['md', 'hr'], 'remove the example data');
  const ex = await M.HrEmployee.find({ example: true }, { _id: 1 }).lean();
  const ids = ex.map(e => e._id);
  let n = 0;
  for (const Model of [M.HrTarget, M.HrAsset, M.HrExpense, M.HrPerformance, M.HrTraining, M.HrVisit, M.HrAttendance, M.HrForm, M.HrAdjustment]) {
    n += (await Model.deleteMany({ $or: [{ example: true }, { employee: { $in: ids } }] })).deletedCount;
  }
  n += (await M.HrCandidate.deleteMany({ example: true })).deletedCount;
  n += (await M.HrEmployee.deleteMany({ example: true })).deletedCount;
  await audit(ctx, 'example', 'team', 'remove', null, { removed: n });
  return { removed: n };
}

module.exports = {
  createEmployee, updateEmployee, deleteEmployee, saveDocument, saveExit, saveDay, saveTimesheetDays, fillBlanks, approveTimesheet, reopenTimesheet,
  saveVisit, deleteVisit, saveExpense, decideExpense, deleteExpense, saveForm, decideForm, deleteForm, setTarget, addAdjustment, deleteAdjustment,
  saveSimple, deleteSimple, hireCandidate, loadExampleTeam, removeExampleTeam, oid,
};
