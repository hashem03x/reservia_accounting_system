'use strict';

// Reservia HR Portal - the month view, the payroll workflow and its outputs (HR Portal Developer
// Spec sections 6 to 9).
//
// Workflow (section 7): draft (HR enters; the register recalculates live) -> review (submitted;
// read-only; needs 0 unrecorded working days or an explicit override with a note) -> approved (MD) ->
// closed (HR: payroll_lines frozen, attendance and visits of the month locked, payslip PDFs generated
// and stored, emails can be sent). Reopen is MD only, writes an audit entry and returns to draft;
// closed PDFs are kept as versions. Every stage change is stamped in the run log and the audit log.

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const ApiError = require('../../utils/apiError');
const M = require('../../models/hr/hrModels');
const P = require('./payrollEngine');
const C = require('./hrCore');
const box = require('./hrCrypto');
const pdf = require('./hrPdf');

const { assertRole, assertMonth, audit } = C;

/* ---------- rows ---------- */
async function runDoc(month) {
  return (await M.HrPayrollRun.findOne({ month })) || new M.HrPayrollRun({ month, status: 'draft', log: [] });
}

/** Payroll rows of a month: the frozen lines once closed, the live calculation before. */
async function payRows(month, loaded) {
  const run = await M.HrPayrollRun.findOne({ month }).lean();
  if (run?.status === 'closed' && run.rowsBox) return { rows: box.open(run.rowsBox, []), frozen: true, run };
  const L = loaded || (await C.loadMonth(month));
  return { rows: L.engine.empsIn(month).map(e => L.engine.calcPay(e, month)), frozen: false, run, engine: L.engine };
}

/** "Before you close" checks (prototype vPay): unrecorded days, open timesheets, OT without HR-F02, insurance registration. */
function issues(engine, month, rawAttendance) {
  const out = [];
  const E = engine.empsIn(month);
  let unrec = 0;
  let unap = 0;
  let otNo = 0;
  E.forEach(e => {
    unrec += engine.calcPay(e, month).t.unrec;
    const a = rawAttendance.find(x => String(x.employee) === e.id && x.month === month);
    if (!a?.approval?.at) unap++;
    for (let i = 1; i <= P.daysIn(month); i++) {
      const dt = `${month}-${P.pad(i)}`;
      const inf = engine.dayInfo(e, dt);
      if ((inf.ot > 0 || inf.sp > 0) && !engine.otApproved(e.id, dt)) otNo++;
    }
  });
  if (unrec) out.push({ level: 'warn', view: 'att', text: `${unrec} working day${unrec > 1 ? 's have' : ' has'} no attendance entry. Blank days are paid in full, so fill them first.` });
  if (unap) out.push({ level: 'info', view: 'ts', text: `${unap} timesheet${unap > 1 ? 's are' : ' is'} not approved yet.` });
  if (otNo) out.push({ level: 'info', view: 'forms', text: `${otNo} day${otNo > 1 ? 's' : ''} of overtime or rest-day work have no approved HR-F02 form. Policy requires approval before the work.` });
  const nIns = E.filter(e => e.insured !== false && !(e.docs?.si && e.docs.si.st === 'ok')).length;
  if (nIns) out.push({ level: 'info', view: 'docs', text: `${nIns} insured employee${nIns > 1 ? 's have' : ' has'} no social insurance registration recorded in Documents.` });
  return { list: out, unrec };
}

