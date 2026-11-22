'use strict';

const Product = require('../../models/inventory/productModel');
const MaterialItem = require('../../models/commercial/materialItemModel');

// Shared by wonToErpService.js#buildErpBoqLines (the Won -> ERP BOQ transfer, W13) and
// createPrService.js (Feature 3/B4 - Create PR from a single BOQ line) - extracted so there is
// exactly ONE place a BOQ line is ever matched to a real ERP Product, never two independently-
// maintained copies of the same fuzzy-matching rules that could silently drift apart.
//
// Two ways a line is matched, tried in order, never a third guessed one:
//   1. Exact, via the Price Book: the revision priced this line from a real CommercialMaterialItem
//      (boqLine.materialItemKey). If Purchasing has confirmed that material's `erpProduct` link
//      (materialItemModel.js), that is the match - unambiguous.
//   2. Fallback, text match: case-insensitive substring (`description` first, then `component`),
//      refusing a candidate whose title names a conflicting number (hasConflictingSize - this is
//      what stops "4mm"/"6mm"/"10mm" cable from ever being confused), and refusing to guess when
//      more than one candidate remains.
// A line that matches neither way resolves to `{ product: null, ambiguous: [...] }` - the caller
// decides what to do (wonToErpService.js logs a warning and skips the line; createPrService.js
// refuses to create a Requisition without a real product).

/** All distinct numbers a text mentions (cable mm2, kWp, A, V...), as comparable strings. */
function sizeNumbers(text) {
  return new Set((String(text || '').match(/\d+(?:\.\d+)?/g) || []));
}

/**
 * True when both sides name at least one number and NONE of them match - e.g. a BOQ line for
 * "DC Solar Cable 4mm2" and a catalog product titled "Solar Cable 6mm2" share every word except
 * the size, and a plain substring match cannot tell them apart. Neither side naming a number is
 * not a conflict - there is nothing size-specific to disagree about.
 */
function hasConflictingSize(a, b) {
  const an = sizeNumbers(a);
  const bn = sizeNumbers(b);
  if (!an.size || !bn.size) return false;
  for (const n of an) if (bn.has(n)) return false;
  return true;
}

/** Precomputed once per call site (not per line) - the full active catalog + materialItemKey -> erpProduct map, for the specific keys the caller's lines actually use. */
async function loadMatchingContext(boqLines, session) {
  const materialKeys = [...new Set((boqLines || []).map(l => l.materialItemKey).filter(Boolean))];
  const materials = materialKeys.length
    ? await MaterialItem.find({ key: { $in: materialKeys } }).select('key erpProduct').session(session || null).lean()
    : [];
  const materialByKey = new Map(materials.map(m => [m.key, m]));

  const products = await Product.find({ isDeleted: { $ne: true }, type: 'product' }).select('title').session(session || null).lean();
  const productById = new Map(products.map(p => [String(p._id), p]));

  const fuzzyCandidates = needle => {
    if (!needle) return [];
    return products.filter(p => {
      const hay = String(p.title?.en || '').toLowerCase();
      if (!hay) return false;
      if (!(hay.includes(needle) || needle.includes(hay))) return false;
      return !hasConflictingSize(needle, hay);
    });
  };

  return { products, productById, materialByKey, fuzzyCandidates };
}

/**
 * @returns {{ product: object|null, ambiguous: object[], reason: string|null }} `reason` is only
 *   ever set when `product` is null - "unlinked" (the Price Book link points at a deleted
 *   product), "ambiguous", or "unmatched".
 */
function matchLineToProduct(line, { productById, materialByKey, fuzzyCandidates }) {
  const material = line.materialItemKey ? materialByKey.get(line.materialItemKey) : null;
  if (material?.erpProduct) {
    // materialItemModel.js's own pre(/^find/) hook populates erpProduct - handle both shapes
    // rather than assuming a raw id.
    const linkedId = material.erpProduct._id || material.erpProduct;
    const linked = productById.get(String(linkedId));
    if (linked) return { product: linked, ambiguous: [], reason: null };
    return { product: null, ambiguous: [], reason: 'unlinked' };
  }

  const byDescription = fuzzyCandidates(String(line.description || '').toLowerCase().trim());
  const candidates = byDescription.length ? byDescription : fuzzyCandidates(String(line.component || '').toLowerCase().trim());
  if (candidates.length === 1) return { product: candidates[0], ambiguous: [], reason: null };
  if (candidates.length > 1) return { product: null, ambiguous: candidates, reason: 'ambiguous' };
  return { product: null, ambiguous: [], reason: 'unmatched' };
}

module.exports = { loadMatchingContext, matchLineToProduct, hasConflictingSize };
