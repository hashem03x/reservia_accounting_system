const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEgyptianPhone } = require('../../utils/crm/phone');

test('normalizeEgyptianPhone: a local 11-digit mobile number (010/011/012/015) normalizes to +20', () => {
  assert.equal(normalizeEgyptianPhone('01001234567'), '+201001234567');
  assert.equal(normalizeEgyptianPhone('01112223334'), '+201112223334');
  assert.equal(normalizeEgyptianPhone('01223334445'), '+201223334445');
  assert.equal(normalizeEgyptianPhone('01512345678'), '+201512345678');
});

test('normalizeEgyptianPhone: country-code prefixes (+20, 0020, 20) are all accepted', () => {
  assert.equal(normalizeEgyptianPhone('+201001234567'), '+201001234567');
  assert.equal(normalizeEgyptianPhone('00201001234567'), '+201001234567');
  assert.equal(normalizeEgyptianPhone('201001234567'), '+201001234567');
});

test('normalizeEgyptianPhone: punctuation, spaces and dashes are stripped', () => {
  assert.equal(normalizeEgyptianPhone('010 012 34567'), '+201001234567');
  assert.equal(normalizeEgyptianPhone('010-0123-4567'), '+201001234567');
  assert.equal(normalizeEgyptianPhone('(+20) 10 0123 4567'), '+201001234567');
});

test('normalizeEgyptianPhone: Arabic-Indic digits are converted before validation', () => {
  assert.equal(normalizeEgyptianPhone('٠١٠٠١٢٣٤٥٦٧'), '+201001234567');
});

test('normalizeEgyptianPhone: an invalid carrier prefix (013/014/016/017/018/019) is rejected', () => {
  assert.equal(normalizeEgyptianPhone('01312345678'), null);
  assert.equal(normalizeEgyptianPhone('01612345678'), null);
});

test('normalizeEgyptianPhone: garbage, empty, or too-short input is rejected, never guessed', () => {
  assert.equal(normalizeEgyptianPhone(''), null);
  assert.equal(normalizeEgyptianPhone(undefined), null);
  assert.equal(normalizeEgyptianPhone('abc'), null);
  assert.equal(normalizeEgyptianPhone('123'), null);
});

test('normalizeEgyptianPhone: two different raw inputs for the same real number normalize identically (the basis for dedup)', () => {
  const a = normalizeEgyptianPhone('01001234567');
  const b = normalizeEgyptianPhone('+20 100 123 4567');
  const c = normalizeEgyptianPhone('0020١٠٠١٢٣٤٥٦٧');
  assert.equal(a, b);
  assert.equal(b, c);
});
