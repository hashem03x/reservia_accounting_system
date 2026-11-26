const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const XLSX = require('xlsx');

// Deal Engine (26 Nov 2026):
//   A. Pricing and commission confidentiality - only the MD, the Sales and Commercial Director and
//      Sales see any price, cost, margin, deal value or commission; BDM may set the category
//      addition % and discount % only; every other role (Technical, Procurement, Member, Marketing)
//      and users without a Deal Engine role (Finance = ERP admin, HR) cannot get a price from ANY
//      API response, export, or by filtering - checked on the raw JSON of every endpoint.
//   B. The strict 3-stage approval workflow - Technical -> Sales/BDM -> S&C Director/MD, enforced by
//      the server, atomic, with targeted invalidation and an append-only audit trail.
// Real routes, real (LOCAL) MongoDB; self-skips without TEST_DB_URI.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

const sendEmailPath = require.resolve('../../utils/sendEmail');
require.cache[sendEmailPath] = { id: sendEmailPath, filename: sendEmailPath, loaded: true, exports: async () => {} };
const ApiError = require('../../utils/apiError');
const authPath = require.resolve('../../controller/user/authController');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    protect: async (req, res, next) => {
      const id = req.header('x-test-user');
      if (!id) return next(new ApiError('You are not logged in.', 401));
      req.user = await mongoose.model('User').findById(id);
      return req.user ? next() : next(new ApiError('Unknown user.', 401));
    },
    forgotPassword: (req, res) => res.status(200).json({}),
  },
};

let User, CommercialRevision, CommercialProject, CommercialApproval, Supplier, MaterialItem;
let server, baseUrl;
const REGION = 'Cairo - 10th of Ramadan';
const INPUT = { kWp: 30, pvModuleModel: 'JKM475M-7RL3', structureType: 'Hangar Roof', acLengthM: 20, annualConsumptionKwh: 60000 };

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  CommercialRevision = require('../../models/commercial/commercialRevisionModel');
  CommercialProject = require('../../models/commercial/commercialProjectModel');
  CommercialApproval = require('../../models/commercial/commercialApprovalModel');
  Supplier = require('../../models/commercial/supplierModel');
  MaterialItem = require('../../models/commercial/materialItemModel');
  require('../../models/commercial/pricingConfigModel');
  await Promise.all([User.init(), CommercialProject.init(), MaterialItem.init(), Supplier.init()]);
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/commercial/projects', require('../../routes/commercial/projectRoute'));
  app.use('/api/v1/commercial/revisions', require('../../routes/commercial/revisionRoute'));
  app.use('/api/v1/commercial/approvals', require('../../routes/commercial/approvalRoute'));
  app.use('/api/v1/commercial/proposals', require('../../routes/commercial/proposalRoute'));
  app.use('/api/v1/commercial/dashboard', require('../../routes/commercial/dashboardRoute'));
  app.use('/api/v1/commercial/materials', require('../../routes/commercial/materialRoute'));
  app.use('/api/v1/commercial/suppliers', require('../../routes/commercial/supplierRoute'));
  app.use('/api/v1/commercial/pricing-config', require('../../routes/commercial/pricingConfigRoute'));
  app.use(require('../../middleware/errorMiddleware'));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!RUN) return;
  await new Promise(r => server.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  const names = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name);
  await Promise.all(names.map(n => mongoose.connection.collection(n).deleteMany({})));
  const { seedCommercialMaterials } = require('../../scripts/seedCommercialMaterials');
  const log = console.log;
  console.log = () => {};
  try {
    await seedCommercialMaterials({ dryRun: false, connect: false });
  } finally {
    console.log = log;
  }
});

