'use strict';

// Deal Engine C19, C20, C23 / Spec Part 2 sections 4.2 and 5.2 - which price a Price Book item
// contributes to a BOQ, and whether a priced BOQ may be released. Pure: the caller passes the item and
// the suppliers' current statuses.
//
//   1. The lowest price from an APPROVED supplier.
//   2. Else the lowest price from a CONDITIONAL supplier - flagged on the BOQ line.
//   3. Else the item's own Reference price (from the masters, no supplier).
//   Suspended and Removed suppliers never price.
//   RECHECK PRICE: a price past its validity date, or older than 30 days when it has none.

const STALE_DAYS = 30;
const DAY = 86400000;

function staleness({ checkedAt, validUntil }, now) {
  if (validUntil && new Date(validUntil).getTime() < now.getTime()) return { stale: true, reason: `past its validity date (${new Date(validUntil).toISOString().slice(0, 10)})` };
  if (!validUntil && checkedAt && now.getTime() - new Date(checkedAt).getTime() > STALE_DAYS * DAY) return { stale: true, reason: `checked more than ${STALE_DAYS} days ago (${new Date(checkedAt).toISOString().slice(0, 10)})` };
  if (!validUntil && !checkedAt) return { stale: true, reason: 'no check date recorded' };
  return { stale: false, reason: null };
}

/**
 * @param {object} item - a CommercialMaterialItem (lean)
 * @param {Map<string,{status:string,code:string}>} suppliersById
 * @returns {{ unitPrice:number, source:'supplier'|'reference', supplierCode:string|null, supplierStatus:string|null,
 *   flags:string[], foreignPrice:number|null, currency:string, fxRate:number|null, checkedAt:Date|null, validUntil:Date|null, stale:boolean, staleReason:string|null }}
 */
function effectivePrice(item, suppliersById, now = new Date()) {
  const usable = (item.supplierPrices || [])
    .map(sp => ({ sp, status: suppliersById.get(String(sp.supplier))?.status || null }))
    .filter(x => x.status === 'Approved' || x.status === 'Conditional')
    .sort((a, b) => a.sp.unitPrice - b.sp.unitPrice);
  const approved = usable.filter(x => x.status === 'Approved');
  const pick = approved[0] || usable[0] || null;
  if (pick) {
    const st = staleness({ checkedAt: pick.sp.checkedAt, validUntil: pick.sp.validUntil }, now);
    const flags = [];
    if (pick.status === 'Conditional') flags.push('CONDITIONAL SUPPLIER');
    if (st.stale) flags.push('RECHECK PRICE');
    return {
      unitPrice: pick.sp.unitPrice,
      source: 'supplier',
      supplierCode: pick.sp.supplierCode,
      supplierStatus: pick.status,
      flags,
      foreignPrice: pick.sp.currency !== 'EGP' ? pick.sp.foreignPrice : null,
      currency: pick.sp.currency || 'EGP',
      fxRate: pick.sp.fxRate ?? null,
      checkedAt: pick.sp.checkedAt || null,
      validUntil: pick.sp.validUntil || null,
      stale: st.stale,
      staleReason: st.reason,
    };
  }
  const checkedAt = item.referenceCheckedAt || item.effectiveDate || null;
  const st = staleness({ checkedAt, validUntil: item.referenceValidUntil || null }, now);
  return {
    unitPrice: item.unitPrice,
    source: 'reference',
    supplierCode: null,
    supplierStatus: null,
    flags: st.stale ? ['RECHECK PRICE'] : [],
    foreignPrice: null,
    currency: item.currency || 'EGP',
    fxRate: null,
    checkedAt,
    validUntil: item.referenceValidUntil || null,
    stale: st.stale,
    staleReason: st.reason,
  };
}

/**
 * C20 release rule: a proposal cannot be released while any BOQ line is priced from a Reference
 * price older than 30 days (or past its validity) or from a supplier that is not Approved - unless the
 * Commercial Director overrides with a note. Returns the reasons, one per offending line.
 */
function releaseBlockers(revision) {
  const reasons = [];
  if (!revision.ruleVersion) {
    reasons.push('The revision was calculated before supplier prices were tracked - recalculate it so every Price Book line carries its price source.');
    return reasons;
  }
  for (const l of revision.boqLines || []) {
    if (!l.priceSource) continue; // not a Price Book line (rates, site costs, manual)
    if (l.priceSource === 'reference' && (l.priceFlags || []).includes('RECHECK PRICE')) {
      reasons.push(`${l.component} (${l.description}): Reference price ${l.priceStaleReason || 'is stale'}.`);
    } else if (l.priceSource === 'supplier' && l.supplierStatus !== 'Approved') {
      reasons.push(`${l.component} (${l.description}): priced from ${l.supplierCode}, a ${String(l.supplierStatus || 'non-approved').toLowerCase()} supplier.`);
    } else if (l.priceSource === 'supplier' && (l.priceFlags || []).includes('RECHECK PRICE')) {
      reasons.push(`${l.component} (${l.description}): ${l.supplierCode} price ${l.priceStaleReason || 'needs a recheck'}.`);
    }
  }
  return reasons;
}

/** The fields a BOQ line records about its price (stored on the revision line). */
function linePriceFields(info, key) {
  if (!info) return {};
  return {
    materialItemKey: key || null,
    priceSource: info.source,
    supplierCode: info.supplierCode,
    supplierStatus: info.supplierStatus,
    priceFlags: info.flags,
    foreignPrice: info.foreignPrice,
    priceCurrency: info.currency,
    fxRate: info.fxRate,
    priceCheckedAt: info.checkedAt,
    priceValidUntil: info.validUntil,
    priceStaleReason: info.staleReason,
  };
}

module.exports = { effectivePrice, releaseBlockers, linePriceFields, staleness, STALE_DAYS };
