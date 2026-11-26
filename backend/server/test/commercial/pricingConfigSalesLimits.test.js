const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// R5-R8: Sales limits on the pricing configuration. Unlike leadService.test.js/
// commercialWorkflow.test.js, pricingConfigService.js uses NO mongoose session/transaction
// anywhere (confirmed by reading it - updateConfig's only concurrency control is an optimistic
// version-match findOneAndUpdate) - so this runs for real against a plain standalone MongoDB, no
// TEST_DB_URI/replica-set needed. Uses its own throwaway local database, dropped at the end.

const DB_URI = 'mongodb://127.0.0.1:27017/dealengine_pricing_config_test';

let PricingConfig, ChartOfAccount, pricingConfigService;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  PricingConfig = require('../../models/commercial/pricingConfigModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  pricingConfigService = require('../../services/commercial/pricingConfigService');
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await PricingConfig.deleteMany({});
  await PricingConfig.Audit.deleteMany({});
  await ChartOfAccount.deleteMany({});
});

test('getActiveConfig: a brand-new configuration has the real, already-agreed defaults - not invented ones', async () => {
  const config = await pricingConfigService.getActiveConfig();
  assert.equal(config.salesLimits.discountMaxPct, 0.05, "today's real discount authority threshold");
  assert.equal(config.salesLimits.gpFloorPct, 0.15, "today's real GP floor (approvalService.js GP_FLOOR_DEFAULT)");
  assert.equal(config.salesLimits.categoryAdditionDefaultPct, 0.19, "today's real category addition default");
  assert.equal(config.salesLimits.categoryAdditionMinPct, null, 'genuinely undecided - never a guessed number');
  assert.equal(config.salesLimits.categoryAdditionMaxPct, null, 'genuinely undecided - never a guessed number');
  assert.equal(config.salesLimits.concessionCeilingPct, null, 'genuinely undecided - never a guessed number');
  assert.equal(config.requireMdApprovalForPolicyChange, false, 'R8 - off by default');
});

test('updateConfig: a save with no reason is refused (R8 - "a save needs a reason")', async () => {
  await pricingConfigService.getActiveConfig();
  await assert.rejects(() => pricingConfigService.updateConfig({ salesLimits: { gpFloorPct: 0.18 } }), /reason is required/);
});

test('updateConfig: setting real Sales-limits values creates a new version and is readable back', async () => {
  await pricingConfigService.getActiveConfig();
  const updated = await pricingConfigService.updateConfig(
    { note: 'MD confirmed the category addition range on the 19 Nov call.', salesLimits: { categoryAdditionMinPct: 0.1, categoryAdditionMaxPct: 0.19, concessionCeilingPct: 0.08 } },
    { userId: new mongoose.Types.ObjectId(), userName: 'Test MD' }
  );
  assert.equal(updated.version, 2);
  assert.equal(updated.salesLimits.categoryAdditionMinPct, 0.1);
  assert.equal(updated.salesLimits.categoryAdditionMaxPct, 0.19);
  assert.equal(updated.salesLimits.concessionCeilingPct, 0.08);
  assert.equal(updated.salesLimits.discountMaxPct, 0.05, 'fields not in the patch keep their previous value');

  const history = await pricingConfigService.getHistory();
  assert.equal(history[0].version, 2);
  assert.equal(history[0].note, 'MD confirmed the category addition range on the 19 Nov call.');
});

test('updateConfig: an explicit null clears an unbounded limit back to "not set"; a bounded field (e.g. gpFloorPct) cannot be cleared', async () => {
  await pricingConfigService.getActiveConfig();
  await pricingConfigService.updateConfig({ note: 'set a ceiling', salesLimits: { concessionCeilingPct: 0.08 } });
  const cleared = await pricingConfigService.updateConfig({ note: 'MD changed their mind - remove the ceiling for now', salesLimits: { concessionCeilingPct: null } });
  assert.equal(cleared.salesLimits.concessionCeilingPct, null);

  await assert.rejects(() => pricingConfigService.updateConfig({ note: 'try to clear the GP floor', salesLimits: { gpFloorPct: null } }), /cannot be cleared/);
});

test('updateConfig: category addition min above max is refused', async () => {
  await pricingConfigService.getActiveConfig();
  await assert.rejects(
    () => pricingConfigService.updateConfig({ note: 'bad range', salesLimits: { categoryAdditionMinPct: 0.2, categoryAdditionMaxPct: 0.1 } }),
    /minimum cannot be above the maximum/
  );
});

