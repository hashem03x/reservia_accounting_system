const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateStageTransition } = require('../../utils/crm/stageRules');

const base = (overrides = {}) => ({ from: 'new', to: 'contacted', role: 'sales', valueEgp: null, lostReason: null, followUpAt: null, mdApproved: false, ...overrides });

test('moving to the same stage is always rejected', () => {
  assert.deepEqual(validateStageTransition(base({ from: 'qualified', to: 'qualified' })), ['The lead is already in that stage.']);
});

test('a won deal can never change stage again', () => {
  const errors = validateStageTransition(base({ from: 'won', to: 'negotiation', role: 'md' }));
  assert.ok(errors.includes('A won deal cannot change stage. Open a new lead for new work.'));
});

test('a lost lead can only be reopened to Contacted, and only by Admin or the MD', () => {
  assert.ok(validateStageTransition(base({ from: 'lost', to: 'qualified', role: 'admin' })).includes('A lost lead can only be reopened to Contacted.'));
  assert.ok(validateStageTransition(base({ from: 'lost', to: 'contacted', role: 'sales' })).includes('Only Admin or the MD can reopen a lost lead.'));
  assert.deepEqual(validateStageTransition(base({ from: 'lost', to: 'contacted', role: 'admin', followUpAt: null })), []);
  assert.deepEqual(validateStageTransition(base({ from: 'lost', to: 'contacted', role: 'md' })), []);
});

test('moving to Lost requires a lost reason', () => {
  assert.ok(validateStageTransition(base({ from: 'negotiation', to: 'lost', lostReason: null })).includes('Choose a lost reason.'));
  assert.deepEqual(validateStageTransition(base({ from: 'negotiation', to: 'lost', lostReason: 'Price' })), []);
});

test('Won is only permitted from Proposal sent or Negotiation', () => {
  assert.ok(validateStageTransition(base({ from: 'qualified', to: 'won', valueEgp: 500000 })).includes('Only a lead with a proposal can be marked won.'));
  assert.deepEqual(validateStageTransition(base({ from: 'proposal_sent', to: 'won', valueEgp: 500000 })), []);
  assert.deepEqual(validateStageTransition(base({ from: 'negotiation', to: 'won', valueEgp: 500000 })), []);
});

test('Won requires a valid positive contract value', () => {
  assert.ok(validateStageTransition(base({ from: 'negotiation', to: 'won', valueEgp: null })).includes('Enter the contract value.'));
  assert.ok(validateStageTransition(base({ from: 'negotiation', to: 'won', valueEgp: 0 })).includes('Enter the contract value.'));
  assert.ok(validateStageTransition(base({ from: 'negotiation', to: 'won', valueEgp: -100 })).includes('Enter the contract value.'));
});

test('contracts above EGP 1,000,000 need MD approval unless the actor is the MD', () => {
  const tooMuch = base({ from: 'negotiation', to: 'won', valueEgp: 1_000_001, role: 'sales', mdApproved: false });
  assert.ok(validateStageTransition(tooMuch).includes('Contracts above EGP 1M need MD approval.'));
  assert.deepEqual(validateStageTransition({ ...tooMuch, mdApproved: true }), []);
  assert.deepEqual(validateStageTransition({ ...tooMuch, role: 'md' }), []);
  // Exactly at the threshold does not require approval - only strictly above it.
  assert.deepEqual(validateStageTransition(base({ from: 'negotiation', to: 'won', valueEgp: 1_000_000, role: 'sales' })), []);
});

test('a lead can move forward any number of stages at once (no forward restriction)', () => {
  assert.deepEqual(validateStageTransition(base({ from: 'new', to: 'negotiation', role: 'sales', followUpAt: '2026-12-01' })), []);
});

test('a lead can move back exactly one open stage at a time, never more', () => {
  assert.deepEqual(validateStageTransition(base({ from: 'proposal_sent', to: 'site_survey', role: 'sales', followUpAt: '2026-12-01' })), []);
  assert.ok(validateStageTransition(base({ from: 'proposal_sent', to: 'qualified', role: 'sales', followUpAt: '2026-12-01' })).includes('A lead can only move back one stage at a time.'));
  assert.ok(validateStageTransition(base({ from: 'negotiation', to: 'new', role: 'sales' })).includes('A lead can only move back one stage at a time.'));
});

test('a follow-up date is required from Qualified onwards, never for New or Contacted', () => {
  assert.deepEqual(validateStageTransition(base({ from: 'new', to: 'contacted', followUpAt: null })), []);
  assert.ok(validateStageTransition(base({ from: 'contacted', to: 'qualified', followUpAt: null })).includes('Set a follow-up date.'));
  assert.ok(validateStageTransition(base({ from: 'qualified', to: 'site_survey', followUpAt: null })).includes('Set a follow-up date.'));
  assert.ok(validateStageTransition(base({ from: 'site_survey', to: 'proposal_sent', followUpAt: null })).includes('Set a follow-up date.'));
  assert.ok(validateStageTransition(base({ from: 'proposal_sent', to: 'negotiation', followUpAt: null })).includes('Set a follow-up date.'));
  assert.deepEqual(validateStageTransition(base({ from: 'contacted', to: 'qualified', followUpAt: '2026-12-01' })), []);
});

test('Technical users may only move a lead to Site survey or Proposal sent, regardless of origin stage', () => {
  assert.deepEqual(validateStageTransition(base({ from: 'qualified', to: 'site_survey', role: 'technical', followUpAt: '2026-12-01' })), []);
  assert.deepEqual(validateStageTransition(base({ from: 'site_survey', to: 'proposal_sent', role: 'technical', followUpAt: '2026-12-01' })), []);
  assert.ok(validateStageTransition(base({ from: 'new', to: 'contacted', role: 'technical' })).includes('Technical can move leads to Site survey or Proposal sent only.'));
  assert.ok(validateStageTransition(base({ from: 'negotiation', to: 'won', role: 'technical', valueEgp: 500000 })).includes('Technical can move leads to Site survey or Proposal sent only.'));
  assert.ok(validateStageTransition(base({ from: 'negotiation', to: 'lost', role: 'technical', lostReason: 'Price' })).includes('Technical can move leads to Site survey or Proposal sent only.'));
});

test('a fully valid, typical sales-rep move produces zero errors', () => {
  assert.deepEqual(validateStageTransition({ from: 'contacted', to: 'qualified', role: 'sales', valueEgp: null, lostReason: null, followUpAt: '2026-12-05', mdApproved: false }), []);
});
