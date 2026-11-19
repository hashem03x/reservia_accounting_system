const { test } = require('node:test');
const assert = require('node:assert/strict');
const { projectHeaderFromLead } = require('../../services/crm/commercialHandoffService');

// CRM/Deal Engine Pending Fixes (19 Nov 2026), item 3: a one-time region override chosen by the
// user at Proposal sent must win over every automatic mapping (the admin-configured city table,
// then the built-in nearest-governorate table). projectHeaderFromLead is a pure, synchronous
// function (no DB access) - no transaction/replica-set needed to test it directly, unlike
// leadService.test.js's intakeLead/changeStage.

test('projectHeaderFromLead: a regionOverride on the lead wins over the city table and the governorate mapping', () => {
  const lead = { name: 'Ahmed Samir', segment: 'villa', governorate: 'Alexandria', regionOverride: 'Cairo - 10th of Ramadan' };
  const header = projectHeaderFromLead(lead, { cityRegions: { Alexandria: 'Damanhour - Kafr El Sheikh - Mansoura' } });
  assert.equal(header.region, 'Cairo - 10th of Ramadan');
  assert.match(header.regionNote, /chosen by the user at Proposal sent/);
});

test('projectHeaderFromLead: with no override, the admin-configured city table still wins over the built-in governorate mapping', () => {
  const lead = { name: 'Ahmed Samir', segment: 'villa', governorate: 'Alexandria' };
  const header = projectHeaderFromLead(lead, { cityRegions: { Alexandria: 'Minya - Sohag - Assiut' } });
  assert.equal(header.region, 'Minya - Sohag - Assiut');
});

test('projectHeaderFromLead: with no override and no city table entry, falls back to the built-in nearest-governorate mapping (unchanged behaviour)', () => {
  const lead = { name: 'Ahmed Samir', segment: 'villa', governorate: 'Alexandria' };
  const header = projectHeaderFromLead(lead, { cityRegions: null });
  assert.equal(header.region, 'Damanhour - Kafr El Sheikh - Mansoura');
  assert.match(header.regionNote, /nearest Rates region/);
});

test('projectHeaderFromLead: an empty-string regionOverride (never set, just the schema default) is ignored, not treated as a real choice', () => {
  const lead = { name: 'Ahmed Samir', segment: 'villa', governorate: 'Alexandria', regionOverride: null };
  const header = projectHeaderFromLead(lead, { cityRegions: null });
  assert.equal(header.region, 'Damanhour - Kafr El Sheikh - Mansoura');
});

test('projectHeaderFromLead: a lead with no governorate and no override still throws the original, actionable error', () => {
  const lead = { name: 'Ahmed Samir', segment: 'villa', governorate: null };
  assert.throws(() => projectHeaderFromLead(lead, { cityRegions: null }), /has no governorate/);
});
