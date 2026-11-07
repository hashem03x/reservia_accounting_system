// Literal data extracted from On_Grid.xlsx "Material Price List" sheet (Oct/Nov 2026 El Marwa
// price list + Reservia catalog). This is the seed/test fixture shape of the Price Book for
// On-Grid/Utility-Scale - services/commercial/materialSeed.js loads this (and the sibling
// off-grid/pumping catalog files) into the MaterialItem collection. Calculation services never
// hardcode a price themselves; they always receive a catalog object shaped like this one.
//
// Every array/table below cites the exact source cells so a reviewer can re-check it against the
// workbook without re-deriving anything.

'use strict';

// Material Price List!A4:J6
const PV_MODULES = [
  { brand: 'JinkoSolar', model: 'JKM475M-7RL3', pmaxW: 475, vmp: 43.38, imp: 10.95, voc: 52.24, isc: 11.77, vocTempCoeffPctPerC: -0.28, maxDcV: 1500, pricePerWatt: 8.7 },
  { brand: 'JinkoSolar', model: 'JKM670N-66QL6-BDV', pmaxW: 670, vmp: 42.92, imp: 15.61, voc: 50.6, isc: 16.34, vocTempCoeffPctPerC: -0.24, maxDcV: 1500, pricePerWatt: 8.7 },
  { brand: 'JinkoSolar', model: 'JKM735N-66HL5-BDV', pmaxW: 735, vmp: 41.23, imp: 17.83, voc: 49.52, isc: 18.88, vocTempCoeffPctPerC: -0.25, maxDcV: 1500, pricePerWatt: 8.7 },
];

// Material Price List!A10:AD28 (on-grid grid-tied inverters). Some rows have gaps in the source
// workbook itself (e.g. SUN2000-17KTL-M2 has no electrical spec columns beyond price) - preserved
// as `null`, never fabricated.
const GRID_INVERTERS = [
  { brand: 'Huawei', model: 'SUN2000-3KTL-M1', ratedKw: 3, price: 50580, maxDcV: 1100, mpptMinV: 140, mpptMaxV: 980, mpptCount: 2, dcInputs: 2, inputsPerMppt: 1, maxPvRecommendedKwp: 4.5 },
  { brand: 'Huawei', model: 'SUN2000-4KTL-M1', ratedKw: 4, price: 52888, maxDcV: 1100, mpptMinV: 140, mpptMaxV: 980, mpptCount: 2, dcInputs: 2, inputsPerMppt: 1, maxPvRecommendedKwp: 6 },
  { brand: 'Huawei', model: 'SUN2000-5KTL-M1', ratedKw: 5, price: 55830, maxDcV: 1100, mpptMinV: 140, mpptMaxV: 980, mpptCount: 2, dcInputs: 2, inputsPerMppt: 1, maxPvRecommendedKwp: 7.5 },
  { brand: 'Huawei', model: 'SUN2000-6KTL-M1', ratedKw: 6, price: 62400, maxDcV: 1100, mpptMinV: 140, mpptMaxV: 980, mpptCount: 2, dcInputs: 2, inputsPerMppt: 1, maxPvRecommendedKwp: 9 },
  { brand: 'Huawei', model: 'SUN2000-8KTL-M1', ratedKw: 8, price: 73780, maxDcV: 1100, mpptMinV: 140, mpptMaxV: 980, mpptCount: 2, dcInputs: 2, inputsPerMppt: 1, maxPvRecommendedKwp: 12 },
  { brand: 'Huawei', model: 'SUN2000-10KTL-M1', ratedKw: 10, price: 81160, maxDcV: 1100, mpptMinV: 140, mpptMaxV: 980, mpptCount: 2, dcInputs: 2, inputsPerMppt: 1, maxPvRecommendedKwp: 15 },
  { brand: 'Huawei', model: 'SUN2000-12KTL-M5', ratedKw: 12, price: 88000, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mpptCount: 2, dcInputs: 4, inputsPerMppt: 2, maxPvRecommendedKwp: 18, mpptFullPowerMinV: 370, mpptFullPowerMaxV: 800 },
  { brand: 'Huawei', model: 'SUN2000-15KTL-M5', ratedKw: 15, price: 90490, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mpptCount: 2, dcInputs: 4, inputsPerMppt: 2, maxPvRecommendedKwp: 22.5, mpptFullPowerMinV: 410, mpptFullPowerMaxV: 800 },
  { brand: 'Huawei', model: 'SUN2000-17KTL-M2', ratedKw: 17, price: 94315, maxDcV: null, mpptMinV: null, mpptMaxV: null, mpptCount: null, dcInputs: null, inputsPerMppt: null, maxPvRecommendedKwp: null },
  { brand: 'Huawei', model: 'SUN2000-20KTL-M5', ratedKw: 20, price: 97780, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mpptCount: 2, dcInputs: 4, inputsPerMppt: 2, maxPvRecommendedKwp: 30, mpptFullPowerMinV: 480, mpptFullPowerMaxV: 800 },
  { brand: 'Huawei', model: 'SUN2000-25KTL-M5', ratedKw: 25, price: 116270, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mpptCount: 2, dcInputs: 4, inputsPerMppt: 2, maxPvRecommendedKwp: 37.5, mpptFullPowerMinV: 530, mpptFullPowerMaxV: 800 },
  { brand: 'Huawei', model: 'SUN2000-30KTL-M3', ratedKw: 30, price: 137780, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mpptCount: 4, dcInputs: 8, inputsPerMppt: 2, maxPvRecommendedKwp: null },
  { brand: 'Huawei', model: 'SUN2000-36KTL-M3', ratedKw: 36, price: 149690, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mpptCount: 4, dcInputs: 8, inputsPerMppt: 2, maxPvRecommendedKwp: null },
  { brand: 'Huawei', model: 'SUN2000-40KTL-M3', ratedKw: 40, price: 156625, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mpptCount: 4, dcInputs: 8, inputsPerMppt: 2, maxPvRecommendedKwp: null },
  { brand: 'Huawei', model: 'SUN2000-50KTL-M3', ratedKw: 50, price: 168890, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mpptCount: 4, dcInputs: 8, inputsPerMppt: 2, maxPvRecommendedKwp: null },
  { brand: 'Huawei', model: 'SUN2000-60KTL-M0', ratedKw: 60, price: 197960, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mpptCount: 6, dcInputs: 12, inputsPerMppt: 2, maxPvRecommendedKwp: null },
  { brand: 'Huawei', model: 'SUN2000-100KTL-M2', ratedKw: 100, price: 253030, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mpptCount: 10, dcInputs: 20, inputsPerMppt: 2, maxPvRecommendedKwp: null },
  { brand: 'Huawei', model: 'SUN2000-115KTL-M2', ratedKw: 115, price: 284080, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mpptCount: 10, dcInputs: 20, inputsPerMppt: 2, maxPvRecommendedKwp: null },
  { brand: 'Huawei', model: 'SUN2000-150KTL-MG0', ratedKw: 150, price: 342850, maxDcV: 1100, mpptMinV: 200, mpptMaxV: 1000, mpptCount: 7, dcInputs: 21, inputsPerMppt: 3, maxPvRecommendedKwp: null },
];

