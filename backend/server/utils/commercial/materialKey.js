'use strict';

// Reservia Commercial - canonical Price Book matching key (2026 QA finding: matching supplier
// price-list rows by brand+model+spec alone created duplicate Price Book entries whenever two
// suppliers described the identical product with different whitespace/capitalization/punctuation/
// unit formatting - e.g. "SUN2000-60KTL-M0" / "sun2000 60ktl m0", "60 kW" / "60kw" / "60 KW").
//
// `canonicalMaterialKey` is the ONE normalization function both writers (models/commercial/
// materialItemModel.js's own pre-save hook, which keeps every document's `keyNorm` field correct
// regardless of caller, and services/commercial/priceListUploadService.js's in-memory matching)
// must use - never a second, independently-reimplemented normalizer that could drift from this
// one and silently stop catching the same duplicates.
//
// This does NOT replace `key` (still the exact, case-preserving `brand | model | spec` string
// shown in the UI and used for human-readable audit trails) - `keyNorm` is purely an internal
// matching/uniqueness key.

/** Canonicalizes known unit/format variants so "60 kW", "60kw" and "60 KW" all collapse to "60kw". */
function canonicalizeUnits(value) {
  return value
    .replace(/\bkilowatts?\b/g, 'kw')
    .replace(/\bkwp\b/g, 'kwp')
    .replace(/\bkw\b/g, 'kw')
    .replace(/\bwatts?\b/g, 'w')
    .replace(/\bamp(?:ere)?s?\b/g, 'a')
    .replace(/\bah\b/g, 'ah')
    .replace(/\bmm2\b|\bmm²\b|\bsq\.?\s*mm\b/g, 'mm2')
    .replace(/\bvolts?\b/g, 'v');
}

/** One field (brand, model or spec) to its canonical form - never the full "brand | model | spec" string. */
function canonicalizePart(value) {
  const normalized = String(value ?? '')
    .normalize('NFKC') // fold full-width/compatibility characters (and some non-breaking spaces) to their plain form
    .toLowerCase()
    .trim();
  const withUnits = canonicalizeUnits(normalized);
  // Strip ALL whitespace and the common separator punctuation a supplier's own formatting varies
  // on ("SUN2000-60KTL-M0" / "SUN2000_60KTL_M0" / "SUN2000 60KTL M0" must all match) - deliberately
  // aggressive, since the goal is matching the same physical product, not preserving formatting.
  // "|" is included here specifically so it can never be mistaken for canonicalMaterialKey's own
  // join separator (a raw "|" inside one field must not let that field's tail be read as the
  // start of the next one).
  return withUnits.replace(/[\s\-_/.,|]+/g, '');
}

/**
 * The canonical matching key for a Price Book item: its three parts normalized and joined with a
 * character ("|") that itself never survives normalization, so it can never be ambiguous with a
 * "|" that was part of an original brand/model/spec value.
 */
function canonicalMaterialKey({ brand, model, spec }) {
  return [canonicalizePart(brand), canonicalizePart(model), canonicalizePart(spec)].join('|');
}

module.exports = { canonicalMaterialKey, canonicalizePart };
