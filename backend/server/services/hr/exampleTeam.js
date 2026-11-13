'use strict';

// Reservia HR Portal - the example team (HR Portal Developer Spec sections 3 and 11: "Example data
// seeder is part of the repo"; "a migration script loads the prototype's example data and
// reproduces its register"). A port of the prototype's seedExamples(): same six people, documents,
// attendance, visits, claims, targets, forms, training, assets, candidates and review, laid out
// relative to `today` exactly as the prototype does. Every record carries `example: true` and a
// stable `key` (the prototype's id) so "Remove example data" deletes exactly these and nothing else.
//
// Example data is for demonstration and acceptance only - never production pay.

const P = require('./payrollEngine');

const { pad, dAdd, addMonthsTo, daysIn, DOCS, EXPENSE_TYPES, OT_KINDS } = P;

/**
 * Returns { emp, tgt, ast, exp, perf, trn, cand, vis, att, frm } - arrays of plain records keyed by
 * `key`. Employee references use the example key (`empKey`).
 */
function buildExampleTeam(today, cfg) {
  const c = P.config(cfg);
  const m = today.slice(0, 7);
  const out = { emp: [], tgt: [], ast: [], exp: [], perf: [], trn: [], cand: [], vis: [], att: [], frm: [] };
  const put = (col, key, o) => out[col].push(Object.assign({ key, example: true }, o));
  const E = [
    ['EMP-01', 'Mona Adel', 'Admin Officer', 'Admin', 'Cairo', -60, 12000, 1000, 0, 'Probation'],
    ['EMP-02', 'Karim Hassan', 'Business Development Manager', 'Sales', 'Cairo', -45, 28000, 2500, 3000, 'Active'],
    ['EMP-03', 'Omar Nabil', 'Sales Engineer', 'Sales', 'Cairo', -30, 16000, 1500, 1000, 'Active'],
    ['EMP-04', 'Youssef Ragab', 'Technical Engineer', 'Technical', 'Cairo', -45, 20000, 2000, 2000, 'Active'],
    ['EMP-05', 'Salma Fouad', 'Marketing Coordinator', 'Marketing', 'Cairo', null, 11000, 1000, 0, 'Probation'],
    ['EMP-06', 'Hany Saber', 'Site Supervisor', 'Technical', 'Cairo', -38, 14000, 1500, 1500, 'Active'],
  ];
  const ids = [];
  const hires = {};
  E.forEach((x, i) => {
    const id = `ex${i + 1}`;
    ids.push(id);
    let hire = x[5] == null ? `${m}-01` : dAdd(today, x[5]);
    if (hire > today) hire = `${m}-01`;
    hires[id] = hire;
    const docs = {};
    DOCS.forEach((d, j) => {
      const r = (i * 7 + j * 3) % 11;
      if (d.k === 'mil' && i === 0) {
        docs[d.k] = { st: 'na' };
        return;
      }
      if (r < 7) {
        docs[d.k] = { st: 'ok', date: hire, loc: `HR cabinet 1, folder ${x[0]}` };
        if (d.exp) docs[d.k].exp = r < 2 ? dAdd(today, -20) : r < 4 ? dAdd(today, 35) : dAdd(today, 300);
      } else if (r < 9) docs[d.k] = { st: 'pending' };
    });
    put('emp', id, {
      code: x[0], name: x[1], role: x[2], dept: x[3], city: x[4], status: x[9], type: 'Full time', hire,
      basic: x[6], transport: x[7], incentive: x[8], commission: i === 1 ? 6000 : i === 2 ? 3000 : 0, other: 0,
      paym: 'Bank transfer', insured: true, docs, file: `HR cabinet 1, folder ${x[0]}`,
      // The prototype's reporting lines: three report to the BDM, the rest to the MD.
      mgr: i === 2 || i === 3 || i === 5 ? 'Karim Hassan' : c.mdName,
      mgrKey: i === 2 || i === 3 || i === 5 ? 'ex2' : null,
      email: `${x[1].toLowerCase().replace(/ /g, '.')}@example.invalid`,
      cstart: hire, cend: addMonthsTo(hire, 12), probEnd: addMonthsTo(hire, 3), nat: 'Egyptian',
    });
  });
  put('tgt', `ex2_${m}`, { empKey: 'ex2', month: m, pct: 110 });
  put('tgt', `ex3_${m}`, { empKey: 'ex3', month: m, pct: 80 });
  put('ast', 'exA1', { empKey: 'ex2', type: 'Laptop', desc: 'Lenovo ThinkPad 14', serial: 'PF-4K2M9', issued: dAdd(today, -40), cond: 'New' });
  put('ast', 'exA2', { empKey: 'ex2', type: 'SIM line', desc: 'Mobile line (example)', issued: dAdd(today, -40) });
  put('ast', 'exA3', { empKey: 'ex4', type: 'PPE set', desc: 'Helmet, harness, boots', issued: dAdd(today, -44) });
  put('exp', 'exE1', { empKey: 'ex3', date: dAdd(today, -6), type: EXPENSE_TYPES[0], amount: 320, desc: 'Taxi to New Cairo survey', receipt: true, status: 'Approved', payMonth: m, by: 'Karim Hassan' });
  put('exp', 'exE2', { empKey: 'ex4', date: dAdd(today, -3), type: EXPENSE_TYPES[5], amount: 450, desc: 'Site internet dongle', receipt: true, status: 'Pending', payMonth: m });
  put('perf', 'exP1', {
    empKey: 'ex3', cycle: '2026 H2',
    goals: [{ t: 'Qualified leads handed to BDM', w: 40, s: 4 }, { t: 'Quotes issued within 48 hours', w: 30, s: 3 }, { t: 'CRM kept current weekly', w: 30, s: 4 }],
    rating: 3.7, by: 'Karim Hassan', date: dAdd(today, -5), note: 'Good first quarter. Needs faster quote turnaround.',
  });
  [['ex2', 'HSE induction', -40], ['ex3', 'HSE induction', -40], ['ex4', 'HSE induction', -400], ['ex4', 'Working at height', -100], ['ex4', 'Electrical and LV safety', -60], ['ex4', 'First aid', -300], ['ex6', 'HSE induction', -35], ['ex6', 'Working at height', -33], ['ex6', 'Fire safety', -20], ['ex2', 'Fire safety', -380]].forEach((t, i) => {
    put('trn', `exT${i}`, { empKey: t[0], course: t[1], provider: 'Accredited safety trainer', date: dAdd(today, t[2]), hours: 8, cert: i % 3 !== 2, cost: 1500 });
  });
  [['Nour Samir', 'Finance Officer', 'Finance', 'Interview'], ['Tarek Anwar', 'Technical Engineer', 'Technical', 'Offer'], ['Rana Khaled', 'Sales Engineer', 'Sales', 'Documents'], ['Adham Wael', 'Admin Assistant', 'Admin', 'Screened']].forEach((cd, i) => {
    const offered = cd[3] === 'Offer' || cd[3] === 'Documents';
    put('cand', `exC${i}`, { name: cd[0], role: cd[1], dept: cd[2], stage: cd[3], src: i % 2 ? 'Referral' : 'LinkedIn', offer: offered ? 18000 : '', start: offered ? dAdd(today, 21) : '' });
  });
  const vis = [
    ['ex3', 3, 'Cairo', 'New Cairo villa survey', 'Site survey', 1, 0, 200, 0, 0],
    ['ex4', 7, 'Alexandria', 'Borg El Arab factory roof survey', 'Site survey', 2, 1, 900, 1400, 0],
    ['ex6', 10, 'Hurghada', 'Hotel staff housing install', 'Installation', 3, 2, 1800, 3200, 600],
    ['ex2', 12, 'Cairo', 'Compound developer meeting', 'Client meeting', 1, 0, 150, 0, 0],
  ];
  const vd = {};
  vis.forEach((v, i) => {
    const date = `${m}-${pad(Math.min(v[1], Math.max(1, +today.slice(8) - 1)))}`;
    put('vis', `exV${i}`, { empKey: v[0], date, city: v[2], site: v[3], purpose: v[4], days: v[5], nights: v[6], transport: v[7], accom: v[8], meals: v[9], status: 'Done' });
    for (let k = 0; k < v[5]; k++) (vd[v[0]] = vd[v[0]] || {})[dAdd(date, k)] = 1;
  });
  const H = {};
  String(c.holidays || '').split(/[\s,;]+/).forEach(x => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) H[x] = 1;
  });
  const last = today > `${m}-01` ? dAdd(today, -1) : `${m}-01`;
  ids.forEach((id, i) => {
    const days = {};
    for (let d = 1; d <= daysIn(m); d++) {
      const date = `${m}-${pad(d)}`;
      if (date > last) break;
      if (date < hires[id]) continue;
      const dw = new Date(`${date}T00:00:00`).getDay();
      const off = c.workWeek.indexOf(dw) < 0 || H[date];
      let st = 'P';
      let a = '09:00';
      let b = '18:00';
      const rr = (d * 7 + i * 5) % 13;
      if (off) {
        if (id === 'ex6' && dw === 5 && d <= 9) {
          st = 'W';
          a = '10:00';
          b = '16:00';
        } else continue;
      } else if (vd[id] && vd[id][date]) {
        st = 'V';
        a = '08:30';
        b = '19:00';
      } else if (rr === 3) a = '09:40';
      else if (rr === 5) b = '19:30';
      else if (rr === 8 && i % 2 === 0) b = '22:30';
      if (id === 'ex1' && d === 13 && !off) {
        st = 'A';
        a = '';
        b = '';
      }
      if (id === 'ex5' && d === 14 && !off) {
        st = 'L';
        a = '';
        b = '';
      }
      days[pad(d)] = { s: st, in: a, out: b, n: '' };
    }
    put('att', `${id}_${m}`, { empKey: id, month: m, days });
  });
  // fx1: the prototype computes the working days with its wdList against EMP-03.
  const eng = P.createEngine({ cfg, today, employees: [{ id: 'ex3', hire: hires.ex3 }] });
  put('frm', 'fx1', { ft: 'leave', empKey: 'ex3', ltype: 'Annual leave', from: dAdd(today, 28), to: dAdd(today, 32), days: eng.wdList({ id: 'ex3', hire: hires.ex3 }, dAdd(today, 28), dAdd(today, 32)).length || 4, cover: 'Youssef Ragab', status: 'Pending', created: today, reason: 'Family trip' });
  put('frm', 'fx2', { ft: 'visit', empKey: 'ex6', from: dAdd(today, 4), city: 'Alexandria', site: 'Cold store, Borg El Arab', purpose: 'Site survey', days: 2, nights: 1, back: dAdd(today, 5), transport: 'Company arranges', stay: 'Company books', meals: 'Not provided', ref: '', reason: 'Roof and board survey for a 150 kW quote', status: 'Pending', created: today });
  put('frm', 'fx3', { ft: 'ot', empKey: 'ex4', odate: dAdd(today, -1), kind: OT_KINDS[0], from: '18:00', to: '20:30', hours: 2.5, site: 'Commissioning, Giza', reason: 'Inverter commissioning before client handover', status: 'Approved', by: 'Karim Hassan', decided: dAdd(today, -2), created: dAdd(today, -2) });
  return out;
}

module.exports = { buildExampleTeam };