let seq = 0;
const m = (system, role) => ({ system, role, isActive: true });
async function makeUser(name, memberships) {
  seq += 1;
  return User.create({ name, email: `${name.toLowerCase().replace(/\s+/g, '.')}.${seq}@reservia.test`, password: 'x', role: 'operator', type: 'online', systemMemberships: memberships });
}
async function api(method, url, { user, body, form, raw } = {}) {
  const headers = { ...(user ? { 'x-test-user': String(user._id) } : {}), ...(form ? {} : { 'Content-Type': 'application/json' }) };
  const res = await fetch(`${baseUrl}${url}`, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
  if (raw) return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, text };
}
async function team() {
  return {
    md: await makeUser('Ahmed MD', [m('COMMERCIAL', 'md')]),
    cd: await makeUser('Mona Director', [m('COMMERCIAL', 'commercial_director')]),
    sales: await makeUser('Sara Sales', [m('COMMERCIAL', 'sales')]),
    bdm: await makeUser('Bassem BDM', [m('COMMERCIAL', 'bdm')]),
    tech: await makeUser('Tarek Tech', [m('COMMERCIAL', 'technical')]),
    tech2: await makeUser('Tamer Tech', [m('COMMERCIAL', 'technical')]),
    proc: await makeUser('Pia Procurement', [m('COMMERCIAL', 'procurement')]),
    member: await makeUser('Mai Member', [m('COMMERCIAL', 'member')]),
    marketing: await makeUser('Marwa Marketing', [m('COMMERCIAL', 'marketing')]),
    finance: await makeUser('Fadi Finance', [m('ERP', 'admin')]),
    hr: await makeUser('Hala HR', [m('HR', 'hr')]),
  };
}
async function deal(t, input = INPUT, extra = {}) {
  const customer = await User.create({ name: `Customer ${++seq}`, phone: `0100000${String(seq).padStart(4, '0')}`, role: 'user', type: 'offline', isOffline: true });
  const p = await api('POST', '/api/v1/commercial/projects', { user: t.md, body: { name: 'Confidential deal', customer: customer._id, country: 'Egypt', region: REGION, category: 'On-Grid C&I', scope: 'Supply & Installation', estimatedValueEgp: 987654, ...extra } });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const r = await api('POST', `/api/v1/commercial/revisions/project/${p.body.data.project._id}`, { user: t.tech, body: { engineeringInput: input } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { project: p.body.data.project, revision: r.body.data };
}

// --- money detection on raw API responses ------------------------------------------------------
const MONEY_KEYS = /^(unitPrice|total|boqTotal|autoUnitPrice|foreignPrice|netExclVat|grossInclVat|vatAmt|cogs|salesBonusPct|salesBonusAmt|engineeringIncentivePct|engineeringIncentiveAmt|overheadPct|overheadAmt|profitPct|profitAmt|contingencyPct|contingencyAmt|grossProfit|grossProfitPct|operatingProfit|poolAmt|basePrice|perKwpExclVat|price|priceInfo|pricePerWatt|pricePerM|totalCost|totalModuleCost|supplierPrices|priceHistory|supplierName|supplierCode|priceSource|estimatedValueEgp|wonValueEgp|erpBudget|valueSnapshot|levers|pricingConfigApplied|feasibility|amount|acPricePerMOverride|totalEstimatedMaterialCost|totalEstimatedProjectValue|expectedGrossProfit|averageMarginPct)$/;
function moneyPaths(v, path = '', out = [], allowPricing = false) {
  if (Array.isArray(v)) v.forEach((x, i) => moneyPaths(x, `${path}[${i}]`, out, allowPricing));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (allowPricing && k === 'pricing' && x && typeof x === 'object') {
        const extra = Object.keys(x).filter(key => !['categoryAdditionPct', 'discountPct', 'discountAboveAuthority'].includes(key));
        if (extra.length) out.push(`${path}.pricing{${extra.join(',')}}`);
        continue;
      }
      if (MONEY_KEYS.test(k) || k === 'pricing') out.push(`${path}.${k}`);
      else moneyPaths(x, `${path}.${k}`, out, allowPricing);
    }
  }
  return out;
}
/** Every BOQ price/total the MD sees - none may appear anywhere in another role's raw response text. */
function priceNumbers(mdRevision) {
  const nums = new Set();
  for (const l of mdRevision.boqLines) for (const v of [l.unitPrice, l.total]) if (typeof v === 'number' && v >= 1000) nums.add(String(v));
  for (const v of [mdRevision.boqTotal, mdRevision.pricing?.netExclVat, mdRevision.pricing?.salesBonusAmt]) if (typeof v === 'number') nums.add(String(Math.round(v)));
  return [...nums];
}
function assertNoMoney(label, res, mdNumbers, { allowPricing = false } = {}) {
  const paths = moneyPaths(res.body, '', [], allowPricing);
  assert.deepEqual(paths, [], `${label}: money fields leaked: ${paths.slice(0, 8).join(', ')}`);
  // Whole numbers only (not part of a longer number); distinctive amounts only - a round 1000 is also
  // an MPPT voltage, so it proves nothing.
  const leaked = mdNumbers.filter(n => (Number(n) >= 10000 || Number(n) % 100 !== 0) && new RegExp(`(^|[^0-9.])${n.replace('.', '\.')}([^0-9]|$)`).test(res.text));
  assert.deepEqual(leaked, [], `${label}: price values leaked in the raw response: ${leaked.join(', ')}`);
}

