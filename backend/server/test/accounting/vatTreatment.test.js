const { test } = require('node:test');
const assert = require('node:assert/strict');

// Pure unit tests for the centralized VAT Accounting Treatment utility (utils/vatTreatment.js) -
// no database needed. Integration coverage (real postings, reversals, moving-average, reports)
// lives in test/accounting/{expense,fixedAsset}.test.js, test/orders/{purchaseInvoicePucCashChangeRequest,
// purchaseOrderServiceLines}.test.js, test/accounting/reversalEngine.test.js and test/reports/taxReports.test.js.

const { VAT_TREATMENTS, DEFAULT_VAT_TREATMENT, isValidVatTreatment, splitCostForVatTreatment, splitPurchaseVatByGroup, allocateVatToItems } = require('../../utils/vatTreatment');

test('VAT_TREATMENTS/DEFAULT_VAT_TREATMENT/isValidVatTreatment', () => {
  assert.deepEqual(VAT_TREATMENTS, ['recoverable', 'non_recoverable']);
  assert.equal(DEFAULT_VAT_TREATMENT, 'recoverable', 'today\'s only existing behavior is the default');
  assert.equal(isValidVatTreatment('recoverable'), true);
  assert.equal(isValidVatTreatment('non_recoverable'), true);
  assert.equal(isValidVatTreatment('exempt'), false);
  assert.equal(isValidVatTreatment(undefined), false);
});

test('splitCostForVatTreatment: "recoverable" is unchanged - cost stays as-is, VAT is its own line', () => {
  assert.deepEqual(splitCostForVatTreatment({ baseCost: 10000, vatAmount: 1400, vatTreatment: 'recoverable' }), { costDebit: 10000, vatLineAmount: 1400 });
  assert.deepEqual(splitCostForVatTreatment({ baseCost: 10000, vatAmount: 1400 }), { costDebit: 10000, vatLineAmount: 1400 }, 'omitted treatment also behaves as recoverable');
});

test('splitCostForVatTreatment: "non_recoverable" folds VAT into the cost - zero left for a separate line', () => {
  // The task's own worked example: Subtotal 10,000 + VAT 1,400 = 11,400, no VAT account entry.
  assert.deepEqual(splitCostForVatTreatment({ baseCost: 10000, vatAmount: 1400, vatTreatment: 'non_recoverable' }), { costDebit: 11400, vatLineAmount: 0 });
});

test('splitCostForVatTreatment: rounds to 2 decimals and tolerates missing/invalid numbers', () => {
  assert.deepEqual(splitCostForVatTreatment({ baseCost: 100.005, vatAmount: 14.0049, vatTreatment: 'recoverable' }), { costDebit: 100.01, vatLineAmount: 14.0 });
  assert.deepEqual(splitCostForVatTreatment({ baseCost: null, vatAmount: undefined, vatTreatment: 'non_recoverable' }), { costDebit: 0, vatLineAmount: 0 });
});

test('splitPurchaseVatByGroup: a product-only group (no services) gets 100% of the VAT/WHT', () => {
  const items = [{ subtotal: 500 }, { subtotal: 100 }];
  const result = splitPurchaseVatByGroup({ items, vatAmount: 84, withholdingTaxAmount: 6, isServiceItem: () => false });
  assert.deepEqual(result, { physicalSubtotal: 600, serviceSubtotal: 0, physicalVat: 84, serviceVat: 0, physicalWht: 6, serviceWht: 0 });
});

test('splitPurchaseVatByGroup: splits VAT/WHT between physical and service groups proportional to their own subtotal', () => {
  // Physical 600, Service 2300 of a 2900 total - VAT 406, WHT 29 (matching the mixed-PO test fixture).
  const items = [{ subtotal: 500 }, { subtotal: 2000 }, { subtotal: 100 }, { subtotal: 300 }];
  const isServiceItem = item => item.subtotal === 2000 || item.subtotal === 300;
  const result = splitPurchaseVatByGroup({ items, vatAmount: 406, withholdingTaxAmount: 29, isServiceItem });
  assert.deepEqual(result, { physicalSubtotal: 600, serviceSubtotal: 2300, physicalVat: 84, serviceVat: 322, physicalWht: 6, serviceWht: 23 });
});

test('splitPurchaseVatByGroup: an all-service group gets 100% of the VAT/WHT (the physical side is empty)', () => {
  const items = [{ subtotal: 2000 }];
  const result = splitPurchaseVatByGroup({ items, vatAmount: 280, withholdingTaxAmount: 20, isServiceItem: () => true });
  assert.deepEqual(result, { physicalSubtotal: 0, serviceSubtotal: 2000, physicalVat: 0, serviceVat: 280, physicalWht: 0, serviceWht: 20 });
});

test('allocateVatToItems: distributes proportionally to each item\'s subtotal share, the last item taking the rounding remainder', () => {
  const items = [{ subtotal: 2000 }, { subtotal: 300 }];
  // 322 * 2000/2300 = 280 exactly, 322 * 300/2300 = 42 exactly - no remainder to absorb here.
  assert.deepEqual(allocateVatToItems(items, 2300, 322), [280, 42]);

  // A case that does not divide evenly: 100 split 3 ways by equal subtotal shares of 33.33 each.
  const thirds = [{ subtotal: 1 }, { subtotal: 1 }, { subtotal: 1 }];
  const shares = allocateVatToItems(thirds, 3, 100);
  assert.equal(shares.reduce((s, v) => s + v, 0), 100, 'the shares always sum back to exactly the group VAT - never off by a cent');
  assert.deepEqual(shares.slice(0, 2), [33.33, 33.33]);
  assert.equal(shares[2], 33.34, 'the last entry absorbs the rounding remainder');
});

test('allocateVatToItems: zero VAT, empty items or zero subtotal all return a safe all-zero array (no divide-by-zero)', () => {
  assert.deepEqual(allocateVatToItems([{ subtotal: 100 }], 100, 0), [0]);
  assert.deepEqual(allocateVatToItems([], 0, 50), []);
  assert.deepEqual(allocateVatToItems([{ subtotal: 0 }, { subtotal: 0 }], 0, 50), [0, 0]);
});
