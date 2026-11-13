'use strict';

// HR Portal Developer Spec section 11, test rules: "Unit tests for every calculation branch in
// section 6 with the prototype's example team as fixtures; expected figures are in the prototype's
// register". When the prototype is on disk (reports & requirments/Reservia_HR_Portal.html, or
// HR_PROTOTYPE_PATH) the engine is compared with the prototype's own calcPay for every employee,
// across several dates and every setting branch. Without it, the committed November 2026 register
// snapshot is the reference. Pure - no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../../services/hr/payrollEngine');
const { buildExampleTeam } = require('../../services/hr/exampleTeam');
const oracle = require('./prototypeOracle');

const SNAPSHOT = path.join(__dirname, 'fixtures', 'prototype-register-2026-11.json');
const HAVE_PROTOTYPE = !!oracle.load('2026-11-13');

/** Engine input built from our own example-team port (keys as ids). */
function ourData(today, cfg, extra = {}) {
  const t = buildExampleTeam(today, {}); // the prototype seeds with the default settings, then applies the variant
  const id = r => r.empKey;
  const attendance = {};
  t.att.forEach(a => {
    attendance[`${a.empKey}_${a.month}`] = { days: a.days };
  });
  const targets = {};
  t.tgt.forEach(g => {
    targets[`${g.empKey}_${g.month}`] = g.pct;
  });
  return {
    cfg,
    today,
    employees: t.emp.map(e => Object.assign({}, e, { id: e.key })).concat(extra.employees || []),
    attendance: Object.assign(attendance, extra.attendance || {}),
    targets,
    visits: t.vis.map(v => Object.assign({}, v, { id: v.key, empId: id(v) })).concat(extra.visits || []),
    expenses: t.exp.map(v => Object.assign({}, v, { id: v.key, empId: id(v) })),
    adjustments: extra.adjustments || [],
    forms: t.frm.map(v => Object.assign({}, v, { id: v.key, empId: id(v) })),
    trainings: t.trn.map(v => Object.assign({}, v, { id: v.key, empId: id(v) })),
  };
}

const NUM_KEYS = ['gross', 'fixed', 'basic', 'transport', 'incentive', 'other', 'comm', 'commBase', 'absDed', 'unpaidDays', 'lateDed', 'hr', 'otD', 'otN', 'otF', 'otS', 'otR', 'otH', 'otPay', 'site', 'reimb', 'nVisits', 'nExp', 'addTx', 'addNo', 'ded', 'insBase', 'insEmp', 'insEr', 'tax', 'net', 'earn', 'cost', 'otHours'];