// ================================================================================== A. pricing

maybeTest('A1: MD, S&C Director and Sales see prices, commission and margins; every other role and Finance/HR get none - on every endpoint (incl. historical revisions, exports, filters)', async () => {
  const t = await team();
  const { project, revision } = await deal(t);
  // A second revision so revision 1 is historical.
  await api('POST', `/api/v1/commercial/revisions/project/${project._id}`, { user: t.tech, body: { engineeringInput: { ...INPUT, kWp: 31 } } });
  const mdRev = (await api('GET', `/api/v1/commercial/revisions/${revision._id}`, { user: t.md })).body.data;
  assert.ok(mdRev.pricing.salesBonusAmt > 0 && mdRev.boqTotal > 0, 'the MD sees the commission and BOQ total');
  const nums = priceNumbers(mdRev);
  assert.ok(nums.length > 5);

  for (const role of ['cd', 'sales']) {
    const r = (await api('GET', `/api/v1/commercial/revisions/${revision._id}`, { user: t[role] })).body.data;
    assert.ok(r.pricing.salesBonusPct > 0 && r.pricing.netExclVat > 0 && r.boqLines.some(l => l.unitPrice > 0), `${role} sees pricing and commission`);
  }

  const endpoints = [
    ['project', `/api/v1/commercial/projects/${project._id}`],
    ['projects list', '/api/v1/commercial/projects'],
    ['historical revision', `/api/v1/commercial/revisions/${revision._id}`],
    ['revision list', `/api/v1/commercial/projects/${project._id}/revisions`],
    ['dashboard', '/api/v1/commercial/dashboard'],
    ['approval workflow', `/api/v1/commercial/approvals/${revision._id}/workflow`],
    ['approval log', `/api/v1/commercial/approvals/${revision._id}/log`],
    ['materials', '/api/v1/commercial/materials?limit=500'],
  ];
  for (const role of ['bdm', 'tech', 'proc', 'member', 'marketing']) {
    for (const [label, url] of endpoints) {
      // eslint-disable-next-line no-await-in-loop
      const res = await api('GET', url, { user: t[role] });
      if (res.status === 403) continue; // refused outright is fine too
      assert.equal(res.status, 200, `${role} ${label}: ${res.status} ${res.text.slice(0, 200)}`);
      assertNoMoney(`${role} ${label}`, res, nums, { allowPricing: role === 'bdm' });
    }
    // Price filtering / sorting on Materials can not reveal prices by bisection.
    const all = (await api('GET', '/api/v1/commercial/materials?limit=500', { user: t[role] })).body;
    const filtered = await api('GET', '/api/v1/commercial/materials?limit=500&unitPrice[gte]=99999999&sort=-unitPrice', { user: t[role] });
    if (filtered.status === 200) assert.equal(filtered.body.results, all.results, `${role}: a price filter is ignored`);
  }

  // Pricing-only endpoints are refused outright.
  for (const role of ['bdm', 'tech', 'proc', 'member', 'marketing', 'finance', 'hr']) {
    for (const url of ['/api/v1/commercial/pricing-config', '/api/v1/commercial/pricing-config/rates-matrix?country=Egypt', '/api/v1/commercial/pricing-config/history']) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal((await api('GET', url, { user: t[role] })).status, 403, `${role} ${url}`);
    }
  }
  for (const role of ['sales', 'md', 'cd']) assert.equal((await api('GET', '/api/v1/commercial/pricing-config', { user: t[role] })).status, 200, role);
  for (const role of ['bdm', 'tech', 'proc', 'member', 'marketing']) {
    assert.equal((await api('GET', `/api/v1/commercial/proposals/project/${project._id}`, { user: t[role] })).status, 403, `${role} proposals`);
    assert.equal((await api('GET', `/api/v1/commercial/proposals/revision/${revision._id}/preview`, { user: t[role] })).status, 403, `${role} proposal preview`);
  }
  // Finance and HR have no Deal Engine role at all.
  for (const role of ['finance', 'hr']) {
    assert.equal((await api('GET', `/api/v1/commercial/projects/${project._id}`, { user: t[role] })).status, 403);
    assert.equal((await api('GET', `/api/v1/commercial/revisions/${revision._id}/boq-export?format=csv`, { user: t[role] })).status, 403);
  }

  // BDM: pricing reduced to the two percentages it may set.
  const bdmRev = (await api('GET', `/api/v1/commercial/revisions/${revision._id}`, { user: t.bdm })).body.data;
  assert.deepEqual(Object.keys(bdmRev.pricing).sort(), ['categoryAdditionPct', 'discountAboveAuthority', 'discountPct']);
  // Technical keeps the engineering: quantities, specs, the engineering result without money.
  const techRev = (await api('GET', `/api/v1/commercial/revisions/${revision._id}`, { user: t.tech })).body.data;
  assert.ok(techRev.boqLines.find(l => l.component === 'PV Modules').qty > 0);
  assert.ok(techRev.engineeringResult.inverter.ratedKw > 0 && techRev.engineeringResult.dcAcRatio > 0);
  assert.equal(techRev.engineeringResult.inverter.price, undefined);
});

