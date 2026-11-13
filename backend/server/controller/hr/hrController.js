const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const svc = require('../../services/hr/hrService');
const pay = require('../../services/hr/hrPayrollService');
const C = require('../../services/hr/hrCore');
const pdf = require('../../services/hr/hrPdf');
const P = require('../../services/hr/payrollEngine');
const M = require('../../models/hr/hrModels');

// Reservia HR Portal - thin HTTP layer. Role checks live in the services, from req.hrRole (the
// DB-loaded HR membership, middleware/hrAccess.js); nothing here trusts the client for permissions.

const ctx = req => ({ user: req.user, role: req.hrRole });
const ok = (res, msg, data, code = 200) => res.status(code).json(apiResponse(msg, true, data));
const month = req => C.assertMonth(req.params.month || req.query.month || C.todayCairo().slice(0, 7));

const csvq = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function sendCsv(res, name, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(`﻿${rows.map(r => r.map(csvq).join(',')).join('\n')}`);
}
function sendPdf(res, { buffer, name }) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
}

exports.state = asyncHandler(async (req, res) => ok(res, 'HR month', await pay.state(month(req), ctx(req), { withHistory: req.query.history === '1' })));

exports.saveSettings = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const doc = await C.saveSettings(b.values || {}, b.effectiveMonth || C.todayCairo().slice(0, 7), ctx(req), b.note);
  ok(res, 'Settings saved', { effectiveMonth: doc.effectiveMonth });
});
exports.settingsHistory = asyncHandler(async (req, res) => {
  C.assertRole(ctx(req), ['md', 'hr', 'finance'], 'see the settings history');
  ok(res, 'Settings history', await M.HrSettings.find({}, { values: 0 }).sort({ createdAt: -1 }).limit(100).lean());
});

/** Portal logins with an active HR membership (to link a line manager to their employee record). MD and HR only. */
exports.logins = asyncHandler(async (req, res) => {
  C.assertRole(ctx(req), ['md', 'hr'], 'list HR logins');
  const users = await require('mongoose').model('User').find({ systemMemberships: { $elemMatch: { system: 'HR', isActive: true } } }, { name: 1, email: 1, systemMemberships: 1 }).lean();
  ok(res, 'HR logins', users.map(u => ({ _id: String(u._id), name: u.name, email: u.email, role: (u.systemMemberships.find(m => m.system === 'HR') || {}).role })));
});

exports.createEmployee = asyncHandler(async (req, res) => ok(res, 'Employee added', await svc.createEmployee(req.body || {}, ctx(req)), 201));
exports.updateEmployee = asyncHandler(async (req, res) => ok(res, 'Employee saved', await svc.updateEmployee(req.params.id, req.body || {}, ctx(req))));
exports.deleteEmployee = asyncHandler(async (req, res) => ok(res, 'Employee deleted', await svc.deleteEmployee(req.params.id, ctx(req))));
exports.saveDocument = asyncHandler(async (req, res) => ok(res, 'Document saved', await svc.saveDocument(req.params.id, req.params.k, req.body || {}, ctx(req))));
exports.saveExit = asyncHandler(async (req, res) => ok(res, 'Exit checklist saved', await svc.saveExit(req.params.id, req.body || {}, ctx(req))));

exports.saveDay = asyncHandler(async (req, res) => ok(res, 'Day saved', await svc.saveDay(req.body?.date, req.body?.rows, ctx(req))));
exports.saveDays = asyncHandler(async (req, res) => ok(res, 'Timesheet saved', (await svc.saveTimesheetDays(req.params.empId, req.params.month, req.body?.days, ctx(req))) && true));
exports.fillBlanks = asyncHandler(async (req, res) => ok(res, 'Blank working days marked present', await svc.fillBlanks(req.params.empId, req.params.month, ctx(req))));
exports.approveTimesheet = asyncHandler(async (req, res) => ok(res, 'Timesheet approved', await svc.approveTimesheet(req.params.empId, req.params.month, ctx(req))));
exports.reopenTimesheet = asyncHandler(async (req, res) => ok(res, 'Timesheet reopened', await svc.reopenTimesheet(req.params.empId, req.params.month, ctx(req))));