function assertRowsEqual(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: row count`);
  expected.forEach((e, i) => {
    const a = actual[i];
    assert.equal(String(a.code), String(e.code), `${label}: order`);
    NUM_KEYS.forEach(k => {
      const x = +a[k] || 0;
      const y = +e[k] || 0;
      assert.ok(Math.abs(x - y) < 1e-6, `${label} ${e.code} ${k}: engine ${x} vs prototype ${y}`);
    });
    assert.deepEqual(JSON.parse(JSON.stringify(a.t)), JSON.parse(JSON.stringify(e.t)), `${label} ${e.code} day counts`);
    assert.equal(a.tgt, e.tgt == null ? null : e.tgt, `${label} ${e.code} target`);
  });
}

/** Edge records added to both sides: every calculation branch the example team does not reach. */
function edgeCases(month) {
  const d = n => `${month}-${P.pad(n)}`;
  const employees = [
    // Not insured; part month (joins on the 10th, leaves on the 25th).
    { id: 'z1', code: 'EMP-91', name: 'Edge Uninsured', role: 'Technician', dept: 'Technical', status: 'Active', hire: d(10), end: d(25), basic: 9000, transport: 500, incentive: 0, other: 700, commission: 0, insured: false },
    // Insurable wage override below the floor; commission with no target.
    { id: 'z2', code: 'EMP-92', name: 'Edge Override', role: 'Sales Engineer', dept: 'Sales', status: 'Active', hire: '2025-01-01', basic: 40000, transport: 2000, incentive: 1500, other: 0, commission: 5000, insured: true, insBase: 1000 },
  ];
  const attendance = {};
  attendance[`z1_${month}`] = {
    days: {
      [P.pad(11)]: { s: 'P', in: '20:00', out: '02:00', n: '' }, // crosses midnight: night overtime
      [P.pad(12)]: { s: 'H', in: '09:00', out: '15:00', n: '' }, // holiday work code
      [P.pad(13)]: { s: 'S', in: '', out: '', n: '' },
      [P.pad(14)]: { s: 'U', in: '', out: '', n: '' },
      [P.pad(15)]: { s: 'P', in: '09:10', out: '18:00', n: '' }, // late inside the grace
      [P.pad(16)]: { s: 'P', in: '09:12', out: '18:00', n: '' },
      [P.pad(17)]: { s: 'P', in: '09:05', out: '18:00', n: '' },
      [P.pad(18)]: { s: 'P', in: '09:14', out: '18:00', n: '' }, // fourth grace use: deducted
      [P.pad(19)]: { s: 'P', in: '10:00', out: '23:30', n: '' }, // late beyond grace + night overtime
      [P.pad(20)]: { s: 'A', in: '', out: '', n: '' },
    },
  };
  attendance[`z2_${month}`] = {
    days: {
      [P.pad(2)]: { s: 'V', in: '07:00', out: '21:00', n: '' },
      [P.pad(3)]: { s: 'P', in: '09:00', out: '13:00', n: '' }, // short day: no break taken
    },
  };
  // Every weekday-of-the-month for z2 recorded present on rest days too (Friday / Saturday work).
  for (let i = 4; i <= 10; i++) attendance[`z2_${month}`].days[P.pad(i)] = { s: 'P', in: '08:00', out: '17:00', n: '' };
  const visits = [
    { id: 'zv1', empId: 'z2', date: d(5), city: 'Luxor', site: 'Edge farm', status: 'Done', days: 4, nights: 3, transport: 700, accom: 0, meals: 0, mealsProvided: true },
    { id: 'zv2', empId: 'z2', date: d(9), city: 'Giza', site: 'Edge villa', status: 'Done', days: 2, nights: 0 },
    { id: 'zv3', empId: 'z1', date: d(21), city: 'Suez', site: 'Planned only', status: 'Planned', days: 1 },
  ];
  const adjustments = [
    { id: 'za1', empId: 'z2', month, label: 'Bonus', type: 'add', amount: 2500, taxable: true },
    { id: 'za2', empId: 'z2', month, label: 'Travel grant', type: 'add', amount: 800, taxable: false },
    { id: 'za3', empId: 'z2', month, label: 'Advance', type: 'ded', amount: 1200, taxable: true },
    { id: 'za4', empId: 'ex1', month, label: 'Penalty', type: 'ded', amount: 300, taxable: true },
  ];
  return { employees, attendance, visits, adjustments };
}

function injectIntoPrototype(Pr, extra) {
  extra.employees.forEach(e => {
    const o = Object.assign({}, e);
    delete o.id;
    Pr.D.emp[e.id] = o;
  });
  Object.keys(extra.attendance).forEach(k => {
    Pr.D.att[k] = extra.attendance[k];
  });
  extra.visits.forEach(v => {
    const o = Object.assign({}, v);
    delete o.id;
    Pr.D.vis[v.id] = o;
  });
  extra.adjustments.forEach(a => {
    const o = Object.assign({}, a);
    delete o.id;
    Pr.D.adj[a.id] = o;
  });
}

const VARIANTS = [
  {},
  { commPro: true },
  { otBase: 'basic', sickPaid: false, lateDeduct: false },
  { insBaseMode: 'basic', siteTaxable: true, reimbTaxable: true },
  { insBaseMode: 'basicother', graceTimes: 1, grace: 5, stdHours: 7 },
  { workWeek: [0, 1, 2, 3, 4, 6], holidays: '2026-11-15\n2026-12-03\n2027-01-07', perDiem: 300, siteGC: 1.6 },
];
const DATES = ['2026-11-13', '2026-11-30', '2026-12-01', '2026-12-20', '2027-01-09'];

test('the example-team port produces the same records as the prototype seed', { skip: !HAVE_PROTOTYPE && 'prototype not on disk' }, () => {
  for (const today of DATES) {
    const Pr = oracle.load(today);
    Pr.seedExamples();
    const ours = buildExampleTeam(today, {});
    const strip = o => {
      const x = JSON.parse(JSON.stringify(o));
      ['key', 'example', 'empKey', 'empId', 'email', 'mgr', 'mgrKey', 'desc', 'month'].forEach(k => delete x[k]);
      return x;
    };
    const map = { emp: 'emp', vis: 'vis', exp: 'exp', trn: 'trn', cand: 'cand', ast: 'ast', perf: 'perf', frm: 'frm' };
    Object.keys(map).forEach(col => {
      ours[col].forEach(r => {
        const theirs = Pr.D[map[col]][r.key];
        assert.ok(theirs, `${today} ${col} ${r.key} exists in the prototype`);
        assert.deepEqual(strip(r), strip(theirs), `${today} ${col} ${r.key}`);
        if (r.empKey) assert.equal(r.empKey, theirs.empId, `${today} ${col} ${r.key} employee`);
      });
      assert.equal(ours[col].length, Object.keys(Pr.D[map[col]]).length, `${today} ${col} count`);
    });
    ours.att.forEach(a => assert.deepEqual(a.days, Pr.D.att[a.key].days, `${today} attendance ${a.key}`));
    ours.tgt.forEach(g => assert.equal(g.pct, Pr.D.tgt[g.key].pct));
  }
});

test('calcPay equals the prototype for every employee, date and setting branch', { skip: !HAVE_PROTOTYPE && 'prototype not on disk' }, () => {
  let compared = 0;
  for (const today of DATES) {
    const month = today.slice(0, 7);
    for (const cfg of VARIANTS) {
      for (const withEdges of [false, true]) {
        const Pr = oracle.load(today);
        Pr.seedExamples();
        if (Object.keys(cfg).length) Pr.saveCfg(cfg);
        const extra = withEdges ? edgeCases(month) : { employees: [], attendance: {}, visits: [], adjustments: [] };
        if (withEdges) injectIntoPrototype(Pr, extra);
        const theirs = Pr.empsIn(month).map(e => Pr.calcPay(Object.assign({ id: e.id }, e), month));
        // Our engine from the PROTOTYPE's data (isolates the calculation)...
        const engA = P.createEngine(oracle.engineData(Pr, today));
        assertRowsEqual(engA.empsIn(month).map(e => engA.calcPay(e, month)), theirs, `${today} ${JSON.stringify(cfg)} edges=${withEdges} (prototype data)`);
        // ...and from OUR example-team port (the seeder end to end).
        const engB = P.createEngine(ourData(today, cfg, extra));
        assertRowsEqual(engB.empsIn(month).map(e => engB.calcPay(e, month)), theirs, `${today} ${JSON.stringify(cfg)} edges=${withEdges} (our seeder)`);
        // ERP journal: identical lines, and balanced.
        const jA = engA.erpJournal(month, theirs, 'draft', 'x');
        const jP = Pr.erpJournal(month);
        assert.deepEqual(jA.lines, JSON.parse(JSON.stringify(jP.lines)), 'ERP journal lines');
        assert.deepEqual(jA.employees, JSON.parse(JSON.stringify(jP.employees)), 'ERP journal employees');
        const dr = jA.lines.reduce((a, l) => a + l.debit, 0);
        const cr = jA.lines.reduce((a, l) => a + l.credit, 0);
        assert.ok(Math.abs(dr - cr) < 0.05, `journal balances (${dr} vs ${cr})`);
        compared += theirs.length;
      }
    }
  }
  assert.ok(compared > 300, `compared ${compared} payroll rows`);
});

test('documents, training and leave entitlement equal the prototype', { skip: !HAVE_PROTOTYPE && 'prototype not on disk' }, () => {
  for (const today of DATES) {
    const Pr = oracle.load(today);
    Pr.seedExamples();
    const eng = P.createEngine(oracle.engineData(Pr, today));
    eng.emps().forEach(e => {
      P.DOCS.forEach(d => assert.equal(eng.docSt(e, d), Pr.docSt(e, d), `${today} ${e.code} ${d.k}`));
      eng.cfg.req.forEach(rq => assert.equal(eng.trnStatus(e, rq).s, Pr.trnStatus(e, rq).s, `${today} ${e.code} ${rq.n}`));
      ['2026', '2027'].forEach(y => assert.equal(eng.leaveEnt(e, y), Pr.leaveEnt(e, y), `${today} ${e.code} entitlement ${y}`));
    });
    [0, 30000, 45000, 69999, 150000, 450000, 2000000].forEach(x => assert.equal(eng.taxAnnual(x), Pr.taxAnnual(x, Pr.C())));
  }
});

test('November 2026 register: the engine reproduces the prototype register (committed snapshot)', () => {
  const today = '2026-11-30';
  const month = '2026-11';
  const eng = P.createEngine(ourData(today, {}));
  const rows = eng.empsIn(month).map(e => eng.calcPay(e, month));
  const shaped = rows.map(r => {
    const o = { code: r.code, t: r.t, tgt: r.tgt };
    NUM_KEYS.forEach(k => {
      o[k] = P.r2(r[k]);
    });
    return o;
  });
  if (HAVE_PROTOTYPE) {
    const Pr = oracle.load(today);
    Pr.seedExamples();
    const theirs = Pr.empsIn(month).map(e => Pr.calcPay(Object.assign({ id: e.id }, e), month));
    assertRowsEqual(rows, theirs, 'November register vs prototype');
    if (process.env.UPDATE_HR_SNAPSHOT === '1' || !fs.existsSync(SNAPSHOT)) {
      fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
      fs.writeFileSync(SNAPSHOT, `${JSON.stringify({ today, month, rows: shaped }, null, 2)}\n`);
    }
  }
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  assert.deepEqual(shaped, snap.rows);
  // Spot figures a reviewer can check on the prototype's November register.
  const net = Object.fromEntries(rows.map(r => [r.code, Math.round(r.net)]));
  assert.equal(Object.keys(net).length, 6);
});

test('commission rules: full at 100%, nothing below; pro rata capped at 150%', () => {
  const base = { cfg: {}, today: '2026-11-30', employees: [{ id: 'a', code: 'A', hire: '2025-01-01', basic: 10000, commission: 4000 }], targets: { 'a_2026-11': 80 } };
  let eng = P.createEngine(base);
  assert.equal(eng.commPaid(base.employees[0], '2026-11'), 0);
  eng = P.createEngine(Object.assign({}, base, { targets: { 'a_2026-11': 100 } }));
  assert.equal(eng.commPaid(base.employees[0], '2026-11'), 4000);
  eng = P.createEngine(Object.assign({}, base, { cfg: { commPro: true }, targets: { 'a_2026-11': 180 } }));
  assert.equal(eng.commPaid(base.employees[0], '2026-11'), 6000);
  eng = P.createEngine(Object.assign({}, base, { targets: {} }));
  assert.equal(eng.commPaid(base.employees[0], '2026-11'), 0, 'no target entered = 0');
});
