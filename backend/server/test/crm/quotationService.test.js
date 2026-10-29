const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let Lead, Quotation, leadService, quotationService;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  require('../../models/crm/activityModel');
  require('../../models/crm/stageHistoryModel');
  Quotation = require('../../models/crm/quotationModel');
  await Promise.all([Lead.init(), Quotation.init()]);
  leadService = require('../../services/crm/leadService');
  quotationService = require('../../services/crm/quotationService');
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await Promise.all([Lead.deleteMany({}), Quotation.deleteMany({})]);
});

maybeTest("createQuotation: a persisted single-line farm-package quote at 5% discount reconciles the brief's own EGP 1,072,071 acceptance figure", async () => {
  const { lead } = await leadService.intakeLead({ phone: '01066677788', channel: 'phone', segment: 'farm' });
  const quotation = await quotationService.createQuotation(lead._id, {
    items: [{ description: 'Farm package', unitPriceEgp: 989908.59, quantity: 1, discountPercent: 5 }],
  });
  assert.equal(quotation.total, 1072071);
  assert.equal(quotation.version, 1);
  assert.equal(quotation.status, 'draft');
});

maybeTest('createQuotation: multi-line totals are the sum of each line, not a recomputation against the combined subtotal', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01077788899', channel: 'phone' });
  const quotation = await quotationService.createQuotation(lead._id, {
    items: [
      { description: 'Panels', unitPriceEgp: 50000, quantity: 2, discountPercent: 0 },
      { description: 'Inverter', unitPriceEgp: 20000, quantity: 1, discountPercent: 10 },
    ],
    vatPercent: 14,
  });
  // Panels: 100,000 -> 0 discount -> VAT 14,000 -> 114,000
  // Inverter: 20,000 -> 2,000 discount -> 18,000 -> VAT 2,520 -> 20,520
  assert.equal(quotation.subtotal, 120000);
  assert.equal(quotation.discountAmount, 2000);
  assert.equal(quotation.vatAmount, 16520);
  assert.equal(quotation.total, 134520);
});

maybeTest('sendQuotation: sending a draft quote moves an early-stage lead to Proposal sent', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01088899900', channel: 'phone' });
  await leadService.changeStage(lead._id, { to: 'contacted' }, { role: 'sales' });
  await leadService.changeStage(lead._id, { to: 'qualified', followUpAt: new Date() }, { role: 'sales' });

  const quotation = await quotationService.createQuotation(lead._id, { items: [{ description: 'Kit', unitPriceEgp: 100000, quantity: 1 }] });
  await quotationService.sendQuotation(quotation._id, { role: 'sales' });

  const fresh = await Lead.findById(lead._id).lean();
  assert.equal(fresh.stage, 'proposal_sent');
});

maybeTest('acceptQuotation: accepting a quote sets the lead\'s valueEgp to the quoted total', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01099900011', channel: 'phone' });
  const quotation = await quotationService.createQuotation(lead._id, { items: [{ description: 'Kit', unitPriceEgp: 200000, quantity: 1 }] });
  await quotationService.acceptQuotation(quotation._id);

  const fresh = await Lead.findById(lead._id).lean();
  assert.equal(fresh.valueEgp, 228000); // 200,000 + 14% VAT
});
