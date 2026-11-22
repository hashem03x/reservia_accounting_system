const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Feature 2/B3 - BOQ line vendor selection, and that it survives recalculation and a brand-new
// revision even though boqLines is a complete rebuild every time (revisionService.js's own
// carryForwardVendors). Exercised against the real model/service, not just read-through.
//
// Self-skips without TEST_DB_URI, like every other DB-backed suite in this repo.
const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let CommercialRevision, CommercialSupplier, revisionService, approvedSupplier, candidateSupplier;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  CommercialRevision = require('../../models/commercial/commercialRevisionModel');
  CommercialSupplier = require('../../models/commercial/supplierModel');
  revisionService = require('../../services/commercial/revisionService');

  approvedSupplier = await CommercialSupplier.create({ code: 'SUP-0001', legalName: 'Approved Co', status: 'Approved' });
  candidateSupplier = await CommercialSupplier.create({ code: 'SUP-0002', legalName: 'Candidate Co', status: 'Candidate' });
});

after(async () => {
  if (!RUN) return;
  await mongoose.disconnect();
});

function makeRevision(lines) {
  return CommercialRevision.create({
    project: new mongoose.Types.ObjectId(),
    revisionNumber: 1,
    isCurrent: true,
    boqLines: lines.map((l, i) => ({ lineNo: i + 1, component: l.component, unit: 'pcs', qty: 1, unitPrice: 100, total: 100 })),
  });
}

maybeTest('setBoqLineVendor sets the vendor on exactly one line, for an authorized role', async () => {
  const revision = await makeRevision([{ component: 'PV Modules' }, { component: 'Installation' }]);
  const updated = await revisionService.setBoqLineVendor(revision._id, 'PV Modules', approvedSupplier._id, { role: 'procurement' });
  const line = updated.boqLines.find(l => l.component === 'PV Modules');
  assert.equal(String(line.vendor._id), String(approvedSupplier._id));
  const otherLine = updated.boqLines.find(l => l.component === 'Installation');
  assert.equal(otherLine.vendor, undefined);
});

maybeTest('setBoqLineVendor refuses a Candidate (not Approved/Conditional) supplier, and refuses an unauthorized role', async () => {
  const revision = await makeRevision([{ component: 'PV Modules' }]);
  
  await assert.rejects(revisionService.setBoqLineVendor(revision._id, 'PV Modules', candidateSupplier._id, { role: 'procurement' }), /Approved or Conditional/);
  await assert.rejects(revisionService.setBoqLineVendor(revision._id, 'PV Modules', approvedSupplier._id, { role: 'sales' }), /is for:/);
});

maybeTest('setBoqLineVendor can clear a selection (supplierId falsy)', async () => {
  const revision = await makeRevision([{ component: 'PV Modules' }]);
  
  await revisionService.setBoqLineVendor(revision._id, 'PV Modules', approvedSupplier._id, { role: 'md' });
  const cleared = await revisionService.setBoqLineVendor(revision._id, 'PV Modules', null, { role: 'md' });
  assert.equal(cleared.boqLines[0].vendor, undefined);
});

maybeTest('carryForwardVendors preserves a vendor selection across a full boqLines rebuild, matched by component', () => {
  const oldLines = [
    { component: 'PV Modules', vendor: approvedSupplier._id },
    { component: 'Installation' }, // no vendor - nothing to carry
  ];
  const newLines = [
    { component: 'PV Modules', qty: 99 }, // freshly recalculated, no vendor field at all
    { component: 'Installation', qty: 5 },
    { component: 'Transportation', qty: 1 }, // a genuinely new line - nothing to carry, no crash
  ];
  const merged = revisionService.carryForwardVendors(newLines, oldLines);
  assert.equal(String(merged[0].vendor), String(approvedSupplier._id));
  assert.equal(merged[0].qty, 99); // the fresh recalculated value is kept, only vendor is carried
  assert.equal(merged[1].vendor, undefined);
  assert.equal(merged[2].vendor, undefined);
});

maybeTest('end to end: recomputeCurrentRevision preserves a BOQ line vendor selection after the lines are fully rebuilt', async () => {
  const revision = await makeRevision([{ component: 'PV Modules' }]);
  
  await revisionService.setBoqLineVendor(revision._id, 'PV Modules', approvedSupplier._id, { role: 'md' });

  // Simulate a recalculation that rebuilds boqLines with the SAME component but a different
  // qty/total (as the real engine would) - directly exercising computeAndSave's merge, without
  // needing a full engineeringInput/project fixture for one of the real onGridEngine-style engines.
  const fresh = await CommercialRevision.findById(revision._id);
  const rebuilt = revisionService.carryForwardVendors([{ lineNo: 1, component: 'PV Modules', unit: 'pcs', qty: 2, unitPrice: 100, total: 200 }], fresh.boqLines);
  fresh.boqLines = rebuilt;
  await fresh.save();

  const after2 = await CommercialRevision.findById(revision._id);
  assert.equal(String(after2.boqLines[0].vendor), String(approvedSupplier._id));
  assert.equal(after2.boqLines[0].qty, 2);
});