exports.saveVisit = asyncHandler(async (req, res) => ok(res, 'Visit saved', await svc.saveVisit(req.params.id, req.body || {}, ctx(req))));
exports.deleteVisit = asyncHandler(async (req, res) => ok(res, 'Visit deleted', await svc.deleteVisit(req.params.id, ctx(req))));
exports.saveExpense = asyncHandler(async (req, res) => ok(res, 'Claim saved', await svc.saveExpense(req.params.id, req.body || {}, ctx(req))));
exports.decideExpense = asyncHandler(async (req, res) => ok(res, 'Claim decided', await svc.decideExpense(req.params.id, req.body || {}, ctx(req))));
exports.deleteExpense = asyncHandler(async (req, res) => ok(res, 'Claim deleted', await svc.deleteExpense(req.params.id, ctx(req))));
exports.saveForm = asyncHandler(async (req, res) => ok(res, 'Form saved', await svc.saveForm(req.params.id, req.body || {}, ctx(req))));
exports.decideForm = asyncHandler(async (req, res) => ok(res, 'Form decided', await svc.decideForm(req.params.id, req.body || {}, ctx(req))));
exports.deleteForm = asyncHandler(async (req, res) => ok(res, 'Form deleted', await svc.deleteForm(req.params.id, ctx(req))));
exports.setTarget = asyncHandler(async (req, res) => ok(res, 'Target saved', await svc.setTarget(req.params.empId, req.params.month, req.body?.pct, ctx(req))));
exports.addAdjustment = asyncHandler(async (req, res) => ok(res, 'Adjustment added', await svc.addAdjustment(req.body?.empId, req.body?.month, req.body || {}, ctx(req)), 201));
exports.deleteAdjustment = asyncHandler(async (req, res) => ok(res, 'Adjustment removed', await svc.deleteAdjustment(req.params.id, ctx(req))));
exports.saveRecord = asyncHandler(async (req, res) => ok(res, 'Saved', await svc.saveSimple(req.params.kind, req.params.id, req.body || {}, ctx(req))));
exports.deleteRecord = asyncHandler(async (req, res) => ok(res, 'Deleted', await svc.deleteSimple(req.params.kind, req.params.id, ctx(req))));
exports.hireCandidate = asyncHandler(async (req, res) => ok(res, 'Employee record created. Complete the pay details.', await svc.hireCandidate(req.params.id, ctx(req)), 201));
exports.loadExample = asyncHandler(async (req, res) => ok(res, 'Example team loaded', await svc.loadExampleTeam(ctx(req)), 201));
exports.removeExample = asyncHandler(async (req, res) => ok(res, 'Example data removed', await svc.removeExampleTeam(ctx(req))));