/* ---------- the month view (one call per screen refresh) ---------- */
async function state(month, ctx, { withHistory = false } = {}) {
  assertMonth(month);
  const visible = await C.visibleEmployeeIds(ctx);
  const L = await C.loadMonth(month);
  const { engine, raw } = L;
  const seePay = C.canSeePay(ctx.role);
  const isVisible = id => !visible || visible.includes(String(id));
  const employees = raw.employees.filter(e => isVisible(e._id)).map(e => C.shapeEmployee(e, ctx.role));
  const me = await C.myEmployee(ctx);
  const year = month.slice(0, 4);
  const inMonth = engine.empsIn(month).filter(e => isVisible(e.id));
  const H = engine.hols();

  // Time per employee for the month (no pay): day details and counts.
  const time = {};
  inMonth.forEach(e => {
    const r = engine.calcPay(e, month);
    const days = [];
    for (let i = 1; i <= P.daysIn(month); i++) {
      const d = engine.dayInfo(e, `${month}-${P.pad(i)}`, H);
      days.push({ date: d.date, dow: d.dow, emp: d.emp, rest: d.rest, hol: d.hol, s: d.s, in: d.in, out: d.out, n: d.n, worked: P.r2(d.worked), ot: P.r2(d.ot), otN: P.r2(d.otN), sp: P.r2(d.sp), spT: d.spT, late: d.late, inGrace: !!d.inGrace, unrec: d.unrec, present: d.present });
    }
    const a = raw.attendance.find(x => String(x.employee) === e.id && x.month === month);
    time[e.id] = { t: r.t, otHours: r.otHours, otD: r.otD, otN: r.otN, otR: r.otR, otH: r.otH, days, approval: a?.approval?.at ? a.approval : null };
  });

  const { rows, frozen, run } = seePay ? await payRows(month, L) : { rows: [], frozen: false, run: await M.HrPayrollRun.findOne({ month }).lean() };
  const status = run?.status || 'draft';
  const vis = raw.visits.filter(v => isVisible(v.employee));
  const visitsShaped = vis.map(v => {
    const vp = engine.visitParts(Object.assign({}, v, { empId: String(v.employee) }));
    return Object.assign({}, v, seePay ? { pay: { allow: vp.allow, pd: vp.pd, reimb: vp.reimb, total: vp.total } } : {}, { zone: engine.cityRate(v.city).z, gc: vp.gc });
  });
  const leave = engine
    .emps()
    .filter(e => e.status !== 'Left' && isVisible(e.id))
    .map(e => {
      let sick = 0;
      let unp = 0;
      raw.attendance
        .filter(a => String(a.employee) === e.id && a.month.slice(0, 4) === year)
        .forEach(a =>
          Object.values(a.days || {}).forEach(d => {
            if (d?.s === 'S') sick++;
            if (d?.s === 'U' || d?.s === 'A') unp++;
          })
        );
      const ent = engine.leaveEnt(e, year);
      const used = engine.leaveUsed(e.id, year);
      const pend = raw.forms.filter(f => f.ft === 'leave' && String(f.employee) === e.id && f.status === 'Pending').reduce((a, f) => a + (+f.days || 0), 0);
      return { empId: e.id, ent, used, cas: engine.casualUsed(e.id, year), sick, unp, pend, left: ent - used };
    });
  const docStatus = {};
  const trnStatus = {};
  if (C.EDIT_ROLES.includes(ctx.role) || ctx.role === 'finance') {
    engine.emps().forEach(e => {
      docStatus[e.id] = { score: engine.docScore(e), docs: Object.fromEntries(P.DOCS.map(d => [d.k, engine.docSt(e, d)])) };
      trnStatus[e.id] = Object.fromEntries(engine.cfg.req.map((rq, i) => [i, (({ s, exp }) => ({ s, exp: exp || '' }))(engine.trnStatus(e, rq))]));
    });
  }
  const full = C.EDIT_ROLES.includes(ctx.role);
  const out = {
    month, today: L.today, role: ctx.role, me: me ? String(me._id) : null, cfg: engine.cfg, cfgVersion: L.cfgVersion,
    lists: { DEPTS: P.DEPTS, EMP_STATUS: P.EMP_STATUS, EMP_TYPE: P.EMP_TYPE, PAY_METHODS: P.PAY_METHODS, DOCS: P.DOCS, STAGES: P.STAGES, PURPOSES: P.PURPOSES, VISIT_STATUS: P.VISIT_STATUS, ASSET_TYPES: P.ASSET_TYPES, EXPENSE_TYPES: P.EXPENSE_TYPES, CERT_KINDS: P.CERT_KINDS, LEAVE_TYPES: P.LEAVE_TYPES, OT_KINDS: P.OT_KINDS },
    employees,
    inMonth: inMonth.map(e => e.id),
    time,
    visits: visitsShaped,
    expenses: raw.expenses.filter(x => isVisible(x.employee)),
    forms: raw.forms.filter(f => isVisible(f.employee)),
    targets: seePay ? raw.targets.map(t => ({ empId: String(t.employee), pct: t.pct })) : [],
    adjustments: seePay ? raw.adjustments.map(a => ({ _id: String(a._id), empId: String(a.employee), label: a.label, type: a.type, amount: a.amount, taxable: a.taxable })) : [],
    trainings: full || ctx.role === 'finance' ? raw.trainings : [],
    assets: full ? await M.HrAsset.find({}).lean() : [],
    performance: full ? await M.HrPerformance.find({}).lean() : [],
    candidates: full ? await M.HrCandidate.find({}).lean() : [],
    leave,
    docStatus,
    trnStatus,
    payroll: { status, log: run?.log || [], erp: run?.erp || null, version: run?.version || 0, frozen, rows: seePay ? rows : [], issues: seePay && !frozen && status !== 'closed' ? issues(engine, month, raw.attendance).list : [] },
    history: seePay && withHistory ? await history(month, engine) : [],
    canSeePay: seePay,
  };
  return out;
}