maybeTest('A2: BOQ export - prices for MD/S&C/Sales; a technical-only file (no price, supplier or pricing column, no amount in text) for Technical/Procurement/BDM; refused for Finance/HR', async () => {
  const t = await team();
  const { revision } = await deal(t);
  const mdRev = (await api('GET', `/api/v1/commercial/revisions/${revision._id}`, { user: t.md })).body.data;
  const nums = priceNumbers(mdRev);
  const full = (await api('GET', `/api/v1/commercial/revisions/${revision._id}/boq-export?format=csv`, { user: t.sales, raw: true })).buffer.toString('utf8');
  assert.ok(full.split('\r\n')[0].includes('Unit Price') && full.includes('BOQ TOTAL'));
  for (const role of ['tech', 'proc', 'bdm']) {
    for (const format of ['csv', 'xlsx']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await api('GET', `/api/v1/commercial/revisions/${revision._id}/boq-export?format=${format}`, { user: t[role], raw: true });
      assert.equal(res.status, 200, `${role} ${format}`);
      assert.match(res.headers.get('content-disposition'), /_technical\./);
      const text = format === 'csv' ? res.buffer.toString('utf8') : (() => {
        const wb = XLSX.read(res.buffer, { type: 'buffer' });
        return wb.SheetNames.map(n => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
      })();
      for (const col of ['Unit Price', 'Total Price', 'Supplier Name', 'Exchange Rate', 'Pricing Source', 'Net price', 'BOQ TOTAL']) assert.ok(!text.includes(col), `${role} ${format}: ${col}`);
      assert.ok(text.includes('Quantity') && text.includes('PV Modules'));
      assert.ok(!/\d\s*EGP/.test(text), `${role} ${format}: an EGP amount in the text`);
      assert.deepEqual(nums.filter(n => text.includes(n)), [], `${role} ${format}: price values`);
    }
  }
});

maybeTest('A3: write side - non-pricing roles can not set a price, re-apply pricing, or read/upload price lists; their stored price inputs are kept; BDM sets category/discount only', async () => {
  const t = await team();
  const { revision } = await deal(t, { ...INPUT, acPricePerMOverride: 1250 });
  const tech = (path, body) => api('PATCH', `/api/v1/commercial/revisions/${revision._id}`, { user: t.tech, body });
  const techView = (await api('GET', `/api/v1/commercial/revisions/${revision._id}`, { user: t.tech })).body.data;
  assert.equal(techView.engineeringInput.acPricePerMOverride, undefined, 'the price input is not shown to Technical');
  assert.equal((await tech('', { engineeringInput: { ...techView.engineeringInput, acPricePerMOverride: 1 } })).status, 403);
  assert.equal((await tech('', { engineeringInput: techView.engineeringInput, manualOverrides: { 'AC Cable': { unitPrice: 5 } } })).status, 403);
  assert.equal((await tech('', { applyCurrentConfig: true })).status, 403);
  assert.equal((await tech('', { engineeringInput: techView.engineeringInput, pricingOverrides: { discountPct: 0.01 } })).status, 403);
  // Technical re-estimates (kWp) - the hidden price input is preserved, not wiped.
  const ok = await tech('', { engineeringInput: { ...techView.engineeringInput, kWp: 32 }, manualOverrides: { 'Cable Tray': { qty: 9 } } });
  assert.equal(ok.status, 200, ok.text);
  const stored = await CommercialRevision.findById(revision._id).lean();
  assert.equal(stored.engineeringInput.acPricePerMOverride, 1250);
  assert.equal(stored.engineeringInput.kWp, 32);
  assertNoMoney('technical recompute response', ok, priceNumbers(stored));

  // BDM: category addition / discount yes, levers no.
  assert.equal((await api('PATCH', `/api/v1/commercial/revisions/${revision._id}`, { user: t.bdm, body: { pricingOverrides: { overheadPct: 0.2 } } })).status, 403);
  const b = await api('PATCH', `/api/v1/commercial/revisions/${revision._id}`, { user: t.bdm, body: { pricingOverrides: { categoryAdditionPct: 0.12 } } });
  assert.equal(b.status, 200, b.text);
  assert.deepEqual(Object.keys(b.body.data.pricing).sort(), ['categoryAdditionPct', 'discountAboveAuthority', 'discountPct']);
  assert.equal((await CommercialRevision.findById(revision._id).lean()).pricing.categoryAdditionPct, 0.12);

  // Supplier price lists: Procurement / BDM / Technical refused (read and upload); Sales reads.
  const sup = await Supplier.create({ code: 'SUP-0700', legalName: 'Delta Solar', status: 'Approved', contacts: [{ name: 'X', phone: '01011112222' }] });
  for (const role of ['proc', 'bdm', 'tech']) {
    assert.equal((await api('GET', `/api/v1/commercial/suppliers/${sup._id}/price-lists`, { user: t[role] })).status, 403, role);
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from('Category,Brand,Model,Unit price\nPV Modules,A,B,1\n')]), 'x.csv');
    assert.equal((await api('POST', `/api/v1/commercial/suppliers/${sup._id}/price-lists/preview`, { user: t[role], form: fd })).status, 403, role);
    assert.equal((await api('POST', `/api/v1/commercial/suppliers/${sup._id}/price-lists/discount`, { user: t[role], body: { pct: 5 } })).status, 403, role);
  }
  assert.equal((await api('GET', `/api/v1/commercial/suppliers/${sup._id}/price-lists`, { user: t.sales })).status, 200);

  // Materials: Procurement edits technical data, never a price; creating an item (it has a price) is a pricing action.
  const item = await MaterialItem.findOne({ category: 'PV Modules' }).lean();
  assert.equal((await api('PATCH', `/api/v1/commercial/materials/${item._id}`, { user: t.proc, body: { unitPrice: 1 } })).status, 403);
  const spec = await api('PATCH', `/api/v1/commercial/materials/${item._id}`, { user: t.proc, body: { attrs: { maxDcV: 1500 } } });
  assert.equal(spec.status, 200, spec.text);
  assert.equal(spec.body.data.unitPrice, undefined);
  assert.equal((await api('POST', '/api/v1/commercial/materials', { user: t.proc, body: { category: 'PV Modules', brand: 'X', model: 'Y', unit: 'pcs', unitPrice: 10 } })).status, 403);
  // Pricing Config is managed by the MD / S&C Director only - an ERP admin (Finance) no longer.
  assert.equal((await api('PUT', '/api/v1/commercial/pricing-config', { user: t.finance, body: { note: 'x' } })).status, 403);
});