// Material Price List!A33:E45 (DC cable price list, El Marwa Oct 2026)
const DC_CABLES = [
  { brand: 'HIS', sizeMm2: 4, pricePerM: 51 },
  { brand: 'HIS', sizeMm2: 6, pricePerM: 68 },
  { brand: 'HIS', sizeMm2: 10, pricePerM: 159 },
  { brand: 'HIS', sizeMm2: 16, pricePerM: 220.5 },
  { brand: 'Suntree', sizeMm2: 4, pricePerM: 46 },
  { brand: 'Suntree', sizeMm2: 6, pricePerM: 62 },
  { brand: 'Suntree', sizeMm2: 25, pricePerM: 272 },
  { brand: 'Suntree', sizeMm2: 35, pricePerM: 378 },
  { brand: 'Suntree', sizeMm2: 50, pricePerM: 487 },
  { brand: 'Suntree', sizeMm2: 70, pricePerM: 712 },
  { brand: 'Seval', sizeMm2: 10, pricePerM: 152 },
  { brand: 'Seval', sizeMm2: 16, pricePerM: 222.5 },
  { brand: 'Top Cable', sizeMm2: 50, pricePerM: 512 },
];

// Material Price List!A49:D52
const MOUNTING_STRUCTURE_RATES = {
  Rooftop: 2200,
  'Ground Mounted': 2400,
  'Hangar Roof': 1450,
};