/** Employer cost, net, overtime and site for the 12 months to `month` (prototype Reports). */
async function history(month, engine) {
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(P.mAdd(month, -i));
  const runs = await M.HrPayrollRun.find({ month: { $in: months } }).lean();
  const out = [];
  for (const m of months) {
    const run = runs.find(r => r.month === m);
    let rows;
    if (run?.status === 'closed' && run.rowsBox) rows = box.open(run.rowsBox, []);
    else if (m === month) rows = engine.empsIn(m).map(e => engine.calcPay(e, m));
    else {
      const L = await C.loadMonth(m);
      rows = L.engine.empsIn(m).map(e => L.engine.calcPay(e, m));
    }
    out.push({ month: m, net: engine.sum(rows, 'net'), cost: engine.sum(rows, 'cost'), ot: engine.sum(rows, 'otPay'), site: engine.sum(rows, 'site') + engine.sum(rows, 'reimb'), n: rows.length, closed: run?.status === 'closed' });
  }
  return out;
}

/* ---------- workflow ---------- */
function stamp(run, s, ctx, note) {
  run.log.push({ s, by: ctx.user?._id, byName: C.userName(ctx.user), at: new Date(), note: note || '' });
}

async function submit(month, body, ctx) {
  assertRole(ctx, ['md', 'hr'], 'submit payroll');
  assertMonth(month);
  const run = await runDoc(month);
  if (run.status !== 'draft') throw new ApiError(`${P.mLabel(month)} payroll is already ${run.status}.`, 409);
  const L = await C.loadMonth(month);
  const unrec = L.engine.empsIn(month).reduce((a, e) => a + L.engine.calcPay(e, month).t.unrec, 0);
  const note = C.str(body?.note, 500) || '';
  // Submit requires 0 unrecorded working days or an explicit override with a note.
  if (unrec && !(body?.override && note.length >= 3)) throw new ApiError(`${unrec} working day${unrec > 1 ? 's are' : ' is'} not recorded. Fill them, or submit with an override and a note.`, 409);
  const before = run.status;
  run.status = 'review';
  stamp(run, 'review', ctx, unrec ? `Override: ${unrec} blank days. ${note}` : note);
  await run.save();
  await audit(ctx, 'payroll_runs', month, 'submit', { status: before }, { status: 'review', unrec, note });
  return run.toObject();
}

