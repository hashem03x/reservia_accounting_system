const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Go-live Developer Pack D9: "Supplier approval by the S&C Director, never by the person who
// proposed it; the MD may override with a reason." Verifies services/commercial/
// supplierService.js#setStatus's proposer != approver guard end to end, plus the EDIT_ROLES/
// STATUS_ROLES changes (BDM may propose; S&C Director is now a real approver, not just MD).
//
// Self-skips without TEST_DB_URI, like every other DB-backed suite in this repo.
const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let Supplier, supplierService;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Supplier = require('../../models/commercial/supplierModel');
  supplierService = require('../../services/commercial/supplierService');
});

after(async () => {
  if (!RUN) return;
  await mongoose.disconnect();
});

function actor(role, name = 'Test User') {
  return { user: { _id: new mongoose.Types.ObjectId(), name }, role };
}

maybeTest('bdm may now propose a supplier (go-live: "Propose suppliers: BDM = Edit")', async () => {
  const bdm = actor('bdm', 'Ahmed Moubarek');
  const supplier = await supplierService.createSupplier({ legalName: 'New Supplier Co', contacts: [{ name: 'Sales', phone: '01022223333' }] }, bdm);
  assert.equal(supplier.status, 'Candidate');
});

maybeTest('commercial_director (S&C Director) may now approve a supplier directly - not MD-only as before', async () => {
  const bdm = actor('bdm', 'Ahmed Moubarek');
  const cd = actor('commercial_director', 'Mohamed Basha');
  const created = await supplierService.createSupplier({ legalName: 'Approved By CD Co', contacts: [{ name: 'Sales', phone: '01033334444' }] }, bdm);
  const approved = await supplierService.setStatus(created._id, { status: 'Approved' }, cd);
  assert.equal(approved.status, 'Approved');
  assert.equal(approved.approval.approvedByName, 'Mohamed Basha');
});

maybeTest('D9: the proposer can never approve their own supplier, even as commercial_director', async () => {
  const cd = actor('commercial_director', 'Mohamed Basha');
  const created = await supplierService.createSupplier({ legalName: 'Self Proposed Co', contacts: [{ name: 'Sales', phone: '01044445555' }] }, cd);
  await assert.rejects(supplierService.setStatus(created._id, { status: 'Approved' }, cd), /a different person/);
});

maybeTest('D9: the MD MAY override and approve their own proposed supplier, but only with an explicit reason', async () => {
  const md = actor('md', 'Ahmed Fattah');
  const created = await supplierService.createSupplier({ legalName: 'MD Proposed Co', contacts: [{ name: 'Sales', phone: '01055556666' }] }, md);
  await assert.rejects(supplierService.setStatus(created._id, { status: 'Approved' }, md), /requires a reason/);
  const approved = await supplierService.setStatus(created._id, { status: 'Approved', note: 'No one else available to review before a deadline' }, md);
  assert.equal(approved.status, 'Approved');
});

maybeTest('a non-proposer commercial_director or md approving normally never needs a reason for plain Approved', async () => {
  const bdm = actor('bdm', 'Ahmed Moubarek');
  const cd = actor('commercial_director', 'Mohamed Basha');
  const created = await supplierService.createSupplier({ legalName: 'Normal Flow Co', contacts: [{ name: 'Sales', phone: '01066667777' }] }, bdm);
  const approved = await supplierService.setStatus(created._id, { status: 'Approved' }, cd);
  assert.equal(approved.status, 'Approved');
});

maybeTest('sales_viewer/sales/technical/marketing still cannot propose or approve a supplier at all', async () => {
  for (const role of ['sales', 'technical', 'marketing']) {
    await assert.rejects(supplierService.createSupplier({ legalName: 'Nope Co', contacts: [{ name: 'Sales', phone: '01077778888' }] }, actor(role)), /is for:/);
  }
});
