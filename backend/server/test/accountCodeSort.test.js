const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareAccountCodes, sortByAccountCode, ACCOUNT_CODE_COLLATION, ACCOUNT_CODE_SORT } = require('../utils/accountCodeSort');

// The Chart of Accounts is always ordered by account number ascending, numerically.

test('account numbers sort numerically, not as plain strings', () => {
  const accounts = ['100', '20', '3', '1000', '50'].map(code => ({ code }));
  assert.deepEqual(sortByAccountCode(accounts).map(a => a.code), ['3', '20', '50', '100', '1000']);
});

test('real 8-digit chart codes keep their natural order', () => {
  const codes = ['60000001', '11000006', '31000001', '11000017', '11000004', '2', '50000003'];
  assert.deepEqual(sortByAccountCode(codes.map(code => ({ code }))).map(a => a.code), ['2', '11000004', '11000006', '11000017', '31000001', '50000003', '60000001']);
});

test('the example from the requirements: 1000, 1001, 1002, 1010, 1100, 2000, 2001', () => {
  const shuffled = ['2001', '1100', '1000', '2000', '1010', '1002', '1001'].map(code => ({ code }));
  assert.deepEqual(sortByAccountCode(shuffled).map(a => a.code), ['1000', '1001', '1002', '1010', '1100', '2000', '2001']);
});

test('ignores name/type/creation order entirely', () => {
  const accounts = [
    { code: '30', name: 'A', type: 'asset' },
    { code: '4', name: 'Z', type: 'expense' },
    { code: '200', name: 'M', type: 'revenue' },
  ];
  assert.deepEqual(sortByAccountCode(accounts).map(a => a.code), ['4', '30', '200']);
});

test('does not mutate its input and tolerates missing codes/rows', () => {
  const input = [{ code: '10' }, { code: '2' }];
  const sorted = sortByAccountCode(input);
  assert.deepEqual(input.map(a => a.code), ['10', '2']);
  assert.deepEqual(sorted.map(a => a.code), ['2', '10']);
  assert.doesNotThrow(() => sortByAccountCode([{ code: null }, {}, null, { code: '1' }]));
  assert.deepEqual(sortByAccountCode(undefined), []);
});

test('can sort rows that carry a nested account (e.g. trial balance rows)', () => {
  const rows = [{ account: { code: '100' } }, { account: { code: '9' } }];
  assert.deepEqual(sortByAccountCode(rows, r => r.account?.code).map(r => r.account.code), ['9', '100']);
});

test('compareAccountCodes and the Mongo collation agree on numeric ordering', () => {
  assert.ok(compareAccountCodes('2', '10') < 0);
  assert.ok(compareAccountCodes('10', '100') < 0);
  assert.equal(compareAccountCodes('7', '7'), 0);
  assert.deepEqual(ACCOUNT_CODE_COLLATION, { locale: 'en', numericOrdering: true });
  assert.deepEqual(Object.keys(ACCOUNT_CODE_SORT)[0], 'code', 'account number is always the PRIMARY sort key');
});