async function approve(month, body, ctx) {
  assertRole(ctx, ['md'], 'approve payroll');
  const run = await runDoc(month);
  if (run.status !== 'review') throw new ApiError('Only a payroll under review can be approved.', 409);
  run.status = 'approved';
  stamp(run, 'approved', ctx, C.str(body?.note, 500));
  await run.save();
  await audit(ctx, 'payroll_runs', month, 'approve', { status: 'review' }, { status: 'approved' });
  return run.toObject();
}

async function sendBack(month, body, ctx) {
  assertRole(ctx, ['md', 'finance'], 'send payroll back to HR');
  const run = await runDoc(month);
  if (!['review', 'approved'].includes(run.status)) throw new ApiError('Only a payroll under review or approved can be sent back.', 409);
  const note = C.str(body?.note, 500) || '';
  if (note.length < 3) throw new ApiError('Say why it goes back to HR.', 400);
  const before = run.status;
  run.status = 'draft';
  stamp(run, 'draft', ctx, note);
  await run.save();
  await audit(ctx, 'payroll_runs', month, 'send-back', { status: before }, { status: 'draft' }, note);
  return run.toObject();
}

async function close(month, body, ctx) {
  assertRole(ctx, ['md', 'hr'], 'close payroll');
  const run = await runDoc(month);
  // A month cannot close from Draft (spec section 11, workflow tests).
  if (run.status !== 'approved') throw new ApiError('Payroll closes only after the MD has approved it.', 409);
  const L = await C.loadMonth(month);
  const rows = L.engine.freezeRows(L.engine.empsIn(month).map(e => L.engine.calcPay(e, month)));
  run.rowsBox = box.seal(rows);
  run.status = 'closed';
  run.closedAt = new Date();
  run.version = (run.version || 0) + 1;
  stamp(run, 'closed', ctx, C.str(body?.note, 500));
  await run.save();
  // Payslips generated as PDF and stored; earlier versions stay.
  const cfg = L.engine.cfg;
  for (const r of rows) {
    const buf = await pdf.payslip(r, month, { cfg, status: 'closed', emp: L.engine.empById(r.id) || {}, extras: slipExtras(L, r.id, month) });
    await M.HrPayslipFile.create({ month, employee: r.id, code: r.code, version: run.version, pdf: buf, sha256: crypto.createHash('sha256').update(buf).digest('hex'), createdBy: ctx.user?._id });
  }
  await audit(ctx, 'payroll_runs', month, 'close', { status: 'approved' }, { status: 'closed', version: run.version, employees: rows.length });
  let erp = null;
  if (cfg.erpAuto && cfg.erpUrl) erp = await postToErp(month, ctx).catch(e => ({ ok: false, error: e.message }));
  return { run: run.toObject(), erp };
}

async function reopen(month, body, ctx) {
  assertRole(ctx, ['md'], 'reopen a closed month');
  const run = await runDoc(month);
  if (run.status !== 'closed') throw new ApiError('Only a closed month can be reopened.', 409);
  const note = C.str(body?.note, 500) || '';
  if (note.length < 3) throw new ApiError('Give the reason for reopening.', 400);
  run.status = 'draft';
  run.rowsBox = null;
  stamp(run, 'reopen', ctx, note);
  await run.save();
  await audit(ctx, 'payroll_runs', month, 'reopen', { status: 'closed' }, { status: 'draft' }, note);
  return run.toObject();
}

/** Visits, claims and adjustments listed on a payslip. */
function slipExtras(L, empId, month) {
  const e = L.engine;
  return {
    visits: e.visitsOf(empId, month).map(v => Object.assign({ v }, e.visitParts(v))),
    expenses: e.expOf(empId, month),
    adjustments: L.raw.adjustments.filter(a => String(a.employee) === String(empId) && a.month === month),
  };
}

