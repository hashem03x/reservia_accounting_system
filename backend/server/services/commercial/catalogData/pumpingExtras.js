// Small supporting tables from Solar_Pumping3.xlsx not covered by pumpingCatalog.js (pumps/motors)
// or onGridCatalog.js (PV module datasheets, reused as-is - Solar_Pumping3.xlsx's "PV Module
// Datasheets" sheet is the identical Jinko 475/670/735 W lineup).

'use strict';

// Reference Data!A5:C7 - irrigation method code -> [name, m3PerFeddanPerIrrigation]
const IRRIGATION_METHODS = {
  1: { name: 'Flood', m3PerFeddanPerIrrigation: 50 },
  2: { name: 'Drip', m3PerFeddanPerIrrigation: 20 },
  3: { name: 'Sprinkler', m3PerFeddanPerIrrigation: 20 },
};

// Reference Data!E5:H11 - tree code -> [name, treesPerFeddan, litresPerTree]
const TREE_TYPES = {
  1: { name: 'Banana', treesPerFeddan: 850, litresPerTree: 64 },
  2: { name: 'Olive', treesPerFeddan: 175, litresPerTree: 32 },
  3: { name: 'Fig', treesPerFeddan: 265, litresPerTree: 32 },
  4: { name: 'Palm', treesPerFeddan: 80, litresPerTree: 120 },
  5: { name: 'Grapes', treesPerFeddan: 800, litresPerTree: 48 },
  6: { name: 'Citrus', treesPerFeddan: 225, litresPerTree: 32 },
  7: { name: 'Pomegranate / Apple', treesPerFeddan: 300, litresPerTree: 32 },
};

// Submersible Cable List!A1:L23 - max run length (m) by motor HP and cable size. Looks like
// On_Grid.xlsx's AC cable reference matrix for the first 9 rows (hp <= 25), but is a DIFFERENT
// table from hp=30 upward (verified cell-by-cell against the live workbook, not assumed from the
// other sheet's shape) - matched in the OPPOSITE direction from On-Grid's AC cable table too: the
// SMALLEST catalog HP that is >= the actual motor HP, not the largest that is <= it (Design!E30's
// own MATCH(TRUE, A2:A23>=A30, 0)).
const SUBMERSIBLE_CABLE_SIZES = ['3x1.5', '3x2.5', '3x4', '3x6', '3x10', '3x16', '3x25', '3x35', '3x50', '3x70', '3x95'];
const SUBMERSIBLE_CABLE_MAX_LENGTH_BY_HP = [
  { hp: 5.5, lengths: [65, 108, 172, 258, 431, 689, 1077, 1507, 2153, 3014, 4091] },
  { hp: 7.5, lengths: [48, 80, 129, 193, 322, 515, 805, 1127, 1610, 2254, 3059] },
  { hp: 10, lengths: [38, 64, 102, 153, 256, 409, 639, 894, 1278, 1789, 2428] },
  { hp: 12.5, lengths: [null, 52, 83, 125, 209, 334, 522, 730, 1043, 1461, 1982] },
  { hp: 15, lengths: [null, 45, 72, 109, 181, 289, 452, 633, 904, 1266, 1718] },
  { hp: 17.5, lengths: [null, null, 61, 92, 153, 245, 383, 536, 765, 1071, 1454] },
  { hp: 20, lengths: [null, null, 52, 79, 131, 210, 327, 458, 655, 917, 1244] },
  { hp: 25, lengths: [null, null, null, null, 106, 170, 266, 372, 531, 744, 1009] },
  { hp: 30, lengths: [null, null, null, null, 90, 145, 226, 316, 452, 633, 859] },
  { hp: 35, lengths: [null, null, null, null, 76, 122, 190, 266, 380, 532, 722] },
  { hp: 40, lengths: [null, null, null, null, 67, 107, 168, 235, 336, 470, 638] },
  { hp: 50, lengths: [null, null, null, null, null, 89, 139, 195, 279, 390, 529] },
  { hp: 60, lengths: [null, null, null, null, null, null, 115, 160, 229, 321, 434] },
  { hp: 70, lengths: [null, null, null, null, null, null, null, 139, 198, 278, 377] },
  { hp: 75, lengths: [null, null, null, null, null, null, null, 131, 187, 262, 356] },
  { hp: 80, lengths: [null, null, null, null, null, null, null, 120, 172, 241, 326] },
  { hp: 90, lengths: [null, null, null, null, null, null, null, null, 154, 215, 292] },
  { hp: 100, lengths: [null, null, null, null, null, null, null, null, 132, 192, 261] },
  { hp: 110, lengths: [null, null, null, null, null, null, null, null, 127, 178, 242] },
  { hp: 125, lengths: [null, null, null, null, null, null, null, null, null, 157, 213] },
  { hp: 150, lengths: [null, null, null, null, null, null, null, null, null, null, 182] },
  { hp: 175, lengths: [null, null, null, null, null, null, null, null, null, null, 155] },
];

// DC Cable Price List!A2:E11 - DC home-run cable by size (pumping-specific list; different from
// onGridCatalog.js's DC_CABLES, which is On_Grid.xlsx's own separate price list).
const PUMPING_DC_CABLES = [
  { sizeMm2: 4, pricePerM: 46, brand: 'Suntree' },
  { sizeMm2: 6, pricePerM: 62, brand: 'Suntree' },
  { sizeMm2: 10, pricePerM: 152, brand: 'Seval' },
  { sizeMm2: 16, pricePerM: 222.5, brand: 'Seval' },
  { sizeMm2: 25, pricePerM: 272, brand: 'Suntree' },
  { sizeMm2: 35, pricePerM: 378, brand: 'Suntree' },
  { sizeMm2: 50, pricePerM: 487, brand: 'Suntree' },
  { sizeMm2: 70, pricePerM: 712, brand: 'Suntree' },
  // 95 mm2 ("Price not supplied") deliberately omitted - the source sheet has no price for it.
];

module.exports = {
  IRRIGATION_METHODS,
  TREE_TYPES,
  SUBMERSIBLE_CABLE_SIZES,
  SUBMERSIBLE_CABLE_MAX_LENGTH_BY_HP,
  PUMPING_DC_CABLES,
};