// ================================================================================== B. approvals

const decide = (user, revId, stage, status, note) => api('PATCH', `/api/v1/commercial/approvals/${revId}/${stage}`, { user, body: { status, ...(note ? { note } : {}) } });

maybeTest('B1: Technical -> Sales/BDM -> Final Commercial, in order, by the right roles only; atomic; Fully Approved only after all three', async () => {
  const t = await team();
  const { revision } = await deal(t);
  const id = revision._id;
  assert.equal(revision.approvalWorkflow, 2);

  assert.equal((await decide(t.bdm, id, 'STAGE2', 'Approved')).status, 400, 'Stage 2 before Stage 1');
  assert.equal((await decide(t.cd, id, 'STAGE3', 'Approved')).status, 400, 'Stage 3 before Stage 1/2');
  assert.equal((await decide(t.sales, id, 'STAGE1', 'Approved')).status, 403, 'Sales can not sign Stage 1');
  assert.equal((await decide(t.md, id, 'STAGE1', 'Approved')).status, 403, 'MD can not sign Stage 1');
  assert.equal((await decide(t.tech, id, 'STAGE1', 'Rejected')).status, 400, 'a rejection needs a reason');

  // Concurrent duplicate Stage 1 approvals: exactly one succeeds, one audit record.
  const [a, b] = await Promise.all([decide(t.tech, id, 'STAGE1', 'Approved'), decide(t.tech2, id, 'STAGE1', 'Approved')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(await CommercialApproval.countDocuments({ revision: id, stage: 'STAGE1', action: 'Approved' }), 1);
  // The Technical approver got no money back.
  assertNoMoney('stage 1 response', a.status === 200 ? a : b, []);

  assert.equal((await decide(t.cd, id, 'STAGE3', 'Approved')).status, 400, 'Stage 3 before Stage 2');
  assert.equal((await decide(t.sales, id, 'STAGE2', 'Approved')).status, 403, 'a Sales Engineer only on a deal they own');
  assert.equal((await decide(t.bdm, id, 'STAGE2', 'Approved')).status, 200);
  for (const role of ['bdm', 'tech', 'sales', 'proc']) assert.equal((await decide(t[role], id, 'STAGE3', 'Approved')).status, 403, `${role} can not give the final approval`);
  const fin = await decide(t.cd, id, 'STAGE3', 'Approved');
  assert.equal(fin.status, 200, fin.text);
  const r = await CommercialRevision.findById(id).lean();
  assert.equal(r.releaseStatus, 'APPROVED FOR ISSUE');
  assert.equal(r.finalApproval.byName, 'Mona Director');
  assert.equal(r.finalApproval.revisionNumber, 1);
  assert.ok(r.finalApproval.basis.technical && r.finalApproval.basis.commercial);
  const view = (await api('GET', `/api/v1/commercial/approvals/${id}/workflow`, { user: t.tech })).body.data;
  assert.equal(view.workflowStatus, 'Fully Approved');
  assert.deepEqual(view.stages.map(x => x.status), ['Approved', 'Approved', 'Approved']);
  assert.deepEqual(view.stages.map(x => x.approverName).slice(1), ['Bassem BDM', 'Mona Director']);
  assert.equal((await decide(t.md, id, 'STAGE3', 'Approved')).status, 409, 'no duplicate final approval');
  const log = await CommercialApproval.find({ revision: id }).sort({ createdAt: 1 }).lean();
  assert.deepEqual(log.map(l => [l.stage, l.action, l.approverRole, l.revisionNumber]), [['STAGE1', 'Approved', 'technical', 1], ['STAGE2', 'Approved', 'bdm', 1], ['MD', 'Approved', 'commercial_director', 1]]);
  assert.equal(log[2].workflowBefore, 'Awaiting Final Commercial Approval');
  assert.equal(log[2].workflowAfter, 'Fully Approved');
  await assert.rejects(CommercialApproval.updateOne({ _id: log[0]._id }, { $set: { note: 'edited' } }), /immutable/);
  await assert.rejects(CommercialApproval.deleteOne({ _id: log[0]._id }), /immutable/);
});

maybeTest('B2: targeted invalidation - no-op recalculation keeps everything; prices reset Stage 3 only; customer inputs Stages 2-3; engineering all three; history kept', async () => {
  const t = await team();
  const { revision } = await deal(t);
  const id = revision._id;
  const approveAll = async () => {
    for (const [u, s] of [[t.tech, 'STAGE1'], [t.bdm, 'STAGE2'], [t.cd, 'STAGE3']]) {
      const cur = await CommercialRevision.findById(id).lean();
      if (cur[{ STAGE1: 'stage1', STAGE2: 'stage2', STAGE3: 'md' }[s]].status === 'Approved') continue;
      // eslint-disable-next-line no-await-in-loop
      const r = await decide(u, id, s, 'Approved');
      assert.equal(r.status, 200, `${s}: ${r.text}`);
    }
  };
  const statuses = async () => {
    const r = await CommercialRevision.findById(id).lean();
    return [r.stage1.status, r.stage2.status, r.md.status, r.releaseStatus];
  };
  await approveAll();
  const input = (await CommercialRevision.findById(id).lean()).engineeringInput;

  // Recalculating with nothing changed keeps every approval.
  const same = await api('PATCH', `/api/v1/commercial/revisions/${id}`, { user: t.md, body: { engineeringInput: input } });
  assert.equal(same.status, 200, same.text);
  assert.deepEqual(await statuses(), ['Approved', 'Approved', 'Approved', 'APPROVED FOR ISSUE']);

  // A pricing change after Stage 2 -> only the final commercial approval must be repeated.
  const price = await api('PATCH', `/api/v1/commercial/revisions/${id}`, { user: t.cd, body: { pricingOverrides: { categoryAdditionPct: 0.11 } } });
  assert.equal(price.status, 200, price.text);
  assert.deepEqual(await statuses(), ['Approved', 'Approved', 'Pending', 'NOT RELEASED']);
  let r = await CommercialRevision.findById(id).lean();
  assert.equal(r.md.requiresReapproval, true);
  assert.equal(r.finalApproval.approvedAt, null);
  assert.deepEqual(price.body.data.recalcSummary.approvalsReset, ['MD']);
  await approveAll();
  assert.deepEqual(await statuses(), ['Approved', 'Approved', 'Approved', 'APPROVED FOR ISSUE']);

  // A customer input -> Stages 2 and 3.
  const cust = await api('PATCH', `/api/v1/commercial/revisions/${id}`, { user: t.md, body: { engineeringInput: { ...input, annualConsumptionKwh: 70000 } } });
  assert.equal(cust.status, 200, cust.text);
  assert.deepEqual((await statuses()).slice(0, 3), ['Approved', 'Pending', 'Pending']);
  // Same people may not re-sign a different stage; the BDM re-signs Stage 2, the MD the final (S&C signed before - one stage each is per decision state).
  await approveAll();

  // An engineering input -> all three.
  const eng = await api('PATCH', `/api/v1/commercial/revisions/${id}`, { user: t.tech, body: { engineeringInput: { ...input, annualConsumptionKwh: 70000, kWp: 33 } } });
  assert.equal(eng.status, 200, eng.text);
  assert.deepEqual(await statuses(), ['Pending', 'Pending', 'Pending', 'NOT RELEASED']);
  r = await CommercialRevision.findById(id).lean();
  assert.ok(r.stage1.requiresReapproval && r.stage2.requiresReapproval && r.md.requiresReapproval);
  const view = (await api('GET', `/api/v1/commercial/approvals/${id}/workflow`, { user: t.md })).body.data;
  assert.deepEqual(view.stages.map(s => s.displayStatus), ['Requires Reapproval', 'Requires Reapproval', 'Requires Reapproval']);
  assert.equal(view.workflowStatus, 'Awaiting Technical Approval');

  // History kept: every decision and every reset, in order.
  const log = await CommercialApproval.find({ revision: id }).sort({ createdAt: 1 }).lean();
  assert.ok(log.filter(l => l.action === 'Approved').length >= 6);
  assert.ok(log.filter(l => l.action === 'Reset').length >= 6);
  assert.ok(view.timeline.some(e => e.action === 'Reset') && view.timeline.some(e => e.kind === 'revision'));

  // A stale approval (revision recalculated after the approver opened it) is refused.
  const stale = await api('PATCH', `/api/v1/commercial/approvals/${id}/STAGE1`, { user: t.tech, body: { status: 'Approved', expectedCalculatedAt: '2020-01-01T00:00:00.000Z' } });
  assert.equal(stale.status, 409);
});

maybeTest('B3: above the MD threshold the final approval is the MD\'s; a Stage 1 rejection returns the deal for technical revisions until a technical change resubmits it', async () => {
  const t = await team();
  const { revision } = await deal(t, { ...INPUT, kWp: 80 });
  const id = revision._id;
  assert.equal((await decide(t.tech, id, 'STAGE1', 'Rejected', 'Inverter loading too low')).status, 200);
  let view = (await api('GET', `/api/v1/commercial/approvals/${id}/workflow`, { user: t.bdm })).body.data;
  assert.equal(view.workflowStatus, 'Returned for technical revisions');
  assert.equal(view.stages[0].note, 'Inverter loading too low');
  assert.equal((await decide(t.bdm, id, 'STAGE2', 'Approved')).status, 400);
  // A pricing-only change does not resubmit a technical rejection...
  await api('PATCH', `/api/v1/commercial/revisions/${id}`, { user: t.cd, body: { pricingOverrides: { discountPct: 0.01 } } });
  assert.equal((await CommercialRevision.findById(id).lean()).stage1.status, 'Rejected');
  // ...a technical correction does.
  const input = (await CommercialRevision.findById(id).lean()).engineeringInput;
  await api('PATCH', `/api/v1/commercial/revisions/${id}`, { user: t.tech, body: { engineeringInput: { ...input, kWp: 78 } } });
  view = (await api('GET', `/api/v1/commercial/approvals/${id}/workflow`, { user: t.tech })).body.data;
  assert.equal(view.workflowStatus, 'Awaiting Technical Approval');
  assert.equal(view.stages[0].canAct, true);
  assert.equal((await decide(t.tech, id, 'STAGE1', 'Approved')).status, 200);
  assert.equal((await decide(t.bdm, id, 'STAGE2', 'Approved')).status, 200);
  const cd = await decide(t.cd, id, 'STAGE3', 'Approved');
  assert.equal(cd.status, 403);
  assert.match(cd.body.message, /above the MD approval threshold/);
  assert.ok(!/\d{6}/.test(cd.body.message), 'no amount in the refusal');
  assert.equal((await decide(t.md, id, 'STAGE3', 'Approved')).status, 200);
  assert.equal((await CommercialRevision.findById(id).lean()).releaseStatus, 'APPROVED FOR ISSUE');
});

maybeTest('B4: a revision priced before the 3-stage workflow keeps its earlier rules until its next recalculation moves it to workflow 2', async () => {
  const t = await team();
  const { revision } = await deal(t);
  await mongoose.connection.collection('commercialrevisions').updateOne({ _id: new mongoose.Types.ObjectId(revision._id) }, { $unset: { approvalWorkflow: '', approvalBasis: '' } });
  const view = (await api('GET', `/api/v1/commercial/approvals/${revision._id}/workflow`, { user: t.md })).body.data;
  assert.equal(view.workflowVersion, 1);
  assert.equal((await decide(t.bdm, revision._id, 'STAGE1', 'Approved')).status, 200, 'the earlier rules: BDM may sign Stage 1');
  const input = (await CommercialRevision.findById(revision._id).lean()).engineeringInput;
  await api('PATCH', `/api/v1/commercial/revisions/${revision._id}`, { user: t.md, body: { engineeringInput: input } });
  const r = await CommercialRevision.findById(revision._id).lean();
  assert.equal(r.approvalWorkflow, 2);
  assert.equal(r.stage1.status, 'Pending', 'its earlier sign-off is reset on the move');
  assert.equal((await decide(t.bdm, revision._id, 'STAGE1', 'Approved')).status, 403, 'now Technical only');
});