const flow = fn => asyncHandler(async (req, res) => ok(res, 'Payroll updated', await fn(month(req), req.body || {}, ctx(req))));
exports.submit = flow(pay.submit);
exports.approve = flow(pay.approve);
exports.sendBack = flow(pay.sendBack);
exports.close = flow(pay.close);
exports.reopen = flow(pay.reopen);
exports.postErp = asyncHandler(async (req, res) => ok(res, 'ERP post attempted', await pay.postToErp(month(req), ctx(req))));
exports.email = asyncHandler(async (req, res) => ok(res, 'Payslip emails sent', await pay.emailPayslips(month(req), (req.body?.empIds || []).map(svc.oid), ctx(req))));
exports.emailLog = asyncHandler(async (req, res) => ok(res, 'Email log', await pay.emailLog(month(req), ctx(req))));
exports.payslipPdf = asyncHandler(async (req, res) => sendPdf(res, await pay.payslipPdf(month(req), svc.oid(req.params.empId), ctx(req))));
exports.registerPdf = asyncHandler(async (req, res) => sendPdf(res, await pay.registerPdf(month(req), ctx(req))));
exports.registerCsv = asyncHandler(async (req, res) => sendCsv(res, `reservia_payroll_${month(req)}.csv`, await pay.registerCsv(month(req), ctx(req))));
exports.journalJson = asyncHandler(async (req, res) => {
  const j = await pay.journal(month(req), ctx(req));
  res.setHeader('Content-Disposition', `attachment; filename="reservia_payroll_journal_${month(req)}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  res.json(j);
});
exports.journalCsv = asyncHandler(async (req, res) => sendCsv(res, `reservia_payroll_journal_${month(req)}.csv`, await pay.journalCsv(month(req), ctx(req))));
exports.exportCsv = asyncHandler(async (req, res) => sendCsv(res, `reservia_${req.params.kind}_${C.todayCairo()}.csv`, await pay.exportCsv(req.params.kind, req.query.month, ctx(req))));
exports.audit = asyncHandler(async (req, res) => ok(res, 'Audit log', await pay.auditLog(req.query || {}, ctx(req))));

/** Forms HR-F01 to F06 and the belongings sheet as PDF: by form id, visit id (F04) or employee (F05, F06, belongings); `blank=1` for an empty copy. */
exports.formPdf = asyncHandler(async (req, res) => {
  const c = ctx(req);
  const ft = req.params.ft;
  if (!pdf.FORM_TITLES[ft]) throw new ApiError('Unknown form.', 404);
  const blank = req.query.blank === '1';
  const L = await C.loadMonth(C.todayCairo().slice(0, 7));
  const cfg = L.engine.cfg;
  let f = {};
  let empId = req.query.empId || null;
  if (!blank && ['leave', 'ot', 'visit'].includes(ft) && req.query.id) {
    f = await M.HrForm.findById(svc.oid(req.query.id)).lean();
    if (!f) throw new ApiError('Form not found.', 404);
    empId = String(f.employee);
  }
  if (!blank && ft === 'report' && req.query.id) {
    const v = await M.HrVisit.findById(svc.oid(req.query.id)).lean();
    if (!v) throw new ApiError('Visit not found.', 404);
    f = v;
    empId = String(v.employee);
  }
  if (!blank && empId) await C.assertCanDecideFor(c, empId);
  else C.assertRole(c, ['md', 'hr', 'manager'], 'print forms');
  const emp = !blank && empId ? L.engine.empById(String(empId)) : null;
  if (!blank && ['hire', 'exit', 'belongings'].includes(ft) && !emp) throw new ApiError('Choose an employee.', 400);
  const raw = emp ? await M.HrEmployee.findById(emp.id).lean() : null;
  if (ft === 'exit' && raw?.exit) f = { last: raw.exit.last, reason: raw.exit.reason, steps: C.docsObj(raw.exit.steps) };
  const SL = { ok: 'Received', soon: 'Expiring', exp: 'Expired', miss: 'Missing', na: 'n/a' };
  const docRows = P.DOCS.map(d => [d.n, emp ? SL[L.engine.docSt(emp, d)] : '', emp ? emp.docs?.[d.k]?.loc || '' : '']);
  const assets = ft === 'belongings' && emp ? await M.HrAsset.find({ employee: emp.id }).lean() : [];
  const leaveUsed = ft === 'leave' && emp && f.from ? L.engine.leaveUsed(emp.id, String(f.from).slice(0, 4)) : '';
  const buffer = await pdf.formSheet(ft, { f, emp, blank, cfg, docRows, assets, leaveUsed });
  sendPdf(res, { buffer, name: `${pdf.FORM_TITLES[ft][0]}_${emp ? emp.code : 'blank'}.pdf` });
});
