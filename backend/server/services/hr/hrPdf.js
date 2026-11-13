'use strict';

// Reservia HR Portal - PDFs on the Reservia letterhead (HR Portal Developer Spec section 8):
// payslip, payroll register, HR forms HR-F01 to HR-F06 and the belongings sheet. Server-side render
// with pdfkit, the same letterhead elements as the Deal Engine proposal (logo, company block, navy and
// amber rules, slogan footer). Content follows the prototype's slipHtml / registerHtml / sheetHtml.
//
// Rounding (spec section 6): whole EGP on payslips; on the register each displayed line is rounded
// first and the totals are the sums of the displayed lines.

const path = require('path');
const PDFDocument = require('pdfkit');
const P = require('./payrollEngine');

const LOGO = path.join(__dirname, '..', '..', 'assets', 'reservia-logo-full.png');
const NAVY = '#0E3346';
const AMBER = '#F0A500';
const GREY = '#5b6670';
const LINE = '#c9d3d9';
const COMPANY = {
  name: 'Reservia Integrated Energy Solutions LLC',
  registry: 'Commercial Register No. 314505, Cairo Investment Registry',
  website: 'www.reservia-energy.com',
  slogan: 'GENERATE | STORE | OPTIMIZE | SUSTAIN',
  address: 'Elite Tower, Unit M-19-3, 3rd floor, Zahraa El Maadi entrance, Maadi, Cairo',
  phones: '+20 121 189 2995 | +20 2 2522 2814',
  mailbox: 'Reservia_HR@reservia-energy.com',
};
const W = n => Math.round(n || 0); // whole EGP
const fmt = n => W(n).toLocaleString('en-US');

function render(build, { landscape = false, title } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margins: { top: 130, bottom: 70, left: 40, right: 40 }, bufferPages: true, info: { Title: title, Author: COMPANY.name } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        frame(doc, i + 1, range.count);
      }
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function frame(doc, pageNo, pages) {
  const left = 40;
  const width = doc.page.width - 80;
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0; // write the footer inside the margin without adding a page
  try {
    doc.image(LOGO, left, 24, { height: 66 });
  } catch {
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(20).text('Reservia', left, 46);
  }
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(COMPANY.name, left, 48, { width, align: 'right' });
  doc.fillColor(GREY).font('Helvetica').fontSize(8).text(COMPANY.registry, left, 62, { width, align: 'right' });
  doc.fillColor('#1F6F8B').fontSize(8).text(COMPANY.website, left, 73, { width, align: 'right' });
  doc.rect(left, 100, width, 4).fill(NAVY);
  doc.rect(left, 104, width, 2).fill(AMBER);
  const fy = doc.page.height - 56;
  doc.lineWidth(0.8).strokeColor(AMBER).moveTo(left, fy).lineTo(left + width, fy).stroke();
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8).text(COMPANY.slogan, left, fy + 6, { width, align: 'center', lineBreak: false });
  doc.fillColor(GREY).font('Helvetica').fontSize(7).text(`${COMPANY.address} | ${COMPANY.phones} | ${COMPANY.mailbox}`, left, fy + 18, { width, align: 'center', lineBreak: false });
  doc.text(`Internal, confidential | Page ${pageNo} of ${pages}`, left, fy + 29, { width, align: 'center', lineBreak: false });
  doc.page.margins.bottom = bottom;
}

function watermark(doc, text) {
  doc.save();
  doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.fillColor('#c0392b').opacity(0.1).font('Helvetica-Bold').fontSize(60).text(text, 0, doc.page.height / 2 - 30, { width: doc.page.width, align: 'center' });
  doc.restore();
  doc.opacity(1);
}

/** Two-column statement rows (label | amount) with section and total styles. */
function statement(doc, rows) {
  const left = 40;
  const width = doc.page.width - 80;
  rows.forEach(([label, value, kind]) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    const y = doc.y;
    const h = kind === 'net' ? 22 : 17;
    if (kind === 'sec' || kind === 'net') doc.rect(left, y, width, h).fill('#eef3f6');
    const font = kind === 'sec' || kind === 'tot' || kind === 'net' ? 'Helvetica-Bold' : 'Helvetica';
    doc.fillColor(kind === 'sec' ? NAVY : '#10243a').font(font).fontSize(kind === 'net' ? 12 : 9.5);
    doc.text(label, left + 6, y + 4, { width: width - 140, lineBreak: false, ellipsis: true });
    if (value !== '') doc.text(value, left + width - 130, y + 4, { width: 124, align: 'right', lineBreak: false });
    if (kind === 'tot' || kind === 'net') doc.lineWidth(kind === 'net' ? 1.2 : 0.8).strokeColor(NAVY).moveTo(left, y).lineTo(left + width, y).stroke();
    doc.lineWidth(0.4).strokeColor('#e3e8ec').moveTo(left, y + h).lineTo(left + width, y + h).stroke();
    doc.y = y + h;
  });
}