/* ---------- payslips, register, journal ---------- */
async function payslipPdf(month, empId, ctx) {
  assertRole(ctx, C.PAY_ROLES, 'open payslips');
  assertMonth(month);
  const run = await M.HrPayrollRun.findOne({ month }).lean();
  if (run?.status === 'closed') {
    const f = await M.HrPayslipFile.findOne({ month, employee: empId, version: run.version }).lean();
    if (f) return { buffer: f.pdf.buffer ? Buffer.from(f.pdf.buffer) : f.pdf, name: `Payslip_${f.code}_${month}.pdf` };
  }
  const L = await C.loadMonth(month);
  const e = L.engine.empById(String(empId));
  if (!e) throw new ApiError('Employee not found.', 404);
  const r = L.engine.calcPay(e, month);
  return { buffer: await pdf.payslip(r, month, { cfg: L.engine.cfg, status: run?.status || 'draft', emp: e, extras: slipExtras(L, e.id, month) }), name: `Payslip_${e.code}_${month}_${run?.status || 'draft'}.pdf` };
}

async function registerPdf(month, ctx) {
  assertRole(ctx, C.PAY_ROLES, 'open the register');
  const { rows, run } = await payRows(month);
  const { values } = await C.settingsFor(month);
  return { buffer: await pdf.register(rows, month, { cfg: P.config(values), status: run?.status || 'draft' }), name: `Payroll_register_${month}.pdf` };
}

/** Register CSV: every section 6 figure per employee (prototype payexport). Export: MD or HR only. */
async function registerCsv(month, ctx) {
  assertRole(ctx, ['md', 'hr'], 'export the register');
  const { rows } = await payRows(month);
  const head = ['Code', 'Name', 'Department', 'Role', 'Days present', 'Unpaid days', 'Fixed pay', 'Absence deduction', 'Late deduction', 'Overtime hours', 'Overtime pay', 'Site allowances', 'Reimbursements', 'Commission', 'Additions', 'Deductions', 'Employee insurance', 'Income tax', 'Net payout', 'Employer insurance', 'Employer cost'];
  return [head].concat(rows.map(r => [r.code, r.name, r.dept, r.role, r.t.present, r.unpaidDays, P.r2(r.fixed), P.r2(r.absDed), P.r2(r.lateDed), P.r1(r.otHours), P.r2(r.otPay), P.r2(r.site), P.r2(r.reimb), P.r2(r.comm), P.r2(r.addTx + r.addNo), P.r2(r.ded), P.r2(r.insEmp), P.r2(r.tax), P.r2(r.net), P.r2(r.insEr), P.r2(r.cost)]));
}

async function journal(month, ctx) {
  assertRole(ctx, C.PAY_ROLES, 'download the journal');
  const { rows, run } = await payRows(month);
  const { values } = await C.settingsFor(month);
  const eng = P.createEngine({ cfg: values, today: C.todayCairo() });
  return eng.erpJournal(month, rows, run?.status || 'draft', new Date().toISOString());
}

async function journalCsv(month, ctx) {
  const j = await journal(month, ctx);
  return [['Company', 'Period', 'Account', 'Debit', 'Credit', 'Memo']].concat(j.lines.map(l => [l.co, l.period, l.account, l.debit, l.credit, l.memo]));
}

/**
 * ERP post (spec section 9): only from an approved or closed run; one post per run version unless
 * reopened; the ERP must answer 2xx with its journal reference, which is stored. Bearer token from
 * HR_ERP_API_TOKEN (never stored in the database).
 */
