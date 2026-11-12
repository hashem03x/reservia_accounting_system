const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGovernorate, GOVERNORATES } = require('../../utils/crm/constants');
const { mapWebsitePayload, buildIntakeNote } = require('../../services/crm/publicLeadIntakeService');
const { regionForGovernorate } = require('../../utils/commercial/regions');

// CRM Changes Required (12 Nov 2026), item 1: the website form's free-text location becomes the
// official governorate the Deal Engine can map to a Rates region - or none, so it is asked at Qualified.

test('every official governorate resolves from its English and Arabic name, and maps to a Rates region', () => {
  for (const g of GOVERNORATES) {
    assert.equal(normalizeGovernorate(g.en), g.en, g.en);
    assert.equal(normalizeGovernorate(g.ar), g.en, g.ar);
    assert.ok(regionForGovernorate(g.en), `${g.en} has a Rates region`);
  }
});

test('case, spacing, punctuation, a "Governorate" word, alef/ta-marbuta variants and common spellings all resolve', () => {
  const cases = {
    '  cairo ': 'Cairo',
    'Cairo Governorate': 'Cairo',
    'محافظة القاهرة': 'Cairo',
    'الاسكندرية': 'Alexandria',
    'port-said': 'Port Said',
    'Kafr el-Sheikh': 'Kafr El Sheikh',
    'El Minya': 'Minya',
    Sharkia: 'Sharqia',
    Menofia: 'Menoufia',
    Asyut: 'Assiut',
    'Bani Suef': 'Beni Suef',
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(normalizeGovernorate(input), expected, input);
});

test('anything that is not a governorate returns null (never a guess)', () => {
  for (const input of ['', '   ', null, undefined, 'Atlantis', '6th of October', 'Maadi', 'Cairo Giza']) assert.equal(normalizeGovernorate(input), null, String(input));
});

test('website form: a recognized location is stored as the governorate; an unrecognized one is kept on the intake note instead', () => {
  const base = { name: 'Visitor', phone: '01012345678', segment: 'villas', source: 'contact_form' };
  assert.equal(mapWebsitePayload({ ...base, governorate: 'الجيزة' }).governorate, 'Giza');
  assert.equal(mapWebsitePayload({ ...base, governorate: 'Maadi' }).governorate, undefined);
  assert.match(buildIntakeNote({ governorate: 'Maadi' }), /Location typed on the form \(not a recognized governorate.*\): Maadi/);
  assert.doesNotMatch(buildIntakeNote({ governorate: 'Giza' }), /Location typed/);
});

test('Deal Engine C26: the A3 city table maps a lead location to its Rates region (Giza -> Cairo - 10th of Ramadan); unknown places fall back to the governorate table', () => {
  const { engineSettings, regionForPlace } = require('../../services/commercial/dealEngineSettings');
  const { projectHeaderFromLead } = require('../../services/crm/commercialHandoffService');
  const e = engineSettings({});
  assert.equal(Object.keys(e.cityRegions).length, 31);
  assert.equal(regionForPlace(e, 'Giza'), 'Cairo - 10th of Ramadan');
  assert.equal(projectHeaderFromLead({ name: 'X', segment: 'villa', governorate: 'Giza' }, { cityRegions: e.cityRegions }).region, 'Cairo - 10th of Ramadan');
  assert.equal(projectHeaderFromLead({ name: 'X', segment: 'villa', governorate: 'Alexandria' }, { cityRegions: e.cityRegions }).region, 'Damanhour - Kafr El Sheikh - Mansoura');
  assert.equal(projectHeaderFromLead({ name: 'X', segment: 'villa', governorate: 'New Valley' }, { cityRegions: e.cityRegions }).region, 'Kharga - Dakhla - Farafra Oases', 'not in A3 -> governorate table');
});
