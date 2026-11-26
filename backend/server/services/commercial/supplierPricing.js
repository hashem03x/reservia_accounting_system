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
 * A supplier price in EGP. A foreign-currency quote is converted with the CURRENT Pricing
 * Configuration rate (Deal Engine C23: "Recalculate Pricing" must use the configured exchange rate,
 * not the one that applied on the upload day). When that rate has since been cleared, the EGP value
 * converted at upload is kept and the line says so - never a silent zero or a guessed rate.
 */
function supplierPriceEgp(sp, fxRates) {
  const currency = sp.currency || 'EGP';
  if (currency === 'EGP' || sp.foreignPrice == null) return { egp: sp.unitPrice, fxRate: currency === 'EGP' ? null : sp.fxRate ?? null, note: null };
  const rate = fxRates && fxRates[currency] > 0 ? fxRates[currency] : null;
  if (rate) return { egp: Math.round(sp.foreignPrice * rate * 100) / 100, fxRate: rate, note: null };
  return { egp: sp.unitPrice, fxRate: sp.fxRate ?? null, note: `No ${currency} rate is configured now - converted at the upload-day rate ${sp.fxRate ?? '?'}.` };
}

/**
 * @param {object} item - a CommercialMaterialItem (lean)
 * @param {Map<string,{status:string,code:string,legalName?:string}>} suppliersById
 * @param {Date} [now]
 * @param {{USD?:number,EUR?:number,CNY?:number}} [fxRates] - EGP per unit, from the active Pricing Configuration
 * @returns {{ unitPrice:number, source:'supplier'|'reference', supplierCode:string|null, supplierName:string|null, supplierStatus:string|null,
 *   flags:string[], foreignPrice:number|null, currency:string, fxRate:number|null, checkedAt:Date|null, validUntil:Date|null, stale:boolean, staleReason:string|null, note:string|null }}
 */
function effectivePrice(item, suppliersById, now = new Date(), fxRates = null) {
  const all = (item.supplierPrices || []).map(sp => {
    const sup = suppliersById.get(String(sp.supplier)) || null;
    return { sp, status: sup?.status || null, name: sup?.legalName || null, ...supplierPriceEgp(sp, fxRates) };
  });
  const usable = all.filter(x => x.status === 'Approved' || x.status === 'Conditional').sort((a, b) => a.egp - b.egp);
  // Prices from a supplier that may not price (Candidate, Suspended, Removed) are kept on the item but
  // never used - said on the line, so "I uploaded a price and nothing changed" has a visible answer.
  const notUsed = all
    .filter(x => !(x.status === 'Approved' || x.status === 'Conditional'))
    .map(x => `${x.sp.supplierCode}${x.name ? ` (${x.name})` : ''} quoted ${x.egp} EGP but is ${x.status || 'not on the supplier list'} - only Approved or Conditional suppliers price the BOQ`);
  const approved = usable.filter(x => x.status === 'Approved');
  const pick = approved[0] || usable[0] || null;
  if (pick) {
    const st = staleness({ checkedAt: pick.sp.checkedAt, validUntil: pick.sp.validUntil }, now);
    const flags = [];
    if (pick.status === 'Conditional') flags.push('CONDITIONAL SUPPLIER');
    if (st.stale) flags.push('RECHECK PRICE');
    return {
      unitPrice: pick.egp,
      source: 'supplier',
      supplierCode: pick.sp.supplierCode,
      supplierName: pick.name,
      supplierStatus: pick.status,
      flags,
      foreignPrice: pick.sp.currency && pick.sp.currency !== 'EGP' ? pick.sp.foreignPrice : null,
      currency: pick.sp.currency || 'EGP',
      fxRate: pick.fxRate,
      checkedAt: pick.sp.checkedAt || null,
      validUntil: pick.sp.validUntil || null,
      stale: st.stale,
      staleReason: st.reason,
      note: [pick.note, ...notUsed].filter(Boolean).join('; ') || null,
    };
  }
  const checkedAt = item.referenceCheckedAt || item.effectiveDate || null;
  const st = staleness({ checkedAt, validUntil: item.referenceValidUntil || null }, now);
  return {
    unitPrice: item.unitPrice,
    source: 'reference',
    supplierCode: null,
    supplierName: null,
    supplierStatus: null,
    flags: st.stale ? ['RECHECK PRICE'] : [],
    foreignPrice: null,
    currency: item.currency || 'EGP',
    fxRate: null,
    checkedAt,
    validUntil: item.referenceValidUntil || null,
    stale: st.stale,
    staleReason: st.reason,
    note: notUsed.join('; ') || null,
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
    supplierName: info.supplierName || null,
    supplierStatus: info.supplierStatus,
    priceFlags: info.flags,
    foreignPrice: info.foreignPrice,
    priceCurrency: info.currency,
    fxRate: info.fxRate,
    priceCheckedAt: info.checkedAt,
    priceValidUntil: info.validUntil,
    priceStaleReason: info.staleReason,
    priceNote: info.note || null,
  };
}

module.exports = { effectivePrice, supplierPriceEgp, releaseBlockers, linePriceFields, staleness, STALE_DAYS };