function signatures(doc, labels) {
  const left = 40;
  const width = doc.page.width - 80;
  if (doc.y > doc.page.height - 150) doc.addPage();
  const y = doc.y + 34;
  const w = (width - (labels.length - 1) * 20) / labels.length;
  labels.forEach((l, i) => {
    const x = left + i * (w + 20);
    doc.lineWidth(0.8).strokeColor(NAVY).moveTo(x, y).lineTo(x + w, y).stroke();
    doc.fillColor(GREY).font('Helvetica').fontSize(8.5).text(l, x, y + 4, { width: w });
  });
  doc.y = y + 30;
}

/* ---------- payslip ---------- */
function slipRows(r, m, cfg, extras) {
  const R = [];
  const dim = P.daysIn(m);
  R.push(['Earnings', '', 'sec']);
  R.push([`Basic gross salary${r.t.emp < dim ? ` (part month, ${r.t.emp} of ${dim} days)` : ''}`, fmt(r.basic)]);
  R.push(['Transportation allowance', fmt(r.transport)]);
  if (r.incentive) R.push(['Incentive monthly payout', fmt(r.incentive)]);
  if (r.other) R.push(['Other fixed allowances', fmt(r.other)]);
  if (r.comm) R.push([`Performance commission, target achieved ${r.tgt}%`, fmt(r.comm)]);
  const ot = (h, mult, label) => h && R.push([`${label}: ${P.r1(h)} h x ${P.r2(r.hr * mult)}`, fmt(r.hr * h * mult)]);
  ot(r.otD, cfg.otDay, 'Overtime, day');
  ot(r.otN, cfg.otNight, 'Overtime, night');
  ot(r.otF, cfg.otFri, 'Friday work');
  ot(r.otS, cfg.otSat, 'Saturday work');
  ot(r.otH, cfg.otHol, 'Public holiday work');
  (extras.visits || []).forEach(vp => {
    const v = vp.v;
    R.push([`Site visit ${v.date}, ${v.city} (${v.days || 1} d, ${v.nights || 0} n): allowance${vp.pd ? ' and per diem' : ''}`, fmt(vp.allow + vp.pd)]);
    if (vp.tr) R.push(['   Transport reimbursed', fmt(vp.tr)]);
    if (vp.ac) R.push(['   Accommodation reimbursed', fmt(vp.ac)]);
    if (vp.ml) R.push(['   Meals reimbursed', fmt(vp.ml)]);
  });
  (extras.expenses || []).forEach(x => R.push([`Expense claim ${x.date}: ${x.type}`, fmt(x.amount)]));
  (extras.adjustments || []).filter(a => a.type === 'add').forEach(a => R.push([`${a.label}${a.taxable ? '' : ' (not taxed)'}`, fmt(a.amount)]));
  R.push(['Total earnings', fmt(r.earn), 'tot']);
  R.push(['Deductions', '', 'sec']);
  if (r.absDed) R.push([`Absence: ${r.unpaidDays} unpaid day${r.unpaidDays > 1 ? 's' : ''}`, `-${fmt(r.absDed)}`]);
  if (r.lateDed) R.push([`Late arrival: ${r.t.late} minutes`, `-${fmt(r.lateDed)}`]);
  (extras.adjustments || []).filter(a => a.type !== 'add').forEach(a => R.push([a.label, `-${fmt(a.amount)}`]));
  R.push([`Social insurance, employee share ${cfg.insEmp}% on ${fmt(r.insBase)}`, `-${fmt(r.insEmp)}`]);
  R.push(['Income tax', `-${fmt(r.tax)}`]);
  R.push(['Net pay (EGP)', fmt(r.net), 'net']);
  return R;
}

