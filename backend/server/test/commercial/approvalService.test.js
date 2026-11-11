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

test('Stage role mapping follows Developer Brief 4.1 (QA U6): Stage 1 Sales & Technical, Stage 2 Commercial Director, MD only', () => {
  assert.deepEqual(approval.STAGE_ROLES.STAGE1, ['sales', 'technical']);
  assert.deepEqual(approval.STAGE_ROLES.STAGE2, ['commercial_director']);
  assert.deepEqual(approval.STAGE_ROLES.MD, ['md']);
  // no role may sign two different stages
  const all = [...approval.STAGE_ROLES.STAGE1, ...approval.STAGE_ROLES.STAGE2, ...approval.STAGE_ROLES.MD];
  assert.equal(new Set(all).size, all.length);
});

test('A Draft revision is never released, whatever its stages say', () => {
  const r = { status: 'Draft', pricing: { grossProfitPct: 0.31 }, stage1: { status: 'Approved' }, stage2: { status: 'Approved' }, md: { status: 'Approved' }, mdRequired: true };
  assert.equal(approval.computeReleaseStatus(r), 'NOT RELEASED');
});

test('Waiting-on line names the next sign-off (brief 4.1)', () => {
  const base = { status: 'Calculated', stage1: { status: 'Pending' }, stage2: { status: 'Pending' }, md: { status: 'Pending' }, mdRequired: true };
  assert.match(approval.waitingOn(base), /Stage 1/);
  assert.match(approval.waitingOn({ ...base, stage1: { status: 'Approved' } }), /Stage 2/);
  assert.match(approval.waitingOn({ ...base, stage1: { status: 'Approved' }, stage2: { status: 'Approved' } }), /MD/);
  assert.equal(approval.waitingOn({ ...base, stage1: { status: 'Approved' }, stage2: { status: 'Approved' }, mdRequired: false }), null);
});
