'use strict';

// Deal Engine - the technical data a Price Book item must carry before the design engines can size
// with it (services/commercial/onGridEngine.js, utilityEngine.js, pumpingEngine.js read these
// `attrs` through priceBookLookup.js). A supplier price-list upload creates a NEW item with its
// rated value only (priceListUploadService.js#confirmUpload) and status PLACEHOLDER, which keeps it
// out of the engine catalogs until the rest is entered on Deal Engine -> Materials. One list, used
// by the Materials editor, the engineering forms (which options are usable) and the calculation's
// error message - so all three always agree on what "complete" means.

const ENGINE_SPECS = {
  'PV Modules': [
    { key: 'pmaxW', label: 'Rated power (Pmax)', unit: 'W', required: true, positive: true },
    { key: 'vmp', label: 'Voltage at max power (Vmp)', unit: 'V', required: true, positive: true },
    { key: 'imp', label: 'Current at max power (Imp)', unit: 'A', required: true, positive: true },
    { key: 'voc', label: 'Open-circuit voltage (Voc)', unit: 'V', required: true, positive: true },
    { key: 'isc', label: 'Short-circuit current (Isc)', unit: 'A', required: true, positive: true },
    // Negative on every crystalline datasheet (e.g. -0.25 %/°C) - the cold-morning string voltage check uses it.
    { key: 'vocTempCoeffPctPerC', label: 'Voc temperature coefficient', unit: '%/°C', required: true, negative: true },
    { key: 'maxDcV', label: 'Maximum system voltage', unit: 'V', required: false, positive: true },
  ],
  // The on-grid calculation picks the inverter automatically by rating, and checks the string voltage
  // against the DC limits - an inverter without them would be chosen with no voltage check at all.
  'On-Grid Inverter': [
    { key: 'ratedKw', label: 'Rated AC power', unit: 'kW', required: true, positive: true },
    { key: 'maxDcV', label: 'Maximum DC input voltage', unit: 'V', required: true, positive: true },
    { key: 'mpptMaxV', label: 'MPPT voltage range - maximum', unit: 'V', required: true, positive: true },
    { key: 'mpptMinV', label: 'MPPT voltage range - minimum', unit: 'V', required: false, positive: true },
    { key: 'mpptCount', label: 'Number of MPPTs', unit: '', required: false, positive: true },
  ],
  // services/commercial/boqService.js#resolveOffGridInput sizes with these.
  'Off-Grid Inverter': [
    { key: 'ratedKw', label: 'Rated AC power', unit: 'kW', required: true, positive: true },
    { key: 'batteryVoltageV', label: 'Battery (DC) voltage', unit: 'V', required: false, positive: true },
  ],
  'Lithium Batteries': [
    { key: 'voltageV', label: 'Nominal voltage', unit: 'V', required: true, positive: true },
    { key: 'capacityAh', label: 'Capacity', unit: 'Ah', required: true, positive: true },
  ],
};

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Labels of the REQUIRED fields that are missing or invalid on `attrs` ([] = the engine can use it). */
function missingSpecs(category, attrs) {
  const fields = ENGINE_SPECS[category];
  if (!fields) return [];
  const a = attrs || {};
  return fields.filter(f => f.required && !validValue(f, a[f.key])).map(f => f.label);
}

function validValue(field, v) {
  if (!isNum(v)) return false;
  if (field.positive && !(v > 0)) return false;
  if (field.negative && !(v < 0)) return false;
  return true;
}

/**
 * Checks and normalises an `attrs` patch for one category: numbers only, signs as the field says;
 * blank ('' / null) clears an optional field. Returns { attrs, errors }. Keys outside the spec list
 * are passed through untouched (other categories' data, e.g. a DC cable's sizeMm2).
 */
function cleanSpecPatch(category, patch) {
  const fields = ENGINE_SPECS[category] || [];
  const out = {};
  const errors = [];
  for (const [k, raw] of Object.entries(patch || {})) {
    const field = fields.find(f => f.key === k);
    if (!field) {
      out[k] = raw;
      continue;
    }
    if (raw === '' || raw === null || raw === undefined) {
      if (field.required) errors.push(`${field.label} is required.`);
      else out[k] = null;
      continue;
    }
    const v = Number(raw);
    if (!validValue(field, v)) {
      errors.push(`${field.label} must be ${field.negative ? 'a negative number' : 'a positive number'}${field.unit ? ` (${field.unit})` : ''}.`);
      continue;
    }
    out[k] = v;
  }
  return { attrs: out, errors };
}

module.exports = { ENGINE_SPECS, missingSpecs, cleanSpecPatch };