function payslip(r, m, { cfg, status, emp = {}, extras = {} }) {
  return render(
    doc => {
      if (status !== 'closed') watermark(doc, `DRAFT - ${String(status).toUpperCase()}`);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(`Payslip: ${P.mLabel(m)}`, 40, 122);
      doc.moveDown(0.4);
      const meta = [
        [`${r.name} | ${r.code}`, `Status: ${status}`],
        [`${r.role || ''}, ${r.dept || ''}`, `Payment: ${emp.paym || 'Bank transfer'}`],
        [`Joined ${emp.hire || ''}`, `Days present ${r.t.present} | leave ${r.t.leave} | sick ${r.t.sick} | overtime ${P.r1(r.otHours)} h`],
      ];
      doc.font('Helvetica').fontSize(9).fillColor('#10243a');
      meta.forEach(([a, b]) => {
        const y = doc.y;
        doc.text(a, 40, y, { width: 250 });
        doc.text(b, 300, y, { width: doc.page.width - 340 });
        doc.y = Math.max(doc.y, y + 13);
      });
      doc.moveDown(0.6);
      statement(doc, slipRows(r, m, cfg, extras));
      signatures(doc, [`Prepared by HR: ${cfg.hrName}`, `Approved: ${cfg.mdName}, Managing Director`, 'Received by employee']);
      doc.fillColor(GREY).font('Helvetica').fontSize(8).text(`Employer social insurance contribution this month: ${fmt(r.insEr)} EGP (not deducted from pay). Generated ${new Date().toISOString().slice(0, 10)}.`, 40, doc.y, { width: doc.page.width - 80 });
    },
    { title: `Payslip ${r.code} ${m}` }
  );
}

/* ---------- register ---------- */
const REG_COLS = [
  ['Code', 52, r => r.code],
  ['Name', 118, r => r.name],
  ['Dept', 62, r => r.dept],
  ['Fixed', 58, r => W(r.fixed), 1],
  ['Comm.', 50, r => W(r.comm), 1],
  ['OT', 46, r => W(r.otPay), 1],
  ['Site', 46, r => W(r.site), 1],
  ['Reimb.', 48, r => W(r.reimb), 1],
  ['Adj.', 46, r => W(r.addTx + r.addNo - r.ded), 1],
  ['Absence', 52, r => -W(r.absDed + r.lateDed), 1],
  ['Ins.', 46, r => -W(r.insEmp), 1],
  ['Tax', 46, r => -W(r.tax), 1],
  ['Net', 58, r => W(r.net), 1],
  ['Er. ins.', 50, r => W(r.insEr), 1],
];

/** Register lines as displayed (whole EGP) and totals as the sums of the displayed lines. */
function registerTable(rows) {
  const lines = rows.map(r => REG_COLS.map(c => c[2](r)));
  const totals = REG_COLS.map((c, i) => (c[3] ? lines.reduce((a, l) => a + l[i], 0) : i === 0 ? 'Total' : ''));
  return { lines, totals };
}

function register(rows, m, { cfg, status }) {
  return render(
    doc => {
      if (status !== 'closed') watermark(doc, `DRAFT - ${String(status).toUpperCase()}`);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15).text(`Payroll register: ${P.mLabel(m)}`, 40, 120, { continued: true }).font('Helvetica').fontSize(10).fillColor(GREY).text(`   status ${status}`);
      doc.moveDown(0.5);
      const { lines, totals } = registerTable(rows);
      const x0 = 40;
      const drawRow = (cells, { head = false, foot = false } = {}) => {
        if (doc.y > doc.page.height - 110) doc.addPage();
        const y = doc.y;
        if (head || foot) doc.rect(x0, y, REG_COLS.reduce((a, c) => a + c[1], 0), 16).fill('#eef3f6');
        let x = x0;
        doc.font(head || foot ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.8).fillColor('#10243a');
        cells.forEach((v, i) => {
          const c = REG_COLS[i];
          const txt = typeof v === 'number' ? v.toLocaleString('en-US') : String(v ?? '');
          doc.text(txt, x + 3, y + 4, { width: c[1] - 6, align: c[3] && !head ? 'right' : 'left', lineBreak: false, ellipsis: true });
          doc.lineWidth(0.4).strokeColor(LINE).rect(x, y, c[1], 16).stroke();
          x += c[1];
        });
        doc.y = y + 16;
      };
      drawRow(REG_COLS.map(c => c[0]), { head: true });
      lines.forEach(l => drawRow(l));
      drawRow(totals, { foot: true });
      signatures(doc, [`Prepared by HR: ${cfg.hrName}`, 'Reviewed: Finance', `Approved: ${cfg.mdName}, Managing Director`]);
    },
    { landscape: true, title: `Payroll register ${m}` }
  );
}