// Regression test for a real production bug (Vercel module resolution error): updateConfig's
// erpCostAccountCodes branch does a lazy `require('../accounting/chartOfAccountModel')` from
// services/commercial/ - one directory level too shallow (every other services/<dir>/*.js file in
// the codebase uses '../../models/accounting/chartOfAccountModel'). This never surfaced locally
// via a plain `getActiveConfig`/sales-limits save because the branch only runs when
// erpCostAccountCodes is actually part of the patch - exactly what this test now exercises.
test('updateConfig: saving erpCostAccountCodes resolves and validates against a real Chart of Accounts entry', async () => {
  await pricingConfigService.getActiveConfig();
  await ChartOfAccount.create({ code: 'COGS-OH-1', name: 'Overhead COGS', type: 'cogs' });
  await ChartOfAccount.create({ code: 'REV-1', name: 'Sales Revenue', type: 'revenue' });

  const updated = await pricingConfigService.updateConfig(
    { note: 'link the overhead lever to its COGS account', erpCostAccountCodes: { overhead: 'COGS-OH-1' } },
    { userId: new mongoose.Types.ObjectId(), userName: 'Test MD' }
  );
  assert.equal(updated.erpCostAccountCodes.overhead, 'COGS-OH-1');

  await assert.rejects(
    () => pricingConfigService.updateConfig({ note: 'unknown code', erpCostAccountCodes: { contingency: 'DOES-NOT-EXIST' } }),
    /No Chart of Accounts entry with code/,
    'an unknown account code must be refused, not silently accepted'
  );

  await assert.rejects(
    () => pricingConfigService.updateConfig({ note: 'wrong account type', erpCostAccountCodes: { salesBonus: 'REV-1' } }),
    /is not a COGS account/,
    'a non-COGS account must be refused for an Average Cost lever'
  );

  const cleared = await pricingConfigService.updateConfig({ note: 'unlink it', erpCostAccountCodes: { overhead: null } });
  assert.equal(cleared.erpCostAccountCodes.overhead, null);
});

test('R7: salesLimitsFor falls back to the default row for a sector with no override of its own, and merges partial per-sector overrides field-by-field', async () => {
  await pricingConfigService.getActiveConfig();
  const updated = await pricingConfigService.updateConfig({
    note: 'Off-Grid gets a tighter discount cap only - everything else inherits the default row',
    salesLimitsBySector: { 'Off-Grid': { discountMaxPct: 0.03 } },
  });
  const offGrid = pricingConfigService.salesLimitsFor(updated, 'Off-Grid');
  assert.equal(offGrid.discountMaxPct, 0.03, 'the sector override');
  assert.equal(offGrid.gpFloorPct, 0.15, 'inherited from the default row - no Off-Grid override for it');

  const utilityScale = pricingConfigService.salesLimitsFor(updated, 'Utility Scale');
  assert.equal(utilityScale.discountMaxPct, 0.05, 'a sector with NO row of its own uses the default row entirely');
});

test('R8: requireMdApprovalForPolicyChange off (default) lets the Commercial Director save; on, only the MD can', async () => {
  const config = await pricingConfigService.getActiveConfig();
  const commercialDirector = { systemMemberships: [{ system: 'COMMERCIAL', role: 'commercial_director', isActive: true }] };
  const md = { systemMemberships: [{ system: 'COMMERCIAL', role: 'md', isActive: true }] };

  assert.doesNotThrow(() => pricingConfigService.assertCanSavePolicyChange(commercialDirector, config));
  assert.doesNotThrow(() => pricingConfigService.assertCanSavePolicyChange(md, config));

  const strict = { ...config, requireMdApprovalForPolicyChange: true };
  assert.throws(() => pricingConfigService.assertCanSavePolicyChange(commercialDirector, strict), /requires MD approval/);
  assert.doesNotThrow(() => pricingConfigService.assertCanSavePolicyChange(md, strict));
});

test('assertCanSavePolicyChange still refuses a role with no manage access at all, regardless of the MD-approval setting', () => {
  const sales = { systemMemberships: [{ system: 'COMMERCIAL', role: 'sales', isActive: true }] };
  assert.throws(() => pricingConfigService.assertCanSavePolicyChange(sales, { requireMdApprovalForPolicyChange: false }), /Only the Sales and Commercial Director or the MD/);
});
