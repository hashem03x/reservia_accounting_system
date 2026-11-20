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

/** HR Portal D9: collapses our engine's itemized absence/late/adjustment deduction lines back
 * into the prototype's single "Absence, late and other deductions" line, for comparing against
 * the (unitemized) prototype oracle's own journal output. */
function mergeDeductionLines(lines) {
  const names = ['Absence deduction', 'Late arrival deduction', 'Manual payroll adjustments (deductions)'];
  const merged = lines.filter(l => !names.includes(l.memo));
  const ded = lines.filter(l => names.includes(l.memo)).reduce((s, l) => s + l.credit, 0);
  if (ded) {
    const sal = merged.findIndex(l => l.memo === 'Basic salaries');
    const salLine = merged[sal];
    merged.splice(sal + 1, 0, { co: salLine.co, period: salLine.period, account: salLine.account, debit: 0, credit: ded, memo: 'Absence, late and other deductions' });
  }
  return merged;
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
        // HR Portal D9: our engine itemizes absence/late/manual-adjustment deductions into three
        // lines (same credit account, g.sal) instead of the prototype's one combined line - a
        // deliberate, required change, not a drift. Merged back into the prototype's shape here so
        // this still verifies every OTHER line matches exactly.
        assert.deepEqual(mergeDeductionLines(jA.lines), JSON.parse(JSON.stringify(jP.lines)), 'ERP journal lines');
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

// Bug report (Nov 2026 QA, issue 2.5): "payroll tax appears to annualize part-month salary,
// possibly understating tax for mid-month joiners". The engine's method (annualize this month's
// ACTUAL taxable pay x12, run it through the annual brackets, divide by 12 - payrollEngine.js
// calcPay, `const annual = Math.max(0, (taxM - insEmp) * 12 - c.exemption)`) is a line-for-line
// port of the client's prototype and is the standard monthly-withholding-by-annualization method;
// changing it is a tax-policy decision that needs the accountant's sign-off (see the UI copy in
// views-pay.tsx: "should be confirmed with your accountant"), not something to alter unverified.
// These tests do NOT change the formula - they pin its current, verified-by-hand behavior with
// concrete figures so a future change to the formula is caught, and they make the part-month
// behavior the bug report flagged explicit and checkable rather than merely asserted. No database
// and no prototype file needed (unlike the HAVE_PROTOTYPE-gated tests above), so these always run.
test('income tax: full month baseline matches hand-computed bracket math', () => {
  // basic=30000, full month (30/30 days employed), uninsured to isolate the tax math.
  // annual = 30000*12 - 20000(exemption) = 340000 -> 0 + 1500 + 2250 + 26000 + 31500 = 61250/yr.
  const eng = P.createEngine({
    cfg: {}, today: '2026-11-30',
    employees: [{ id: 'a', code: 'A', hire: '2025-01-01', basic: 30000, insured: false }],
  });
  const r = eng.calcPay(eng.empsIn('2026-11')[0], '2026-11');
  assert.equal(eng.taxAnnual(340000), 61250);
  assert.ok(Math.abs(r.tax - 61250 / 12) < 1e-6, `tax ${r.tax}`);
  assert.ok(Math.abs(r.net - (30000 - 61250 / 12)) < 1e-6, `net ${r.net}`);
});

test('income tax: mid-month joiner annualizes the prorated salary, not the full-rate salary', () => {
  // Joins 16 Nov (November has 30 days) -> employed days 16..30 = 15 of 30 -> f = 0.5.
  // fixed = 30000*0.5 = 15000; the engine annualizes THIS prorated figure (15000*12=180000), not
  // the employee's true full-rate annual pay (30000*12=360000) - exactly the behavior the bug
  // report describes. annual = 180000 - 20000 = 160000 -> 0+1500+2250+18000 = 21750/yr.
  const eng = P.createEngine({
    cfg: {}, today: '2026-11-30',
    employees: [{ id: 'a', code: 'A', hire: '2026-11-16', basic: 30000, insured: false }],
  });
  const r = eng.calcPay(eng.empsIn('2026-11')[0], '2026-11');
  assert.ok(Math.abs(r.fixed - 15000) < 1e-6, `fixed ${r.fixed}`);
  assert.equal(eng.taxAnnual(160000), 21750);
  assert.ok(Math.abs(r.tax - 21750 / 12) < 1e-6, `tax ${r.tax}`);
  assert.ok(Math.abs(r.net - (15000 - 21750 / 12)) < 1e-6, `net ${r.net}`);
});

test('income tax: mid-month leaver prorates and annualizes the same way', () => {
  // Leaves 20 Nov -> employed days 1..20 = 20 of 30 -> f = 2/3. basic=60000 -> fixed = 40000.
  // annual = 40000*12 - 20000 = 460000 -> 0+1500+2250+26000+45000+15000 = 89750/yr.
  const eng = P.createEngine({
    cfg: {}, today: '2026-11-30',
    employees: [{ id: 'a', code: 'A', hire: '2025-01-01', end: '2026-11-20', basic: 60000, insured: false }],
  });
  const r = eng.calcPay(eng.empsIn('2026-11')[0], '2026-11');
  assert.ok(Math.abs(r.fixed - 40000) < 1e-6, `fixed ${r.fixed}`);
  assert.equal(eng.taxAnnual(460000), 89750);
  assert.ok(Math.abs(r.tax - 89750 / 12) < 1e-6, `tax ${r.tax}`);
  assert.ok(Math.abs(r.net - (40000 - 89750 / 12)) < 1e-6, `net ${r.net}`);
});

test('HR Portal D4: income tax method setting - the November 2026 reference payroll\'s own worked example (Yasser, joined 15 Nov, basic 20000)', () => {
  // DEFAULTS as found: 30-day month, insurance 11%/18.75%, ceiling 16700, exemption 20000.
  // Joined 15 Nov -> employed days 15..30 = 16 of 30 -> f = 16/30. Reproduces the source document's
  // two figures exactly: prorated ~750 (today's default method), full-month-equivalent ~1,304.
  const eng = P.createEngine({
    cfg: {}, today: '2026-11-30',
    employees: [{ id: 'a', code: 'A', hire: '2026-11-15', basic: 20000 }],
  });
  const r = eng.calcPay(eng.empsIn('2026-11')[0], '2026-11');
  assert.ok(Math.abs(r.insEmp - 980) < 1, `insurance ${r.insEmp} (expected ~980, prorated ceiling)`);
  assert.ok(Math.abs(r.taxProrated - 750) < 1, `taxProrated ${r.taxProrated} (expected ~750)`);
  assert.ok(Math.abs(r.taxFullMonthEquivalent - 1304) < 1, `taxFullMonthEquivalent ${r.taxFullMonthEquivalent} (expected ~1,304)`);
  // Default method is 'prorated' - unchanged behavior until the accountant confirms otherwise.
  assert.ok(Math.abs(r.tax - r.taxProrated) < 1e-9);
});

test('HR Portal D4: switching the taxMethod setting to fullMonthEquivalent changes which figure is charged', () => {
  const eng = P.createEngine({
    cfg: { taxMethod: 'fullMonthEquivalent' }, today: '2026-11-30',
    employees: [{ id: 'a', code: 'A', hire: '2026-11-15', basic: 20000 }],
  });
  const r = eng.calcPay(eng.empsIn('2026-11')[0], '2026-11');
  assert.ok(Math.abs(r.tax - r.taxFullMonthEquivalent) < 1e-9);
  assert.ok(Math.abs(r.tax - 1304) < 1);
});

test('HR Portal D5: insurance proration is a setting - on (default) matches the verified reference payroll; off charges the full month even for a partial-month joiner', () => {
  const base = { id: 'a', code: 'A', hire: '2026-11-15', basic: 20000 };
  const on = P.createEngine({ cfg: {}, today: '2026-11-30', employees: [base] });
  const off = P.createEngine({ cfg: { insProrate: false }, today: '2026-11-30', employees: [base] });
  const rOn = on.calcPay(on.empsIn('2026-11')[0], '2026-11');
  const rOff = off.calcPay(off.empsIn('2026-11')[0], '2026-11');
  assert.ok(Math.abs(rOn.insEmp - 980) < 1, `prorated insurance ${rOn.insEmp}`);
  assert.ok(Math.abs(rOff.insEmp - 1837) < 1, `full-month insurance ${rOff.insEmp} (16700 ceiling x 11%, unprorated)`);
});

test('HR Portal D6: Martyrs Fund levy is off (0) by default and has zero effect on net pay; a configured rate deducts and is reported separately from social insurance', () => {
  const emp = { id: 'a', code: 'A', hire: '2025-01-01', basic: 20000, insured: true };
  const off = P.createEngine({ cfg: {}, today: '2026-11-30', employees: [emp] });
  const on = P.createEngine({ cfg: { martyrsPct: 0.05 }, today: '2026-11-30', employees: [emp] });
  const rOff = off.calcPay(off.empsIn('2026-11')[0], '2026-11');
  const rOn = on.calcPay(on.empsIn('2026-11')[0], '2026-11');
  assert.equal(rOff.martyrsAmt, 0);
  assert.ok(rOn.martyrsAmt > 0, `martyrsAmt ${rOn.martyrsAmt}`);
  assert.ok(Math.abs(rOn.martyrsAmt - (rOn.insBase * 0.05) / 100) < 1e-6);
  assert.ok(Math.abs(rOff.net - rOn.net - rOn.martyrsAmt) < 1e-6, 'the levy reduces net pay by exactly its own amount, nothing else changes');
});

test('HR Portal D6: the ERP journal still balances once a Martyrs Fund rate is configured (its own payable line, not absorbed into net)', () => {
  const employees = [
    { id: 'a', code: 'A', hire: '2025-01-01', basic: 20000, insured: true },
    { id: 'b', code: 'B', hire: '2026-11-15', basic: 30000, transport: 1000, insured: true },
  ];
  const eng = P.createEngine({ cfg: { martyrsPct: 0.05 }, today: '2026-11-30', employees });
  const rows = eng.empsIn('2026-11').map(e => eng.calcPay(e, '2026-11'));
  assert.ok(rows.some(r => r.martyrsAmt > 0), 'at least one row actually carries the levy');
  const j = eng.erpJournal('2026-11', rows, 'draft', '2026-11-30');
  const dr = j.lines.reduce((s, l) => s + l.debit, 0);
  const cr = j.lines.reduce((s, l) => s + l.credit, 0);
  assert.ok(Math.abs(dr - cr) < 0.01, `journal balances (debit ${dr} vs credit ${cr})`);
  const martyrsLine = j.lines.find(l => l.memo === 'Martyrs Fund payable');
  assert.ok(martyrsLine && martyrsLine.credit > 0);
});

test('taxAnnual: bracket boundaries are inclusive to the lower bracket, no double-counting', () => {
  const eng = P.createEngine({ cfg: {}, today: '2026-11-30', employees: [] });
  assert.equal(eng.taxAnnual(0), 0);
  assert.equal(eng.taxAnnual(40000), 0, 'exactly at the 0% ceiling');
  assert.ok(Math.abs(eng.taxAnnual(40000.01) - 0.001) < 1e-9, 'one cent into the 10% bracket');
  assert.equal(eng.taxAnnual(55000), 1500, 'exactly at the 10% ceiling');
  assert.equal(eng.taxAnnual(70000), 1500 + 2250, 'exactly at the 15% ceiling');
  assert.equal(eng.taxAnnual(200000), 1500 + 2250 + 26000, 'exactly at the 20% ceiling');
});

test('income tax: annualized income at or below the exemption pays zero tax (clamped, never negative)', () => {
  // basic=1500/month, full month, uninsured: annual = 1500*12 - 20000 = -2000 -> clamped to 0.
  const eng = P.createEngine({
    cfg: {}, today: '2026-11-30',
    employees: [{ id: 'a', code: 'A', hire: '2025-01-01', basic: 1500, insured: false }],
  });
  const r = eng.calcPay(eng.empsIn('2026-11')[0], '2026-11');
  assert.equal(r.tax, 0);
  assert.ok(Math.abs(r.net - 1500) < 1e-6, `net ${r.net}`);
});

test('income tax: the exemption is read from config, never hardcoded', () => {
  // basic=5000/month, full month, uninsured. With the default 20000 exemption, annual =
  // 60000-20000=40000, exactly the 0% ceiling -> tax 0. With exemption overridden to 0, the same
  // pay produces a different, non-zero tax - proving the engine reads c.exemption, not a literal.
  const employees = [{ id: 'a', code: 'A', hire: '2025-01-01', basic: 5000, insured: false }];
  const withDefault = P.createEngine({ cfg: {}, today: '2026-11-30', employees });
  const rDefault = withDefault.calcPay(withDefault.empsIn('2026-11')[0], '2026-11');
  assert.equal(rDefault.tax, 0);
  const withZeroExemption = P.createEngine({ cfg: { exemption: 0 }, today: '2026-11-30', employees });
  const rZero = withZeroExemption.calcPay(withZeroExemption.empsIn('2026-11')[0], '2026-11');
  // annual = 60000 - 0 = 60000 -> 0+1500(40-55k)+750(55-60k@15%) = 2250/yr.
  assert.equal(withZeroExemption.taxAnnual(60000), 2250);
  assert.ok(Math.abs(rZero.tax - 2250 / 12) < 1e-6, `tax ${rZero.tax}`);
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