// Material Price List!A58:L81 - "AC CABLE SIZE / HP REFERENCE MATRIX (NOT PRICES)". Despite the
// sheet's own header, these are not ampacity figures (a separate N56:O82 column already holds
// indicative ampacity) - cross-checking units against On-Grid Design!E44/F44 shows this table is a
// max-permissible-run-length-by-voltage-drop (metres) table per HP/cable-size pair: the engine
// picks the smallest cable size whose entry here is >= the actual AC run length. A blank cell
// means that size cannot carry that HP at any practical preliminary length.
const AC_CABLE_SIZES = ['3x1.5', '3x2.5', '3x4', '3x6', '3x10', '3x16', '3x25', '3x35', '3x50', '3x70', '3x95'];
const AC_CABLE_MAX_LENGTH_BY_HP = [
  { hp: 5.5, lengths: [65, 108, 172, 258, 431, 689, 1077, 1507, 2153, 3014, 4091] },
  { hp: 7.5, lengths: [48, 80, 129, 193, 322, 515, 805, 1127, 1610, 2254, 3059] },
  { hp: 10, lengths: [38, 64, 102, 153, 256, 409, 639, 894, 1278, 1789, 2428] },
  { hp: 12.5, lengths: [null, 52, 83, 125, 209, 334, 522, 730, 1043, 1461, 1982] },
  { hp: 15, lengths: [null, 45, 72, 109, 181, 289, 452, 633, 904, 1266, 1718] },
  { hp: 17.5, lengths: [null, null, 61, 92, 153, 245, 383, 536, 765, 1071, 1454] },
  { hp: 20, lengths: [null, null, 52, 79, 131, 210, 327, 458, 655, 917, 1244] },
  { hp: 25, lengths: [null, null, null, null, 106, 170, 266, 372, 531, 744, 1009] },
  { hp: 30, lengths: [null, null, null, null, 90, 145, 190, 316, 452, 633, 859] },
  { hp: 35, lengths: [null, null, null, null, 76, 122, 168, 266, 380, 532, 722] },
  { hp: 40, lengths: [null, null, null, null, 67, 107, 139, 235, 336, 470, 638] },
  { hp: 50, lengths: [null, null, null, null, null, 89, 115, 195, 279, 390, 529] },
  { hp: 60, lengths: [null, null, null, null, null, null, null, 160, 229, 321, 434] },
  { hp: 70, lengths: [null, null, null, null, null, null, null, 139, 198, 278, 377] },
  { hp: 80, lengths: [null, null, null, null, null, null, null, 131, 187, 262, 365] },
  { hp: 90, lengths: [null, null, null, null, null, null, null, 120, 172, 241, 326] },
  { hp: 100, lengths: [null, null, null, null, null, null, null, null, 154, 215, 292] },
  { hp: 110, lengths: [null, null, null, null, null, null, null, null, 132, 192, 261] },
  { hp: 125, lengths: [null, null, null, null, null, null, null, null, 127, 178, 242] },
  { hp: 150, lengths: [null, null, null, null, null, null, null, null, null, 157, 213] },
  { hp: 175, lengths: [null, null, null, null, null, null, null, null, null, null, 182] },
  { hp: 200, lengths: [null, null, null, null, null, null, null, null, null, null, 155] },
  { hp: 225, lengths: [null, null, null, null, null, null, null, null, null, null, null] },
  { hp: 250, lengths: [null, null, null, null, null, null, null, null, null, null, null] },
];

// Material Price List!N71:R82 - "AC CABLE UNIT PRICES - EGP/METER". On-Grid Design!G44 always
// reads the "Turkish Seval 2" column regardless of which brand note is shown elsewhere - preserved
// as-is (the sheet never implements a brand choice for this price).
const AC_CABLE_PRICE_PER_M = {
  '3x1.5': 165, '3x2.5': 165, '3x4': 165, '3x6': 190, '3x10': 290,
  '3x16': 420, '3x25': 630, '3x35': 850, '3x50': 1195, '3x70': 1670, '3x95': 2190,
};

// Material Price List!N87:O92 - cable tray roll price list
const CABLE_TRAY_ROLLS = [
  { lengthM: 5, pricePerRoll: 130 },
  { lengthM: 10, pricePerRoll: 160 },
  { lengthM: 20, pricePerRoll: 220 },
  { lengthM: 30, pricePerRoll: 285 },
  { lengthM: 40, pricePerRoll: 345 },
  { lengthM: 50, pricePerRoll: 405 },
];

// Material Price List!A126:D144
const AC_BREAKERS = [
  { ratingA: 1, type: 'MCB', price: 410 }, { ratingA: 2, type: 'MCB', price: 410 }, { ratingA: 6, type: 'MCB', price: 410 },
  { ratingA: 10, type: 'MCB', price: 410 }, { ratingA: 16, type: 'MCB', price: 410 }, { ratingA: 20, type: 'MCB', price: 410 },
  { ratingA: 25, type: 'MCB', price: 410 }, { ratingA: 32, type: 'MCB', price: 410 }, { ratingA: 40, type: 'MCB', price: 410 },
  { ratingA: 50, type: 'MCB', price: 410 }, { ratingA: 63, type: 'MCB', price: 410 },
  { ratingA: 80, type: 'MCCB', price: 2100 }, { ratingA: 100, type: 'MCCB', price: 2100 }, { ratingA: 125, type: 'MCCB', price: 2100 },
  { ratingA: 160, type: 'MCCB', price: 3100 }, { ratingA: 200, type: 'MCCB', price: 3100 }, { ratingA: 250, type: 'MCCB', price: 3100 },
  { ratingA: 320, type: 'MCCB', price: 8700 }, { ratingA: 400, type: 'MCCB', price: 8700 },
];