/* ---------- forms and belongings sheet ---------- */
const FORM_TITLES = {
  leave: ['HR-F01', 'Leave request', ['Employee', 'Line manager', 'HR']],
  ot: ['HR-F02', 'Overtime and rest-day approval', ['Employee', 'Line manager', 'HR']],
  visit: ['HR-F03', 'Site visit request', ['Employee', 'Line manager', 'HR']],
  report: ['HR-F04', 'Site visit report', ['Employee', 'Line manager']],
  hire: ['HR-F05', 'New hire checklist', ['Employee', 'HR', 'MD']],
  exit: ['HR-F06', 'Exit clearance', ['Employee', 'Line manager', 'IT', 'Finance', 'HR']],
  belongings: ['HR-BS', 'Belongings sheet', ['Employee', 'IT / Admin', 'HR']],
};
const EXIT_STEPS = [
  ['Written notice received (3 months, open-ended contract)', 'Employee or HR'], ['Handover plan: projects, bids, drawings, client contacts, passwords', 'Line manager'],
  ['Handover note and file index signed', 'Employee and successor'], ['Exit interview form completed', 'HR'],
  ['Assets returned: laptop, phone, ID, keys, PPE, vehicle, SIM, site cards', 'Employee and IT'], ['Email, ERP, CRM and shared drive access closed', 'IT'],
  ['Clearance signed by line manager, IT, finance and HR', 'HR'], ['Final settlement: salary, unused leave at daily wage, overtime, allowances, less advances', 'Finance'],
  ['Exit form sent to the Social Insurance Authority', 'HR'], ['Experience certificate issued (within 15 days of request)', 'HR'],
  ['NDA reminder letter sent', 'HR'], ['Employee file closed and kept 5 years', 'HR'],
];

function kvTable(doc, rows) {
  const left = 40;
  const width = doc.page.width - 80;
  rows.forEach(([k, v]) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    const y = doc.y;
    const h = Math.max(22, doc.heightOfString(String(v || ' '), { width: width * 0.66 - 12 }) + 10);
    doc.rect(left, y, width * 0.34, h).fillAndStroke('#eef3f8', LINE);
    doc.rect(left + width * 0.34, y, width * 0.66, h).stroke(LINE);
    doc.fillColor('#10243a').font('Helvetica-Bold').fontSize(9).text(k, left + 6, y + 6, { width: width * 0.34 - 12 });
    doc.font('Helvetica').text(String(v || ''), left + width * 0.34 + 6, y + 6, { width: width * 0.66 - 12 });
    doc.y = y + h;
  });
}

function listTable(doc, head, rows, widths) {
  const left = 40;
  const total = doc.page.width - 80;
  const ws = widths.map(w => w * total);
  const draw = (cells, bold) => {
    const hs = cells.map((c, i) => doc.heightOfString(String(c ?? ''), { width: ws[i] - 10 }));
    const h = Math.max(18, Math.max(...hs) + 8);
    if (doc.y + h > doc.page.height - 100) doc.addPage();
    const y = doc.y;
    let x = left;
    cells.forEach((c, i) => {
      if (bold) doc.rect(x, y, ws[i], h).fillAndStroke('#eef3f8', LINE);
      else doc.rect(x, y, ws[i], h).stroke(LINE);
      doc.fillColor('#10243a').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).text(String(c ?? ''), x + 5, y + 4, { width: ws[i] - 10 });
      x += ws[i];
    });
    doc.y = y + h;
  };
  draw(head, true);
  rows.forEach(r => draw(r, false));
}

/**
 * A form sheet. `f` holds the form fields (prototype names); `emp` the employee; `blank` prints an
 * empty copy. For hire: `docRows` [[name, status, kept at]]. For belongings: `assets`.
 */
