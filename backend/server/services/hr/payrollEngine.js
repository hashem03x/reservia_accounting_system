'use strict';

// Reservia HR Portal - the payroll engine (HR Portal Developer Spec section 6).
//
// A line-for-line port of the reference prototype's calculation layer (Reservia_HR_Portal.html:
// dayInfo, calcPay, visitParts, taxAnnual, commPaid, leaveEnt, docSt, trnStatus, erpJournal). The
// spec makes that prototype the acceptance target ("port it with unit tests on every branch"), so
// nothing here is a policy decision of the developer: every rate is a setting (section 5) with the
// prototype's defaults, and every rule is the prototype's. test/hr/payrollEngine.test.js runs the
// prototype's own code next to this module and requires identical figures.
//
// Pure: no database, no clock. The caller passes the data for the month and `today` (YYYY-MM-DD,
// Cairo date) - "today" matters because a blank working day only counts as unrecorded once it has
// passed, and document/training expiry is measured from it.

/* ---------- date helpers (same semantics as the prototype) ---------- */
const pad = n => (n < 10 ? '0' : '') + n;
const ymd = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const r1 = n => Math.round((n || 0) * 10) / 10;
const r2 = n => Math.round((n || 0) * 100) / 100;
const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function daysIn(m) {
  const p = m.split('-');
  return new Date(+p[0], +p[1], 0).getDate();
}
function mLabel(m) {
  const p = m.split('-');
  return `${MN[+p[1] - 1]} ${p[0]}`;
}
function mAdd(m, k) {
  const p = m.split('-');
  const d = new Date(+p[0], +p[1] - 1 + k, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function dAdd(s, k) {
  const d = new Date(`${s}T00:00:00`);
  d.setDate(d.getDate() + k);
  return ymd(d);
}
function diffDays(a, b) {
  return Math.round((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 864e5);
}
function addMonthsTo(s, k) {
  const d = new Date(`${s}T00:00:00`);
  const day = d.getDate();
  d.setMonth(d.getMonth() + k);
  if (d.getDate() !== day) d.setDate(0);
  return ymd(d);
}
function mins(t) {
  if (!t) return null;
  const p = String(t).split(':');
  return +p[0] * 60 + (+p[1] || 0);
}
const dow = date => new Date(`${date}T00:00:00`).getDay();

/* ---------- defaults: the prototype's DEF (all editable in Settings) ---------- */
const DEFAULTS = Object.freeze({
  stdHours: 8, breakH: 1, shiftStart: '09:00', grace: 15, graceTimes: 3, lateDeduct: true, annualDays: 21,
  workWeek: [0, 1, 2, 3, 4],
  otDay: 1.35, otNight: 1.7, otFri: 2.0, otSat: 1.5, otHol: 3.0, nightFrom: 22, nightTo: 6, otBase: 'gross',
  siteGC: 1.5, siteOut: 2.0, perDiem: 250,
  insEmp: 11, insEr: 18.75, insMin: 2700, insMax: 16700,
  exemption: 20000,
  brackets: [[40000, 0], [55000, 10], [70000, 15], [200000, 20], [400000, 22.5], [1200000, 25], [null, 27.5]],
  siteTaxable: false, sickPaid: true, insBaseMode: 'all', commPro: false, reimbTaxable: false,
  // Signatory names print on payslips and the register; the real names are entered in Settings.
  hrName: 'HR Officer', mdName: 'Managing Director', erpName: '', erpUrl: '', erpCo: 'RIES', erpAuto: false,
  gl: {
    sal: '5100 Salaries and wages', allow: '5110 Allowances', ot: '5120 Overtime', site: '5130 Site and travel allowances',
    reimb: '5140 Travel reimbursements', insEr: '5150 Social insurance, employer', insPay: '2310 Social insurance payable',
    taxPay: '2320 Income tax payable', net: '2330 Salaries payable',
  },
  holidays: '2026-10-06\n2027-01-07\n2027-01-25\n2027-04-25\n2027-05-01\n2027-06-30\n2027-07-23',
  cities: [
    { n: 'Cairo', z: 'Greater Cairo' }, { n: 'Giza', z: 'Greater Cairo' }, { n: 'Qalyubia', z: 'Greater Cairo' },
    { n: 'Alexandria', z: 'Delta and North Coast' }, { n: 'Tanta', z: 'Delta and North Coast' }, { n: 'Mansoura', z: 'Delta and North Coast' },
    { n: 'Ismailia', z: 'Canal' }, { n: 'Suez', z: 'Canal' }, { n: 'Port Said', z: 'Canal' },
    { n: 'Fayoum', z: 'Upper Egypt near' }, { n: 'Beni Suef', z: 'Upper Egypt near' },
    { n: 'Minya', z: 'Upper Egypt' }, { n: 'Assiut', z: 'Upper Egypt' }, { n: 'Luxor', z: 'Upper Egypt' }, { n: 'Aswan', z: 'Upper Egypt' },
    { n: 'Hurghada', z: 'Red Sea and Sinai' }, { n: 'Sharm El-Sheikh', z: 'Red Sea and Sinai' }, { n: 'Remote desert site', z: 'Remote' },
  ],
  req: [
    { n: 'HSE induction', m: 12, d: 'all' }, { n: 'Fire safety', m: 12, d: 'all' },
    { n: 'First aid', m: 24, d: 'Technical' }, { n: 'Working at height', m: 12, d: 'Technical' }, { n: 'Electrical and LV safety', m: 12, d: 'Technical' },
  ],
});

/* ---------- reference lists (the prototype's constants) ---------- */
const DEPTS = ['Management', 'Admin', 'Sales', 'Technical', 'Commercial', 'Finance', 'Marketing', 'Operations'];
const EMP_STATUS = ['Active', 'Probation', 'Left'];
const EMP_TYPE = ['Full time', 'Contract', 'Part time', 'Intern'];
const PAY_METHODS = ['Bank transfer', 'Cash', 'Cheque'];
const DOCS = [
  { k: 'cv', n: 'CV', s: 'CV' }, { k: 'edu', n: 'Education certificate', s: 'Edu' }, { k: 'idc', n: 'National ID copy', s: 'ID' },
  { k: 'photo', n: 'Personal photo', s: 'Photo' }, { k: 'mil', n: 'Military service status', s: 'Mil' }, { k: 'crim', n: 'Criminal record certificate', s: 'Rec' },
  { k: 'med', n: 'Medical fitness certificate', s: 'Med', exp: 1 }, { k: 'ref', n: 'Reference check', s: 'Ref' },
  { k: 'offer', n: 'Signed offer letter', s: 'Offer' }, { k: 'contract', n: 'Signed employment contract (4 copies)', s: 'Contract' },
  { k: 'nda', n: 'Confidentiality undertaking', s: 'NDA' }, { k: 'si', n: 'Social insurance registration', s: 'SI' },
  { k: 'bank', n: 'Payroll payment form', s: 'Pay' }, { k: 'hse', n: 'HSE induction signed', s: 'HSE' },
  { k: 'asset', n: 'Asset handover receipt', s: 'Asset' }, { k: 'lic', n: 'Professional licence or syndicate card', s: 'Licence', exp: 1 },
  { k: 'nrea', n: 'NREA or vendor training certificates', s: 'NREA' }, { k: 'prev', n: 'Previous employer letter and last payslip', s: 'Prev' },
  { k: 'addr', n: 'Proof of address and emergency contacts', s: 'Addr' }, { k: 'dl', n: 'Driving licence copy', s: 'Driving', exp: 1 },
];
const STAGES = ['Applied', 'Screened', 'Interview', 'Offer', 'Documents', 'Hired', 'Rejected'];
const ATT_CODES = ['P', 'V', 'A', 'L', 'S', 'U', 'W', 'H'];
const PURPOSES = ['Site survey', 'Installation', 'Commissioning', 'Maintenance', 'Client meeting', 'Supplier or authority visit', 'Training'];
const VISIT_STATUS = ['Planned', 'Done', 'Cancelled'];
const ASSET_TYPES = ['Laptop', 'Mobile phone', 'SIM line', 'Vehicle', 'PPE set', 'Tools and meters', 'Access card or keys', 'Other'];
const EXPENSE_TYPES = ['Transport (taxi, fuel, parking)', 'Accommodation', 'Meals', 'Client hospitality', 'Supplies and materials', 'Phone and internet', 'Training fee', 'Other'];
const CERT_KINDS = ['Training course', 'Professional certification'];
const LEAVE_TYPES = ['Annual leave', 'Casual leave', 'Sick leave', 'Unpaid leave', 'Maternity leave', 'Paternity leave'];
const OT_KINDS = ['Weekday overtime', 'Friday (statutory rest day)', 'Saturday (company rest day)', 'Official holiday'];
const FORM_STATUS = ['Pending', 'Approved', 'Rejected'];
const LEAVE_CODE = { 'Annual leave': 'L', 'Casual leave': 'L', 'Sick leave': 'S', 'Unpaid leave': 'U', 'Maternity leave': 'L', 'Paternity leave': 'L' };

/** Settings merged over the defaults (the prototype's C()). */
function config(stored) {
  return Object.assign({}, DEFAULTS, stored || {});
}

/**
 * Builds the engine for one data snapshot.
 * data: { cfg, today, employees[], attendance{ `${empId}_${month}`: { days: { DD: {s,in,out,n} }, appr } },
 *         targets{ `${empId}_${month}`: pct }, visits[], expenses[], adjustments[], forms[], trainings[] }
 * Every record carries `id` (string); employees carry the prototype's field names.
 */
function createEngine(data) {
  const c = config(data.cfg);
  const TODAY = data.today;
  const employees = data.employees || [];
  const att = data.attendance || {};
  const tgts = data.targets || {};
  const visits = data.visits || [];
  const expenses = data.expenses || [];
  const adjustments = data.adjustments || [];
  const forms = data.forms || [];
  const trainings = data.trainings || [];
  const empIndex = new Map(employees.map(e => [String(e.id), e]));

  function hols() {
    const s = {};
    String(c.holidays || '').split(/[\s,;]+/).forEach(x => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(x)) s[x] = 1;
    });
    return s;
  }
  const empById = id => empIndex.get(String(id)) || null;
  const emps = () =>
    employees.slice().sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')) || String(a.name || '').localeCompare(String(b.name || '')));
  const inEmp = (e, date) => (!e.hire || e.hire <= date) && (!e.end || e.end >= date);
  function empsIn(m) {
    const f = `${m}-01`;
    const l = `${m}-${pad(daysIn(m))}`;
    return emps().filter(e => (!e.hire || e.hire <= l) && (!e.end || e.end >= f));
  }
  const grossOf = e => (+e.basic || 0) + (+e.transport || 0) + (+e.incentive || 0) + (+e.other || 0);
  function tgtOf(id, m) {
    const t = tgts[`${id}_${m}`];
    return t != null ? +t : null;
  }
  function commPaid(e, m) {
    const x = +e.commission || 0;
    if (!x) return 0;
    const p = tgtOf(e.id, m);
    if (p == null) return 0;
    if (c.commPro) return x * Math.min(1.5, Math.max(0, p / 100));
    return p >= 100 ? x : 0;
  }
  const expOf = (id, m) =>
    expenses.filter(x => String(x.empId) === String(id) && x.status === 'Approved' && String(x.payMonth || x.date || '').slice(0, 7) === m);
  const attDoc = (id, m) => att[`${id}_${m}`];

  function dayInfo(e, date, H) {
    H = H || hols();
    const w = dow(date);
    const o = { date, dow: w, emp: inEmp(e, date), rest: c.workWeek.indexOf(w) < 0, hol: !!H[date], s: '', in: '', out: '', n: '', worked: 0, ot: 0, otN: 0, sp: 0, spT: '', late: 0, unpaid: 0, present: 0, unrec: false };
    if (!o.emp) return o;
    const doc = attDoc(e.id, date.slice(0, 7));
    const rec = doc && doc.days && doc.days[date.slice(8)];
    if (rec) {
      o.s = rec.s || '';
      o.in = rec.in || '';
      o.out = rec.out || '';
      o.n = rec.n || '';
    }
    const off = o.rest || o.hol;
    o.unrec = !o.s && !off && date < TODAY;
    const a = mins(o.in);
    let b = mins(o.out);
    if (a != null && b != null) {
      if (b <= a) b += 1440;
      o.worked = (b - a) / 60;
      if (o.worked > 5) o.worked -= c.breakH;
      o.worked = Math.max(0, o.worked);
    }
    const special = o.s === 'W' || o.s === 'H' || ((o.s === 'P' || o.s === 'V') && off && o.worked > 0);
    if (special) {
      o.sp = o.worked;
      o.spT = o.s === 'H' || o.hol ? 'hol' : w === 5 ? 'fri' : 'sat';
    } else if ((o.s === 'P' || o.s === 'V') && o.worked > c.stdHours) {
      o.ot = o.worked - c.stdHours;
      const s2 = b - o.ot * 60;
      const e2 = b;
      const nf = c.nightFrom * 60;
      const nt = c.nightTo * 60;
      const ov = (x1, x2, y1, y2) => Math.max(0, Math.min(x2, y2) - Math.max(x1, y1));
      o.otN = (ov(s2, e2, nf, 1440 + nt) + ov(s2, e2, 0, nt) + ov(s2, e2, 1440 + nf, 2880)) / 60;
      o.otN = Math.min(o.otN, o.ot);
    }
    o.unpaid = o.s === 'A' || o.s === 'U' ? 1 : 0;
    o.present = o.s === 'P' || o.s === 'V' || o.s === 'W' || o.s === 'H' ? 1 : 0;
    const a0 = mins(o.in);
    const st = mins(c.shiftStart);
    if (o.s === 'P' && a0 != null && st != null && a0 - st > 0) {
      o.late = a0 - st;
      o.inGrace = a0 - st <= c.grace;
    }
    return o;
  }

  function taxAnnual(x) {
    let prev = 0;
    let t = 0;
    for (let i = 0; i < c.brackets.length; i++) {
      const up = c.brackets[i][0];
      const r = c.brackets[i][1];
      const hi = up == null ? Infinity : up;
      if (x > prev) t += ((Math.min(x, hi) - prev) * r) / 100;
      prev = hi;
      if (x <= hi) break;
    }
    return t;
  }
  const visitsOf = (id, m) => visits.filter(v => String(v.empId) === String(id) && v.status === 'Done' && String(v.date || '').slice(0, 7) === m);
  function cityRate(n) {
    return c.cities.filter(x => x.n === n)[0] || { n, z: '' };
  }
  const isGC = city => cityRate(city).z === 'Greater Cairo';

  // Policy: Greater Cairo day = daily wage x 1.5 in total (extra 0.5 day, no meal allowance).
  // Outside Greater Cairo = daily wage x 2 in total (extra 1.0 day) plus the flat meal per diem.
  // A visit day on Friday, Saturday or a holiday pays the higher of the visit extra and the rest-day rate.
  function visitParts(v) {
    const e = empById(v.empId);
    const gross = e ? grossOf(e) : 0;
    const daily = gross / 30;
    const gc = isGC(v.city);
    const H = hols();
    const days = Math.max(1, +v.days || 1);
    let allow = 0;
    let pd = 0;
    for (let i = 0; i < days; i++) {
      const dt = dAdd(v.date, i);
      const dw = dow(dt);
      const extra = (gc ? c.siteGC : c.siteOut) - 1;
      const rest = H[dt] ? c.otHol : dw === 5 ? c.otFri : dw === 6 ? c.otSat : 0;
      allow += daily * Math.max(extra, rest);
      if (!gc && !v.mealsProvided) pd += c.perDiem;
    }
    const tr = +v.transport || 0;
    const ac = +v.accom || 0;
    const ml = +v.meals || 0;
    return { allow, pd, tr, ac, ml, reimb: tr + ac + ml, total: allow + pd + tr + ac + ml, gc, daily };
  }

  function calcPay(e, m) {
    const H = hols();
    const dim = daysIn(m);
    const t = { present: 0, absent: 0, uleave: 0, leave: 0, sick: 0, unrec: 0, emp: 0, otD: 0, otN: 0, otF: 0, otS: 0, otR: 0, otH: 0, late: 0, lateN: 0, graceUsed: 0, restWork: 0 };
    for (let i = 1; i <= dim; i++) {
      const inf = dayInfo(e, `${m}-${pad(i)}`, H);
      if (!inf.emp) continue;
      t.emp++;
      if (inf.present) t.present++;
      if (inf.s === 'A') t.absent++;
      if (inf.s === 'U') t.uleave++;
      if (inf.s === 'L') t.leave++;
      if (inf.s === 'S') t.sick++;
      if (inf.unrec) t.unrec++;
      t.otD += inf.ot - inf.otN;
      t.otN += inf.otN;
      if (inf.spT === 'fri') t.otF += inf.sp;
      if (inf.spT === 'sat') t.otS += inf.sp;
      if (inf.spT === 'hol') t.otH += inf.sp;
      if (inf.late) {
        t.lateN++;
        if (inf.inGrace) {
          t.graceUsed++;
          if (t.graceUsed > c.graceTimes) t.late += inf.late;
        } else t.late += inf.late;
      }
    }
    t.otR = t.otF + t.otS;
    const basic = +e.basic || 0;
    const tr = +e.transport || 0;
    const inc = +e.incentive || 0;
    const oth = +e.other || 0;
    const gross = basic + tr + inc + oth;
    const f = t.emp / dim;
    const fixed = gross * f;
    const comm = commPaid(e, m);
    const unpaidDays = t.absent + t.uleave + (c.sickPaid ? 0 : t.sick);
    const absDed = (unpaidDays * gross) / 30;
    const hr = ((c.otBase === 'gross' ? gross : basic) / 30) / c.stdHours;
    const lateDed = c.lateDeduct ? t.late * (gross / 30 / c.stdHours / 60) : 0;
    const otPay = hr * (t.otD * c.otDay + t.otN * c.otNight + t.otF * c.otFri + t.otS * c.otSat + t.otH * c.otHol);
    const vs = visitsOf(e.id, m);
    let site = 0;
    let reimb = 0;
    vs.forEach(v => {
      const vp = visitParts(v);
      site += vp.allow + vp.pd;
      reimb += vp.reimb;
    });
    const ex = expOf(e.id, m);
    ex.forEach(x => {
      reimb += +x.amount || 0;
    });
    const adjs = adjustments.filter(a => String(a.empId) === String(e.id) && a.month === m);
    let addTx = 0;
    let addNo = 0;
    let ded = 0;
    adjs.forEach(a => {
      const x = +a.amount || 0;
      if (a.type === 'add') {
        if (a.taxable) addTx += x;
        else addNo += x;
      } else ded += x;
    });
    const insBase =
      e.insured === false
        ? 0
        : Math.min(c.insMax, Math.max(c.insMin, +e.insBase > 0 ? +e.insBase : c.insBaseMode === 'basic' ? basic : c.insBaseMode === 'basicother' ? basic + oth : gross));
    const insEmp = e.insured === false ? 0 : ((insBase * c.insEmp) / 100) * f;
    const insEr = e.insured === false ? 0 : ((insBase * c.insEr) / 100) * f;
    const taxM = fixed - absDed - lateDed + otPay + comm + addTx + (c.siteTaxable ? site : 0) + (c.reimbTaxable ? reimb : 0);
    const annual = Math.max(0, (taxM - insEmp) * 12 - c.exemption);
    const tax = taxAnnual(annual) / 12;
    const earn = fixed + otPay + comm + site + reimb + addTx + addNo;
    const net = earn - absDed - lateDed - ded - insEmp - tax;
    return {
      id: e.id, name: e.name, code: e.code, dept: e.dept, role: e.role, email: e.email || '', t, gross, fixed,
      basic: basic * f, transport: tr * f, incentive: inc * f, other: oth * f, comm, commBase: +e.commission || 0, tgt: tgtOf(e.id, m),
      absDed, unpaidDays, lateDed, hr, otD: t.otD, otN: t.otN, otF: t.otF, otS: t.otS, otR: t.otR, otH: t.otH, otPay, site, reimb,
      nVisits: vs.length, nExp: ex.length, addTx, addNo, ded, insBase, insEmp, insEr, tax, net, earn,
      cost: earn - 0 + insEr, otHours: t.otD + t.otN + t.otF + t.otS + t.otH,
    };
  }

  const sum = (rows, k) => rows.reduce((a, r) => a + (+r[k] || 0), 0);

  /** Rows frozen on close (the prototype's payclose): every number rounded to 2 dp, `t` kept as is. */
  function freezeRows(rows) {
    return rows.map(r => {
      const o = {};
      Object.keys(r).forEach(k => {
        o[k] = typeof r[k] === 'number' ? r2(r[k]) : r[k];
      });
      o.t = r.t;
      return o;
    });
  }

  /* documents and training status */
  function docSt(e, d) {
    const r = (e.docs || {})[d.k];
    if (!r || r.st === 'pending') return 'miss';
    if (r.st === 'na') return 'na';
    if (d.exp && r.exp) {
      const x = diffDays(r.exp, TODAY);
      if (x < 0) return 'exp';
      if (x <= 60) return 'soon';
    }
    return 'ok';
  }
  function docScore(e) {
    let a = 0;
    let ok = 0;
    DOCS.forEach(d => {
      const s = docSt(e, d);
      if (s === 'na') return;
      a++;
      if (s === 'ok' || s === 'soon') ok++;
    });
    return a ? ok / a : 1;
  }
  function trnStatus(e, rq) {
    if (rq.d !== 'all' && rq.d !== e.dept) return { s: 'na' };
    const rs = trainings.filter(t => String(t.empId) === String(e.id) && t.course === rq.n).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!rs.length) return { s: 'miss' };
    const r = rs[0];
    const ex = r.exp || (rq.m ? addMonthsTo(r.date, +rq.m) : '');
    if (!ex) return { s: 'ok', rec: r };
    const x = diffDays(ex, TODAY);
    return { s: x < 0 ? 'exp' : x <= 60 ? 'soon' : 'ok', rec: r, exp: ex };
  }

  /* leave */
  function wdList(e, from, to) {
    const out = [];
    const H = hols();
    if (!from || !to || to < from) return out;
    for (let d = from, n = 0; d <= to && n < 400; d = dAdd(d, 1), n++) {
      const w = dow(d);
      if (c.workWeek.indexOf(w) >= 0 && !H[d] && (!e || inEmp(e, d))) out.push(d);
    }
    return out;
  }
  const leaveUsed = (empId, year) =>
    forms
      .filter(f => f.ft === 'leave' && String(f.empId) === String(empId) && f.status === 'Approved' && (f.ltype === 'Annual leave' || f.ltype === 'Casual leave') && String(f.from).slice(0, 4) === String(year))
      .reduce((n, f) => n + (+f.days || 0), 0);
  const casualUsed = (empId, year) =>
    forms
      .filter(f => f.ft === 'leave' && String(f.empId) === String(empId) && f.status === 'Approved' && f.ltype === 'Casual leave' && String(f.from).slice(0, 4) === String(year))
      .reduce((n, f) => n + (+f.days || 0), 0);
  const otApproved = (empId, date) => forms.some(f => f.ft === 'ot' && String(f.empId) === String(empId) && f.odate === date && f.status === 'Approved');
  function leaveEnt(e, year) {
    const ys = `${year}-01-01`;
    const ye = `${year}-12-31`;
    if (!e.hire || e.hire <= ys) return c.annualDays;
    if (e.hire > ye) return 0;
    const days = diffDays(ye, e.hire) + 1;
    return Math.round((c.annualDays * days) / 365);
  }

  /* ERP journal (spec section 9 payload) */
  function erpJournal(m, rows, status, generatedAt) {
    const g = c.gl;
    const co = c.erpCo;
    const J = [];
    const add = (acct, dr, cr, memo) => {
      if (Math.round(dr) || Math.round(cr)) J.push({ co, period: m, account: acct, debit: r2(dr), credit: r2(cr), memo });
    };
    add(g.sal, sum(rows, 'basic'), 0, 'Basic salaries');
    add(g.allow, sum(rows, 'transport') + sum(rows, 'incentive') + sum(rows, 'other') + sum(rows, 'comm') + sum(rows, 'addTx') + sum(rows, 'addNo'), 0, 'Allowances, incentives, commission, adjustments');
    add(g.ot, sum(rows, 'otPay'), 0, 'Overtime');
    add(g.site, sum(rows, 'site'), 0, 'Site and travel allowances');
    add(g.reimb, sum(rows, 'reimb'), 0, 'Travel reimbursements');
    add(g.insEr, sum(rows, 'insEr'), 0, 'Employer social insurance');
    const ded = sum(rows, 'absDed') + sum(rows, 'lateDed') + sum(rows, 'ded');
    add(g.sal, 0, ded, 'Absence, late and other deductions');
    add(g.insPay, 0, sum(rows, 'insEmp') + sum(rows, 'insEr'), 'Social insurance payable');
    add(g.taxPay, 0, sum(rows, 'tax'), 'Income tax payable');
    add(g.net, 0, sum(rows, 'net'), 'Net salaries payable');
    return {
      company: co,
      period: m,
      status,
      generated: generatedAt,
      lines: J,
      employees: rows.map(r => ({
        code: r.code, name: r.name, dept: r.dept, fixed: r2(r.fixed), commission: r2(r.comm), overtime: r2(r.otPay), site: r2(r.site),
        reimbursements: r2(r.reimb), deductions: r2(r.absDed + r.lateDed + r.ded), insurance_employee: r2(r.insEmp), insurance_employer: r2(r.insEr),
        tax: r2(r.tax), net: r2(r.net),
      })),
    };
  }

  return {
    cfg: c, today: TODAY, hols, emps, empById, inEmp, empsIn, grossOf, tgtOf, commPaid, expOf, dayInfo, taxAnnual, visitsOf, cityRate, isGC,
    visitParts, visitPay: v => visitParts(v).total, calcPay, sum, freezeRows, docSt, docScore, trnStatus, wdList, leaveUsed, casualUsed,
    otApproved, leaveEnt, erpJournal,
  };
}

/** Whole-EGP display rounding used on payslips and the register (spec section 6, Rounding). */
const fmt = n => Math.round(n || 0).toLocaleString('en-US');

module.exports = {
  createEngine, config, DEFAULTS, DOCS, DEPTS, EMP_STATUS, EMP_TYPE, PAY_METHODS, STAGES, ATT_CODES, PURPOSES, VISIT_STATUS, ASSET_TYPES,
  EXPENSE_TYPES, CERT_KINDS, LEAVE_TYPES, OT_KINDS, FORM_STATUS, LEAVE_CODE,
  pad, ymd, r1, r2, fmt, daysIn, mLabel, mAdd, dAdd, diffDays, addMonthsTo, mins,
};
