const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canonicalMaterialKey } = require('../../utils/commercial/materialKey');

// 2026 QA fix: Price Book matching by brand+model+spec alone created duplicate entries when
// different suppliers formatted the same product differently. These are pure-function tests of
// the canonical key both writers (materialItemModel.js's pre-save hook, priceListUploadService.js's
// matching) now share - see test/commercial/commercialWorkflow.test.js for the full DB-backed
// upload flow (TEST_DB_URI-gated).

test('canonicalMaterialKey: case, whitespace and punctuation differences all collapse to the same key', () => {
  const a = canonicalMaterialKey({ brand: 'Huawei', model: 'SUN2000-60KTL-M0', spec: '60 kW grid-tied' });
  const b = canonicalMaterialKey({ brand: 'huawei', model: 'sun2000 60ktl m0', spec: '60kW Grid Tied' });
  const c = canonicalMaterialKey({ brand: ' HUAWEI ', model: 'SUN2000_60KTL_M0', spec: '60   KW   GRID   TIED' });
  assert.equal(a, b);
  assert.equal(b, c);
});

test('canonicalMaterialKey: common unit-format variants (kW/kw/KW, mm2/mm²/sqmm) normalize the same way', () => {
  assert.equal(canonicalMaterialKey({ brand: 'X', model: 'Y', spec: '35mm2' }), canonicalMaterialKey({ brand: 'X', model: 'Y', spec: '35 mm²' }));
  assert.equal(canonicalMaterialKey({ brand: 'X', model: 'Y', spec: '35 sq mm' }), canonicalMaterialKey({ brand: 'X', model: 'Y', spec: '35mm2' }));
  assert.equal(canonicalMaterialKey({ brand: 'X', model: '60kW' }), canonicalMaterialKey({ brand: 'X', model: '60 KW' }));
});

test('canonicalMaterialKey: technically different specifications are NOT collapsed - never over-merge', () => {
  const a = canonicalMaterialKey({ brand: 'Huawei', model: 'SUN2000-60KTL-M0', spec: '60 kW' });
  const b = canonicalMaterialKey({ brand: 'Huawei', model: 'SUN2000-70KTL-M0', spec: '70 kW' }); // different model AND rating
  assert.notEqual(a, b);
});

test('canonicalMaterialKey: an empty spec is handled consistently (brand+model only vs explicit empty string)', () => {
  assert.equal(canonicalMaterialKey({ brand: 'X', model: 'Y', spec: '' }), canonicalMaterialKey({ brand: 'X', model: 'Y', spec: undefined }));
  assert.equal(canonicalMaterialKey({ brand: 'X', model: 'Y' }), canonicalMaterialKey({ brand: 'X', model: 'Y', spec: null }));
});

test('canonicalMaterialKey: a literal "|" in a field can never be confused with the join separator', () => {
  // "A|B" + "C" must not equal "A" + "B|C" even though naive string concatenation with "|" would collide.
  const weird = canonicalMaterialKey({ brand: 'A|B', model: 'C', spec: '' });
  const different = canonicalMaterialKey({ brand: 'A', model: 'B|C', spec: '' });
  assert.notEqual(weird, different, 'a raw "|" inside a field is stripped by punctuation normalization, not treated as a field separator');
});