// Material Price List!A147:C147 - priced per connector (piece), not per pair
const MC4_CONNECTOR_PRICE_PER_PIECE = 40;

// Material Price List!A151:C156
const AC_DISTRIBUTION_BOARDS = [
  { maxPvKwp: 10, dimensionsCm: '30 x 60 x 40', price: 1850 },
  { maxPvKwp: 20, dimensionsCm: '30 x 70 x 50', price: 2250 },
  { maxPvKwp: 40, dimensionsCm: '70 x 90 x 40', price: 2250 },
  { maxPvKwp: 60, dimensionsCm: '40 x 80 x 60', price: 3250 },
  { maxPvKwp: 80, dimensionsCm: '70 x 90 x 40', price: 4400 },
  { maxPvKwp: 100, dimensionsCm: '100 x 80 x 50', price: 4880 },
];

// Material Price List!A105:F112 - transportation lump sum by region x size band (EGP). Band order
// matches the Rates header exactly: <=15, >15-30, >30-50, >50-100, >100 kWp.
const EGYPT_REGIONS = [
  'Cairo - 10th of Ramadan', 'Sharqia - Ismailia', 'Banha - Tanta - Menoufia',
  'Damanhour - Kafr El Sheikh - Mansoura - Wadi El Natrun - Alexandria', 'Fayoum - Beni Suef',
  'Minya - Sohag - Assiut', 'Qena - Luxor - Aswan', 'Kharga - Dakhla - Farafra Oases',
];
const TRANSPORT_RATES_BY_REGION = {
  'Cairo - 10th of Ramadan': [1000, 1000, 2000, 2500, 5000],
  'Sharqia - Ismailia': [1800, 1800, 3500, 4250, 8500],
  'Banha - Tanta - Menoufia': [2000, 2000, 4000, 5000, 10000],
  'Damanhour - Kafr El Sheikh - Mansoura - Wadi El Natrun - Alexandria': [2500, 2500, 5000, 6000, 12000],
  'Fayoum - Beni Suef': [2000, 2000, 4000, 6000, 12000],
  'Minya - Sohag - Assiut': [6000, 6000, 9500, 11000, 22000],
  'Qena - Luxor - Aswan': [8500, 8500, 14500, 16000, 32000],
  'Kharga - Dakhla - Farafra Oases': [9500, 9500, 14500, 16000, 32000],
};
// Material Price List!A116:F123 - installation EGP/kWp by region x size band. NOTE: unlike the
// transport-band formula (BOQ On-Grid Design!E22, a correct 5-way split), the installation-band
// formula (BOQ On-Grid Design!F21) collapses bands 1 and 2 into one ("<=30 kWp" -> band 1,
// skipping band 2 entirely) - see onGridEngine.js `installationBand()` for the faithful
// reproduction of that exact (and, for every region in this table, harmless because band1==band2
// here) quirk.
const INSTALL_RATES_BY_REGION = {
  'Cairo - 10th of Ramadan': [440, 440, 424, 360, 320],
  'Sharqia - Ismailia': [440, 440, 424, 360, 320],
  'Banha - Tanta - Menoufia': [440, 440, 424, 360, 320],
  'Damanhour - Kafr El Sheikh - Mansoura - Wadi El Natrun - Alexandria': [456, 456, 440, 384, 344],
  'Fayoum - Beni Suef': [456, 456, 440, 384, 344],
  'Minya - Sohag - Assiut': [480, 480, 464, 400, 360],
  'Qena - Luxor - Aswan': [480, 480, 464, 400, 360],
  'Kharga - Dakhla - Farafra Oases': [480, 480, 464, 400, 360],
};

// Estimator Input!E12:E23 - a 30 kWp reference system's monthly production (kWh), used to spread
// an estimated annual/monthly production across months in the same seasonal shape.
const MONTHLY_PRODUCTION_30KWP_REFERENCE = {
  January: 3718, February: 3979, March: 4583, April: 4294, May: 4596, June: 4613,
  July: 4684, August: 4731, September: 4621, October: 4713, November: 4713, December: 4713,
};

module.exports = {
  PV_MODULES,
  GRID_INVERTERS,
  DC_CABLES,
  MOUNTING_STRUCTURE_RATES,
  AC_CABLE_SIZES,
  AC_CABLE_MAX_LENGTH_BY_HP,
  AC_CABLE_PRICE_PER_M,
  CABLE_TRAY_ROLLS,
  AC_BREAKERS,
  MC4_CONNECTOR_PRICE_PER_PIECE,
  AC_DISTRIBUTION_BOARDS,
  EGYPT_REGIONS,
  TRANSPORT_RATES_BY_REGION,
  INSTALL_RATES_BY_REGION,
  MONTHLY_PRODUCTION_30KWP_REFERENCE,
};
