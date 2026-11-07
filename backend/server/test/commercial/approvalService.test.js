const { test } = require('node:test');
const assert = require('node:assert/strict');
const approval = require('../../services/commercial/approvalService');

test('MD sign-off required only when net price excl VAT exceeds the threshold', () => {
  assert.equal(approval.computeMdRequired(1500000), false);
  assert.equal(approval.computeMdRequired(1500001), true);
  assert.equal(approval.computeMdRequired(1762669), true); // brief's own worked example
});

test('Release status: NOT RELEASED until every required stage is Approved with GP above the floor', () => {
  const base = { pricing: { grossProfitPct: 0.308 }, stage1: { status: 'Approved' }, stage2: { status: 'Approved' }, md: { status: 'Pending' }, mdRequired: true };
  assert.equal(approval.computeReleaseStatus(base), 'NOT RELEASED');
  assert.equal(approval.computeReleaseStatus({ ...base, md: { status: 'Approved' } }), 'APPROVED FOR ISSUE');
  assert.equal(approval.computeReleaseStatus({ ...base, mdRequired: false }), 'APPROVED FOR ISSUE');
});

test('Release status: GP below the floor blocks release even if every stage says Approved', () => {
  const r = { pricing: { grossProfitPct: 0.1 }, stage1: { status: 'Approved' }, stage2: { status: 'Approved' }, md: { status: 'Approved' }, mdRequired: false };
  assert.equal(approval.computeReleaseStatus(r), 'NOT RELEASED');
});

test('Stage role mapping: only md can decide the MD stage', () => {
  assert.deepEqual(approval.STAGE_ROLES.MD, ['md']);
  assert.ok(approval.STAGE_ROLES.STAGE1.includes('sales'));
  assert.ok(approval.STAGE_ROLES.STAGE2.includes('commercial_director'));
});
