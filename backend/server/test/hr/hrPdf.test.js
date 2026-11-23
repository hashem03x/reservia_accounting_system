'use strict';

// Payslip PDF rounding (hrPdf.js#slipRows): "Total earnings"/"Net pay" must be the SUM of the
// already-rounded (whole-EGP) line items printed above them, never a fresh rounding of the raw
// r.earn/r.net figure - otherwise the printed line items can foot to a different total than the
// printed total, exactly like the register PDF already avoids (registerTable sums the displayed
// cells). Pure - no database, no PDF rendering (slipRows only builds the row data, not the PDF).

const test = require('node:test');
const assert = require('node:assert/strict');
const { slipRows } = require('../../services/hr/hrPdf');

const cfg = { insEmp: 11, martyrsPct: 0, otDay: 1.35, otNight: 1.7, otFri: 2, otSat: 1.5, otHol: 3 };

function row(overrides = {}) {
  return Object.assign(
    {
      t: { emp: 30, late: 0 },
      basic: 1000.4,
      transport: 500.4,
      incentive: 0,
      other: 0,
      comm: 0,
      tgt: 0,
      otD: 0,
      otN: 0,
      otF: 0,
      otS: 0,
      otH: 0,
      hr: 0,
      absDed: 0,
      unpaidDays: 0,
      lateDed: 0,
      insBase: 1500.8,
      insEmp: 165.09,
      martyrsAmt: 0,
      tax: 0,
      // Deliberately the TRUE unrounded figures - a stale/independently-computed r.earn/r.net
      // must never be what gets printed; only the sum of the rows above it may be.
      earn: 1500.8,
      net: 1335.71,
    },
    overrides
  );
}

test('Total earnings is the sum of the already-rounded earnings line items, not a fresh rounding of r.earn', () => {
  const r = row();
  const rows = slipRows(r, '2026-09', cfg, {});
  // Basic 1000.4 -> 1000, Transport 500.4 -> 500 (each individually rounds down); their sum is
  // 1500, NOT round(1500.8) = 1501, which is what the old code printed.
  const basicLine = rows.find(x => x[0].startsWith('Basic'));
  const transportLine = rows.find(x => x[0] === 'Transportation allowance');
  assert.equal(basicLine[1], '1,000');
  assert.equal(transportLine[1], '500');
  const totalLine = rows.find(x => x[0] === 'Total earnings');
  assert.equal(totalLine[1], '1,500', 'total must foot to the sum of the printed lines, not round(r.earn)');
});

test('Net pay is (summed rounded earnings) - (summed rounded deductions), not a fresh rounding of r.net', () => {
  const r = row();
  const rows = slipRows(r, '2026-09', cfg, {});
  // Insurance 165.09 -> 165 (rounds down). Net = 1500 (earnings) - 165 (insurance) = 1335,
  // NOT round(1335.71) = 1336, which is what the old code printed.
  const insLine = rows.find(x => x[0].startsWith('Social insurance'));
  assert.equal(insLine[1], '-165');
  const netLine = rows.find(x => x[0] === 'Net pay (EGP)');
  assert.equal(netLine[1], '1,335', 'net pay must foot to earnings-sum minus deductions-sum, not round(r.net)');
});

test('every earnings and deduction component (adjustments, visits, overtime) is folded into the printed total/net, in whichever direction it applies', () => {
  const r = row({ incentive: 300, otD: 2, hr: 100 });
  const extras = {
    visits: [{ v: { date: '2026-09-05', city: 'Cairo' }, allow: 250, pd: 0, tr: 50 }],
    adjustments: [
      { type: 'add', label: 'Bonus', amount: 100.6, taxable: true },
      { type: 'ded', label: 'Advance recovery', amount: 75.4 },
    ],
  };
  const rows = slipRows(r, '2026-09', cfg, extras);
  // Earnings: 1000 (basic) + 500 (transport) + 300 (incentive) + overtime 100*2*1.35=270 (exact) +
  // visit 250 + visit transport 50 + bonus 100.6->101 = 2471.
  const total = rows.find(x => x[0] === 'Total earnings');
  assert.equal(total[1], '2,471');
  // Deductions: insurance 165 + advance recovery 75.4->75 = 240. Net = 2471 - 240 = 2231.
  const net = rows.find(x => x[0] === 'Net pay (EGP)');
  assert.equal(net[1], '2,231');
});
