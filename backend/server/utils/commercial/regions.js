'use strict';

// Reservia Commercial - the controlled list of Egyptian installation/transport regions (QA finding
// B2). These eight strings are the Rates matrix keys (On_Grid.xlsx Material Price List!A105:A123,
// Developer Brief section 3.2) exactly as the Managing Director listed them; a project's region must
// be one of them for an Egyptian project, or the engine cannot price installation and transport.
const EGYPT_REGIONS = [
  'Cairo - 10th of Ramadan',
  'Sharqia - Ismailia',
  'Banha - Tanta - Menoufia',
  'Damanhour - Kafr El Sheikh - Mansoura',
  'Fayoum - Beni Suef',
  'Minya - Sohag - Assiut',
  'Qena - Luxor - Aswan',
  'Kharga - Dakhla - Farafra Oases',
];

// Spellings already stored in existing data that denote the SAME rates row. The seeded Rates matrix
// (scripts/seedCommercialMaterials.js, from catalogData/onGridCatalog.js) carries the workbook's long
// label for row 4; it resolves to the canonical key above so lookups match exactly, and nothing new is
// ever saved under an alias (only the canonical value is accepted from the form).
const REGION_ALIASES = {
  'Damanhour - Kafr El Sheikh - Mansoura - Wadi El Natrun - Alexandria': 'Damanhour - Kafr El Sheikh - Mansoura',
};

const GREATER_CAIRO = 'Cairo - 10th of Ramadan';

/** The canonical region for a stored/legacy value (alias-aware), or null when it is not a Rates matrix region. */
function canonicalRegion(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (EGYPT_REGIONS.includes(v)) return v;
  return REGION_ALIASES[v] || null;
}

/** Countries whose projects are priced with the Egypt Rates matrix (region mandatory). */
const RATES_MATRIX_COUNTRIES = ['Egypt'];

/**
 * Validates a project's country/region pair for create AND edit. Returns the canonical region to
 * store (or the trimmed free-text region for a country without a Rates matrix), or throws a message.
 */
function resolveProjectRegion(country, region) {
  if (RATES_MATRIX_COUNTRIES.includes(country)) {
    if (region === undefined || region === null || String(region).trim() === '') {
      return { error: `Region is required for projects in ${country}. Choose one of the ${EGYPT_REGIONS.length} Rates matrix regions.` };
    }
    // Only the exact canonical keys are accepted from a form - an alias is valid in stored data only.
    if (!EGYPT_REGIONS.includes(String(region).trim())) {
      return { error: `Region "${region}" is not in the installation Rates matrix. Choose one of: ${EGYPT_REGIONS.join('; ')}.` };
    }
    return { region: String(region).trim() };
  }
  // Other countries keep their existing behaviour: optional free-text location (no Rates matrix).
  const r = region === undefined || region === null ? null : String(region).trim().slice(0, 150) || null;
  return { region: r };
}

// CRM governorate (utils/crm/constants.js GOVERNORATES) -> Rates matrix region, for the CRM ->
// Commercial handoff. Follows the browser reference build's city->region table
// (reservia_deal_engine.html CITY_REGION). `nearest: true` marks governorates with no rates row of
// their own (the reference build's NEAREST_CITIES) - the handoff uses the nearest region and says
// so on the project, so the estimator confirms install/transport rates.
const GOVERNORATE_TO_REGION = {
  Cairo: { region: 'Cairo - 10th of Ramadan' },
  Giza: { region: 'Cairo - 10th of Ramadan' },
  Qalyubia: { region: 'Banha - Tanta - Menoufia' },
  Sharqia: { region: 'Sharqia - Ismailia' },
  Ismailia: { region: 'Sharqia - Ismailia' },
  Suez: { region: 'Sharqia - Ismailia' },
  'Port Said': { region: 'Sharqia - Ismailia' },
  'North Sinai': { region: 'Sharqia - Ismailia', nearest: true },
  Gharbia: { region: 'Banha - Tanta - Menoufia' },
  Menoufia: { region: 'Banha - Tanta - Menoufia' },
  Alexandria: { region: 'Damanhour - Kafr El Sheikh - Mansoura', nearest: true },
  Beheira: { region: 'Damanhour - Kafr El Sheikh - Mansoura' },
  'Kafr El Sheikh': { region: 'Damanhour - Kafr El Sheikh - Mansoura' },
  Dakahlia: { region: 'Damanhour - Kafr El Sheikh - Mansoura' },
  Damietta: { region: 'Damanhour - Kafr El Sheikh - Mansoura', nearest: true },
  Matrouh: { region: 'Damanhour - Kafr El Sheikh - Mansoura', nearest: true },
  Fayoum: { region: 'Fayoum - Beni Suef' },
  'Beni Suef': { region: 'Fayoum - Beni Suef' },
  Minya: { region: 'Minya - Sohag - Assiut' },
  Assiut: { region: 'Minya - Sohag - Assiut' },
  Sohag: { region: 'Minya - Sohag - Assiut' },
  Qena: { region: 'Qena - Luxor - Aswan' },
  Luxor: { region: 'Qena - Luxor - Aswan' },
  Aswan: { region: 'Qena - Luxor - Aswan' },
  'Red Sea': { region: 'Qena - Luxor - Aswan', nearest: true },
  'South Sinai': { region: 'Qena - Luxor - Aswan', nearest: true },
  'New Valley': { region: 'Kharga - Dakhla - Farafra Oases' },
};

/** { region, nearest } for a CRM governorate (case-insensitive), or null if unknown/blank. */
function regionForGovernorate(governorate) {
  if (!governorate) return null;
  const key = Object.keys(GOVERNORATE_TO_REGION).find(g => g.toLowerCase() === String(governorate).trim().toLowerCase());
  return key ? GOVERNORATE_TO_REGION[key] : null;
}

module.exports = {
  EGYPT_REGIONS,
  REGION_ALIASES,
  GREATER_CAIRO,
  RATES_MATRIX_COUNTRIES,
  canonicalRegion,
  resolveProjectRegion,
  GOVERNORATE_TO_REGION,
  regionForGovernorate,
};
