const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Feature 1.3 - CommercialSupplier <-> ERP Vendor cross-reference. CommercialSupplier and Vendor
// are deliberately never merged (see supplierModel.js#erpVendor's own comment) - this verifies the
// LINK behaves correctly: candidate matching never auto-links, linking/creating sets the stable
// reference, a Vendor can never be the sync target of two suppliers (even racing), and unlinking
// never touches the Vendor's own data.
//
// Self-skips without TEST_DB_URI, like every other DB-backed suite in this repo.
const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let Supplier, Vendor, supplierService, mdActor;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Supplier = require('../../models/commercial/supplierModel');
  Vendor = require('../../models/vendor/vendor');
  supplierService = require('../../services/commercial/supplierService');
  mdActor = { user: { _id: new mongoose.Types.ObjectId(), name: 'MD Test' }, role: 'md' };
});

after(async () => {
  if (!RUN) return;
  await mongoose.disconnect();
});

function makeSupplier(overrides = {}) {
  return Supplier.create({
    code: `SUP-${Math.floor(Math.random() * 100000)}`,
    legalName: 'Acme Trading Co',
    contacts: [{ name: 'Sales', phone: '01011112222' }],
    ...overrides,
  });
}

maybeTest('findVendorCandidates matches by phone and by name, but never auto-links', async () => {
  const vendorByPhone = await Vendor.create({ name: 'Acme Vendor', contact: { phone: '01011112222' } });
  const supplier = await makeSupplier();
  const candidates = await supplierService.findVendorCandidates(supplier._id);
  assert.equal(candidates.length, 1);
  assert.equal(String(candidates[0]._id), String(vendorByPhone._id));

  const fresh = await Supplier.findById(supplier._id).lean();
  assert.equal(fresh.erpVendor, undefined); // never auto-linked (and genuinely absent, not null - see erpVendor's own schema comment on why that matters for the sparse index)
});

maybeTest('linkVendor sets the stable reference and logs a note; a Vendor already linked elsewhere is refused', async () => {
  const vendor = await Vendor.create({ name: 'Standalone Vendor', contact: { phone: '01022223333' } });
  const supplierA = await makeSupplier({ code: 'SUP-A1', contacts: [{ name: 'x', phone: '01099998888' }] });
  const linked = await supplierService.linkVendor(supplierA._id, vendor._id, mdActor);
  assert.equal(String(linked.erpVendor._id || linked.erpVendor), String(vendor._id));
  assert.ok(linked.notes.some(n => n.kind === 'vendor_sync' && /Linked to existing/.test(n.text)));

  const supplierB = await makeSupplier({ code: 'SUP-B1', contacts: [{ name: 'y', phone: '01077776666' }] });
  await assert.rejects(supplierService.linkVendor(supplierB._id, vendor._id, mdActor), /already linked to supplier SUP-A1/);
});

maybeTest('two suppliers cannot link the SAME vendor even racing (the unique index is the real backstop)', async () => {
  const vendor = await Vendor.create({ name: 'Race Vendor', contact: { phone: '01033334444' } });
  const s1 = await makeSupplier({ code: 'SUP-R1', contacts: [{ name: 'a', phone: '01055554444' }] });
  const s2 = await makeSupplier({ code: 'SUP-R2', contacts: [{ name: 'b', phone: '01055554445' }] });

  const results = await Promise.allSettled([
    supplierService.linkVendor(s1._id, vendor._id, mdActor),
    supplierService.linkVendor(s2._id, vendor._id, mdActor),
  ]);
  const fulfilled = results.filter(r => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 1, 'exactly one of the two concurrent links should succeed');
});

maybeTest('createVendorFromSupplier creates a real Vendor with its own identity and links it; the supplier legalName is never silently reused if invalid for Vendor.name', async () => {
  const supplier = await makeSupplier({ code: 'SUP-C1', legalName: 'Invalid Co., Ltd. (2024)', contacts: [{ name: 'z', phone: '01066665555' }] });
  const result = await supplierService.createVendorFromSupplier(supplier._id, { name: 'Valid Vendor Name', phone: '01066665555' }, mdActor);
  const vendorId = result.erpVendor._id || result.erpVendor;
  const vendor = await Vendor.findById(vendorId).lean();
  assert.equal(vendor.name, 'Valid Vendor Name'); // NOT the supplier's own invalid legalName
  assert.ok(vendor.vendorNumber);

  await assert.rejects(
    supplierService.createVendorFromSupplier(supplier._id, { name: 'Another One', phone: '01066665556' }, mdActor),
    /already linked/
  );
});

maybeTest('unlinkVendor clears the reference without touching the Vendor document itself', async () => {
  const vendor = await Vendor.create({ name: 'Unlink Vendor', contact: { phone: '01088887777' }, balance: 500 });
  const supplier = await makeSupplier({ code: 'SUP-U1', contacts: [{ name: 'u', phone: '01011110000' }] });
  await supplierService.linkVendor(supplier._id, vendor._id, mdActor);

  const unlinked = await supplierService.unlinkVendor(supplier._id, mdActor);
  assert.equal(unlinked.erpVendor, undefined);

  const vendorAfter = await Vendor.findById(vendor._id).lean();
  assert.equal(vendorAfter.balance, 500); // untouched
  assert.equal(vendorAfter.name, 'Unlink Vendor'); // untouched
});

maybeTest('only EDIT_ROLES (md, commercial_director, procurement) may link/unlink/create - an ordinary "member" cannot', async () => {
  const vendor = await Vendor.create({ name: 'Member Test Vendor', contact: { phone: '01012120000' } });
  const supplier = await makeSupplier({ code: 'SUP-M1', contacts: [{ name: 'm', phone: '01013130000' }] });
  const memberActor = { user: { _id: new mongoose.Types.ObjectId(), name: 'Member' }, role: 'member' };
  await assert.rejects(supplierService.linkVendor(supplier._id, vendor._id, memberActor), /Linking an ERP vendor is for/);
});
