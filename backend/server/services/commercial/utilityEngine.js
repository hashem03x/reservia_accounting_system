// Utility-Scale engine - On_Grid.xlsx's `Utility-Scale BOQ` sheet reuses the exact same equipment
// design chain as On-Grid (`On-Grid Design`), adding 8 extra line items (rows 15-21) that are
// completely BLANK in the source workbook - no formula, no assumed quantity, no assumed price.
// The sheet's own note: "New utility-scale items have no assumed quantities or prices; total
// includes only entered amounts." These are manual commercial-team entries here too - the HTML
// brief's 4% (safety/fire)/0.5% (insurance)/50 EGP per kWp (grid sync) percentages have NO Excel
// source and are deliberately NOT applied as defaults (see the implementation plan's discrepancy
// list, item 8).

'use strict';

const onGrid = require('./onGridEngine');

// Utility-Scale BOQ!A23:A33 - component names only, every quantity/price left for manual entry.
const MANUAL_ADDER_COMPONENTS = [
  { no: 15, component: 'Safety', description: 'Safety systems and provisions', unit: 'lot' },
  { no: '15.1', component: 'Maintenance Walkways', description: 'Maintenance access walkways', unit: 'lot' },
  { no: '15.2', component: 'Skylight Covers', description: 'Skylight protective covers', unit: 'lot' },
  { no: '15.3', component: 'Fall Protection & Lifeline System', description: 'Roof fall protection, anchor points and lifeline system', unit: 'lot' },
  { no: '15.4', component: 'Fire Detection & Firefighting System', description: 'Fire detection, firefighting and site system integration', unit: 'lot' },
  { no: 16, component: 'SCADA System', description: 'Supervisory Control and Data Acquisition system', unit: 'lot' },
  { no: 17, component: 'Insurance', description: 'Project insurance', unit: 'lot' },
  { no: 18, component: 'First-Year Installation Warranty', description: 'Installation workmanship warranty - Year 1', unit: 'lot' },
  { no: 19, component: 'Integrated Emergency System', description: 'Emergency system integrated with PV plant', unit: 'lot' },
  { no: 20, component: 'Testing, Commissioning & Grid Synchronization', description: 'PV system testing, commissioning and grid synchronization', unit: 'lot' },
  { no: 21, component: 'Weather Monitoring Station', description: 'Irradiance, module temperature and environmental monitoring equipment', unit: 'lot' },
];

/**
 * Runs the On-Grid design/BOQ chain, then appends the manual adder slots (qty/unitPrice/total
 * null until the commercial team fills them in - never defaulted to 0 or to the brief's
 * unsupported percentages).
 */
function runUtilityScaleDesign(input, catalog, manualAdderEntries = {}) {
  const result = onGrid.runOnGridDesign(input, catalog);
  const adderLines = MANUAL_ADDER_COMPONENTS.map(c => {
    const entry = manualAdderEntries[c.no];
    const qty = entry?.qty ?? null;
    const unitPrice = entry?.unitPrice ?? null;
    return { ...c, qty, unitPrice, total: qty != null && unitPrice != null ? qty * unitPrice : null, source: 'manual' };
  });
  const adderTotal = adderLines.reduce((s, l) => s + (l.total || 0), 0);
  return {
    ...result,
    boq: {
      ...result.boq,
      lines: [...result.boq.lines, ...adderLines],
      total: result.boq.total + adderTotal,
    },
  };
}

module.exports = { MANUAL_ADDER_COMPONENTS, runUtilityScaleDesign };