async function postToErp(month, ctx) {
  assertRole(ctx, C.PAY_ROLES, 'post to the ERP');
  const run = await runDoc(month);
  if (!['approved', 'closed'].includes(run.status)) throw new ApiError('Post to the ERP once the MD has approved the month.', 409);
  if (run.erp?.ok && run.erp.version === run.version) throw new ApiError(`Already posted (ERP reference ${run.erp.reference}). Reopen the month to post again.`, 409);
  const { values } = await C.settingsFor(month);
  const cfg = P.config(values);
  if (!cfg.erpUrl) throw new ApiError('Set the ERP endpoint on the ERP link page first.', 400);
  // https only; HR_ERP_ALLOW_INSECURE=1 exists for local tests against a stand-in ERP.
  if (!/^https:\/\//.test(cfg.erpUrl) && process.env.HR_ERP_ALLOW_INSECURE !== '1') throw new ApiError('The ERP endpoint must start with https://', 400);
  const payload = await journal(month, { ...ctx, role: 'md' });
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.HR_ERP_API_TOKEN) headers.Authorization = `Bearer ${process.env.HR_ERP_API_TOKEN}`;
  const erp = { at: new Date(), by: ctx.user?._id, byName: C.userName(ctx.user), attempts: (run.erp?.attempts || 0) + 1, version: run.version };
  try {
    const res = await fetch(cfg.erpUrl, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
    erp.status = res.status;
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const reference = body && (body.reference || body.journal_reference || body.journalReference || body.ref || body.id);
    erp.ok = res.ok && !!reference;
    erp.reference = reference ? String(reference).slice(0, 120) : '';
    erp.error = res.ok ? (reference ? '' : 'The ERP answered without a journal reference.') : `The ERP answered ${res.status}.`;
  } catch (e) {
    erp.ok = false;
    erp.error = `The ERP could not be reached: ${e.message}`.slice(0, 300);
  }
  run.erp = erp;
  run.markModified('erp');
  await run.save();
  await audit(ctx, 'payroll_runs', month, 'erp-post', null, { ok: erp.ok, status: erp.status, reference: erp.reference, error: erp.error });
  return erp;
}

/* ---------- email ---------- */
function mailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({ host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD } });
}

/**
 * One message per employee with the payslip PDF attached, subject "Reservia payslip, <month>",
 * logged with its delivery status. Only a closed month (its stored PDFs) is emailed.
 */
async function emailPayslips(month, empIds, ctx) {
  assertRole(ctx, ['md', 'hr'], 'email payslips');
  const run = await M.HrPayrollRun.findOne({ month }).lean();
  if (run?.status !== 'closed') throw new ApiError('Close the month first: payslips are emailed from the stored, closed versions.', 409);
  const transport = mailer();
  if (!transport) throw new ApiError('Email is not configured on the server (SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD).', 503);
  const from = process.env.HR_MAIL_FROM || `${process.env.SMTP_NAME || 'Reservia HR'} <${process.env.SMTP_USERNAME}>`;
  const files = await M.HrPayslipFile.find({ month, version: run.version, ...(empIds?.length ? { employee: { $in: empIds } } : {}) }).lean();
  const emps = await M.HrEmployee.find({ _id: { $in: files.map(f => f.employee) } }, { email: 1, name: 1 }).lean();
  const results = [];
  for (const f of files) {
    const e = emps.find(x => String(x._id) === String(f.employee));
    if (!e?.email) {
      results.push({ empId: String(f.employee), name: e?.name, status: 'failed', error: 'No email on file' });
      continue;
    }
    let status = 'sent';
    let error = '';
    try {
      await transport.sendMail({
        from,
        to: e.email,
        subject: `Reservia payslip, ${P.mLabel(month)}`,
        text: `Dear ${e.name},\n\nYour payslip for ${P.mLabel(month)} is attached.\n\nThis payslip is confidential. Questions to the HR officer.\n\nReservia HR`,
        attachments: [{ filename: `Payslip_${f.code}_${month}.pdf`, content: f.pdf.buffer ? Buffer.from(f.pdf.buffer) : f.pdf }],
      });
    } catch (err) {
      status = 'failed';
      error = String(err.message || err).slice(0, 300);
    }
    await M.HrEmailLog.create({ month, employee: f.employee, to: e.email, status, error, by: ctx.user?._id, byName: C.userName(ctx.user) });
    results.push({ empId: String(f.employee), name: e.name, to: e.email, status, error });
  }
  await audit(ctx, 'payroll_runs', month, 'email', null, { sent: results.filter(r => r.status === 'sent').length, failed: results.filter(r => r.status === 'failed').length });
  return results;
}

