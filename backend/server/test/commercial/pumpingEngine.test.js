const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../../services/commercial/pumpingEngine');
const pumpCatalog = require('../../services/commercial/catalogData/pumpingCatalog');
const extras = require('../../services/commercial/catalogData/pumpingExtras');
const onGridCatalog = require('../../services/commercial/catalogData/onGridCatalog');

// Fixtures: Solar_Pumping3.xlsx's own live example (Agricultural Load sheet) - 20 feddan rice
// (flood, 2-day interval, 5 sun hours) + 30 feddan pomegranate (tree code 7, 2-day interval),
// water level 60 m, well depth 60 m, safety 5 m. Ground truth for the pump/motor selection was
// re-extracted directly from the live workbook (Design!A6:G6/A10:E10), not hand-transcribed, after
// finding that hand-reading a 513-row catalog from truncated text risks exactly the kind of
// transcription error this project is trying to avoid (see pumpingCatalog.js's header comment).
const JINKO_670 = onGridCatalog.PV_MODULES.find(m => m.model === 'JKM670N-66QL6-BDV');

function waterDemand() {
  return engine.computeWaterDemand(
    {
      fieldCropRows: [{ areaFeddan: 20, irrigationCode: 1, intervalDays: 2, sunHours: 5 }],
      treeRows: [{ areaFeddan: 30, treeCode: 7, intervalDays: 2 }], // Pomegranate / Apple
      waterLevelM: 60,
      safetyAllowanceM: 5,
    },
    { irrigationMethods: extras.IRRIGATION_METHODS, treeTypes: extras.TREE_TYPES }
  );
}

test('Agricultural Load: combined flow and head (Agricultural Load!H31/H32)', () => {
  const r = waterDemand();
  assert.equal(round(r.totalFlowM3h, 2), 128.8);
  assert.equal(r.pressureAllowanceM, 30); // flood(+10) + any-tree-area(+20)
  assert.equal(r.totalHeadM, 95);
});

test('Design: nearest-match pump selection over the full 513-row catalog (Design!A6:G6)', () => {
  const { totalFlowM3h, totalHeadM } = waterDemand();
  const pump = engine.selectPump({ requiredFlowM3h: totalFlowM3h, requiredHeadM: totalHeadM, pumps: pumpCatalog.PUMPS });
  assert.equal(pump.model, 'SP 120/05A');
  assert.equal(pump.casing, '8"');
  assert.equal(pump.hp, 60);
  assert.equal(pump.flowM3h, 130);
  assert.equal(pump.headM, 95);
  assert.equal(pump.price, 97755);
});

test('Design: motor selection by casing + HP (Design!A10:E10)', () => {
  const pump = { casing: '8"', hp: 60 };
  const motor = engine.selectMotor({ pump, motors: pumpCatalog.MOTORS });
  assert.equal(motor.model, 'FM-60');
  assert.equal(motor.kw, 45);
  assert.equal(motor.castIronPrice, 113219);
});

test('Design: PV sizing from motor kW (Design!D14/E14)', () => {
  const r = engine.sizePvForMotor({ motorKw: 45, module: JINKO_670 });
  assert.equal(r.modulesRequired, 91);
  assert.equal(round(r.installedKwp, 2), 60.97);
});

test('Design: string design (Design!B40/C40/D40)', () => {
  const r = engine.sizeStrings({ modulesRequired: 91, modulesPerString: 13, module: JINKO_670 });
  assert.equal(r.strings, 7);
  assert.equal(r.installedModules, 91);
  assert.equal(round(r.installedKwp, 2), 60.97);
});

test('Design: submersible cable sizing (Design!D30/E30)', () => {
  const r = engine.sizeSubmersibleCable({ motorHp: 60, wellDepthM: 60, extraCableM: 10, catalog: extras });
  assert.equal(r.cableLengthM, 90);
  assert.equal(r.size, '3x25');
});

test('Design: DC home-run cable by voltage drop (Design!A47/B47/D47/E47)', () => {
  const extrasData = require('../../services/commercial/catalogData/pumpingExtras');
  const r = engine.sizeDcCable({
    installedKwp: 60.97,
    strings: 7,
    module: JINKO_670,
    stringVmpStc: 13 * JINKO_670.vmp,
    dcCables: extrasData.PUMPING_DC_CABLES,
  });
  assert.equal(r.totalLengthM, 610);
  assert.equal(round(r.requiredMm2, 4), 2.1332);
  assert.equal(r.selectedSizeMm2, 4);
  assert.equal(r.pricePerM, 46);
  assert.equal(r.totalCost, 28060);
});

test('Pipe diameter band is a real formula (Design!B24); priced selection stays manual', () => {
  assert.equal(engine.pipeDiameterBand(70), 3);
  assert.equal(engine.pipeDiameterBand(128.8), 5);
  assert.equal(engine.pipeDiameterBand(200), 6);
});

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
