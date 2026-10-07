const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateProductTypeFields } = require('../utils/productTypeValidation');

test('a product requires cost, category, and subcategory', () => {
  assert.equal(validateProductTypeFields({ type: 'product', cost: 50, category: 'c1', subcategory: 'sc1' }), null);
  assert.match(validateProductTypeFields({ type: 'product', category: 'c1', subcategory: 'sc1' }), /cost/i);
  assert.match(validateProductTypeFields({ type: 'product', cost: 50, subcategory: 'sc1' }), /category/i);
  assert.match(validateProductTypeFields({ type: 'product', cost: 50, category: 'c1' }), /subcategory/i);
});

test('defaults to "product" rules when type is omitted', () => {
  assert.match(validateProductTypeFields({}), /cost/i);
});

test('a service requires a positive durationValue and does not require cost/category/subcategory', () => {
  assert.equal(validateProductTypeFields({ type: 'service', durationValue: 12, durationUnit: 'month' }), null);
  assert.match(validateProductTypeFields({ type: 'service' }), /duration/i);
  assert.match(validateProductTypeFields({ type: 'service', durationValue: 0 }), /duration/i);
  assert.match(validateProductTypeFields({ type: 'service', durationValue: -3 }), /duration/i);
});

test('a service rejects any duration unit other than "month"', () => {
  assert.match(validateProductTypeFields({ type: 'service', durationValue: 1, durationUnit: 'year' }), /durationUnit/);
});

test('a NEW service requires a PUC account; a product can never have one', () => {
  assert.match(validateProductTypeFields({ type: 'service', durationValue: 12, durationUnit: 'month', requirePucAccount: true }), /PUC account/);
  assert.equal(validateProductTypeFields({ type: 'service', durationValue: 12, durationUnit: 'month', pucAccount: 'acc1', requirePucAccount: true }), null);
  assert.match(validateProductTypeFields({ type: 'product', cost: 50, category: 'c1', subcategory: 'sc1', pucAccount: 'acc1' }), /Only a service/);
});

test('rejects an unknown type value', () => {
  assert.match(validateProductTypeFields({ type: 'bundle' }), /type must be/i);
});