async function emailLog(month, ctx) {
  assertRole(ctx, ['md', 'hr'], 'see the email log');
  return M.HrEmailLog.find({ month }).sort({ createdAt: -1 }).limit(500).lean();
}

/* ---------- CSV exports (MD or HR only, PDPL) ---------- */
async function exportCsv(kind, month, ctx) {
  assertRole(ctx, ['md', 'hr'], 'export HR data');
  const L = await C.loadMonth(month || C.todayCairo().slice(0, 7));
  const e = L.engine;
  const current = e.emps().filter(x => x.status !== 'Left');
  const SL = { ok: 'Valid', soon: 'Due soon', exp: 'Expired', miss: 'Missing', na: 'n/a' };
  if (kind === 'personnel') return [['Employee', 'Code'].concat(P.DOCS.map(d => d.n))].concat(current.map(x => [x.name, x.code].concat(P.DOCS.map(d => SL[e.docSt(x, d)]))));
  if (kind === 'org') return [['Code', 'Name', 'Role', 'Department', 'Reports to', 'Status', 'Joined']].concat(current.map(x => [x.code, x.name, x.role, x.dept, x.mgr, x.status, x.hire]));
  if (kind === 'training')
    return [['Date', 'Employee', 'Code', 'Kind', 'Course', 'Provider', 'Hours', 'Valid until', 'Certificate on file', 'Cost']].concat(
      L.raw.trainings.map(t => {
        const emp = e.empById(String(t.employee)) || {};
        const rq = e.cfg.req.find(r => r.n === t.course);
        return [t.date, emp.name || '(removed)', emp.code || '', t.kind || 'Training course', t.course, t.provider, t.hours || '', t.exp || (rq && rq.m ? P.addMonthsTo(t.date, +rq.m) : ''), t.cert ? 'Yes' : 'No', t.cost || ''];
      })
    );
  if (kind === 'leave') {
    const year = (month || C.todayCairo()).slice(0, 4);
    return [['Employee', 'Code', 'Entitlement', 'Taken', 'Casual', 'Remaining']].concat(current.map(x => [x.name, x.code, e.leaveEnt(x, year), e.leaveUsed(x.id, year), e.casualUsed(x.id, year), e.leaveEnt(x, year) - e.leaveUsed(x.id, year)]));
  }
  throw new ApiError('Unknown export.', 404);
}

async function auditLog(query, ctx) {
  assertRole(ctx, ['md', 'hr'], 'read the audit log');
  const q = {};
  if (query.table) q.table = String(query.table);
  if (query.rowId) q.rowId = String(query.rowId);
  const rows = await M.HrAudit.find(q).sort({ at: -1 }).limit(Math.min(500, +query.limit || 200)).lean();
  // Pay inside audit entries stays sealed: the log says that pay changed, never the figures.
  return rows.map(r => ({ ...r, before: hidePay(r.before), after: hidePay(r.after) }));
}
function hidePay(x) {
  if (!x || typeof x !== 'object') return x;
  const o = Object.assign({}, x);
  if (o.pay) o.pay = 'changed (sealed)';
  if (o.values?.brackets) o.values = { ...o.values };
  return o;
}

module.exports = { state, payRows, submit, approve, sendBack, close, reopen, payslipPdf, registerPdf, registerCsv, journal, journalCsv, postToErp, emailPayslips, emailLog, exportCsv, auditLog };