function formSheet(ft, { f = {}, emp = null, blank = false, cfg = {}, docRows = [], assets = [], leaveUsed = '' }) {
  const T = FORM_TITLES[ft];
  if (!T) throw new Error('Unknown form');
  return render(
    doc => {
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(T[1], 40, 122, { continued: true }).font('Helvetica').fontSize(10).fillColor(GREY).text(`   ${T[0]}`);
      doc.moveDown(0.6);
      const b = v => (blank ? '' : v ?? '');
      const head = [['Employee', emp ? emp.name : ''], ['Employee code', emp ? emp.code : ''], ['Role and department', emp ? `${emp.role || ''}, ${emp.dept || ''}` : '']];
      let rows = [];
      if (ft === 'leave') rows = head.concat([['Type of leave', b(f.ltype)], ['First day', b(f.from)], ['Last day', b(f.to)], ['Working days', b(f.days)], ['Who covers my work', b(f.cover)], ['Phone during leave', b(f.phone)], ['Reason or note', b(f.reason)], [`Annual leave used this year (of ${cfg.annualDays || 21})`, b(leaveUsed)]]);
      if (ft === 'ot') rows = head.concat([['Date of the work', b(f.odate)], ['Type of work', b(f.kind)], ['Planned start and end', blank ? '' : `${f.from || ''} to ${f.to || ''}`], ['Hours beyond the normal day', b(f.hours)], ['Project or site', b(f.site)], ['Why the work cannot wait', b(f.reason)], ['Substitute rest day (Friday work)', '']]);
      if (ft === 'visit') rows = head.concat([['First day', b(f.from)], ['City', b(f.city)], ['Client or site', b(f.site)], ['Purpose', b(f.purpose)], ['Days on site and nights away', blank ? '' : `${f.days || 1} days, ${f.nights || 0} nights`], ['Expected return', b(f.back)], ['Transport', b(f.transport)], ['Accommodation', b(f.stay)], ['Meals', b(f.meals)], ['CRM lead or project reference', b(f.ref)], ['Objective of the visit', b(f.reason)], ['HSE induction and PPE issued', 'Yes / No']]);
      if (ft === 'report') rows = [['Employee', b(emp?.name)], ['Date and site', blank ? '' : `${f.date || ''}, ${f.site || ''}`], ['Work done', b(f.report)], ['Findings and measurements', ''], ['Photos taken (count and location)', ''], ['Issues, risks or safety events', ''], ['Next steps and owner', ''], ['Submitted (within 24 hours of return)', '']];
      if (ft === 'hire') rows = head.concat([['Start date', emp ? emp.hire : '']]);
      if (ft === 'exit') rows = head.concat([['Reason', b(f.reason)], ['Last working day', b(f.last)]]);
      if (ft === 'belongings') rows = head.concat([['Date', new Date().toISOString().slice(0, 10)]]);
      kvTable(doc, rows);
      if (ft === 'hire') {
        doc.moveDown(0.6);
        listTable(doc, ['Document', 'Status', 'Kept at'], docRows.map(r => (blank ? [r[0], '[ ]', ''] : r)), [0.5, 0.2, 0.3]);
      }
      if (ft === 'exit') {
        doc.moveDown(0.6);
        listTable(doc, ['#', 'Step', 'Owner', 'Done'], EXIT_STEPS.map((s, i) => [i + 1, s[0], s[1], !blank && f.steps && f.steps[i] ? 'Yes' : '[ ]']), [0.06, 0.6, 0.22, 0.12]);
      }
      if (ft === 'belongings') {
        doc.moveDown(0.6);
        listTable(doc, ['Item', 'Description', 'Serial or number', 'Issued', 'Returned', 'Condition'], assets.length ? assets.map(a => [a.type, a.desc, a.serial, a.issued, a.returned || '', a.cond]) : [['', '', '', '', '', '']], [0.14, 0.28, 0.18, 0.13, 0.13, 0.14]);
      }
      if (!blank && f.status && ['leave', 'ot', 'visit'].includes(ft)) {
        doc.moveDown(0.6);
        doc.fillColor('#10243a').font('Helvetica').fontSize(9.5).text(`Decision: ${f.status}${f.by ? ` by ${f.by}` : ''}${f.decided ? ` on ${String(f.decided).slice(0, 10)}` : ''}${f.dnote ? `. ${f.dnote}` : ''}`, 40, doc.y, { width: doc.page.width - 80 });
      }
      signatures(doc, T[2].map(s => `${s}: name, signature, date`));
      doc.fillColor(GREY).font('Helvetica').fontSize(7.5).text(`Form ${T[0]} | HR Policy: Attendance, Overtime, Travel and Leave | Printed ${new Date().toISOString().slice(0, 10)}`, 40, doc.y + 6, { width: doc.page.width - 80 });
    },
    { title: `${T[0]} ${T[1]}` }
  );
}

module.exports = { payslip, register, registerTable, formSheet, slipRows, FORM_TITLES, EXIT_STEPS };
