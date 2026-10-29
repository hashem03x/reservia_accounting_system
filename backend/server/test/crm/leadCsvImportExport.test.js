const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;

// CRM lead CSV import/export - the brief's own acceptance test: "import 3 records, re-import same
// 3, merge without duplicates." Exercises the real csvImportRunner (services/csvImport/) against
// temp files on disk, same technique as test/import/csvImport.test.js, rather than hand-built row
// arrays, so BOM/quoting genuinely round-trip.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let Lead, previewImport, commitImport, schema, leadExportService;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  require('../../models/crm/activityModel');
  require('../../models/crm/stageHistoryModel');
  await Lead.init();
  ({ previewImport, commitImport } = require('../../services/csvImport/csvImportRunner'));
  schema = require('../../utils/validators/import/crmLeadImportSchema');
  leadExportService = require('../../services/crm/leadExportService');
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await Promise.all([Lead.deleteMany({}), mongoose.connection.collection('crmactivities').deleteMany({}), mongoose.connection.collection('crmstagehistories').deleteMany({})]);
});

async function writeTempCsv(content) {
  const file = path.join(os.tmpdir(), `crm-lead-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  await fs.writeFile(file, Buffer.from(content, 'utf8'));
  return { path: file };
}

const THREE_LEADS_CSV =
  'Name,Phone,Channel,Segment,Source,Governorate,PartnerName,MonthlyBillEgp,SystemSizeKwp,ValueEgp\n' +
  'Ahmed Samir,01011111111,phone,villa,Google ads,Giza,,1800,,\n' +
  'Mona Khaled,01022222222,whatsapp,compound,Facebook,Cairo,,2200,,\n' +
  'عمر حسن,01033333333,referral,farm,Referral,Fayoum,,,10,990000\n';

maybeTest('1. previewImport: a well-formed 3-row CRM lead file (including an Arabic name) previews with all 3 valid', async () => {
  const file = await writeTempCsv(THREE_LEADS_CSV);
  const result = await previewImport(file, schema);
  assert.equal(result.totalRows, 3);
  assert.equal(result.validCount, 3);
  assert.equal(result.invalidCount, 0);
  await fs.unlink(file.path);
});

maybeTest('2. commitImport: importing the file creates exactly 3 leads', async () => {
  const file = await writeTempCsv(THREE_LEADS_CSV);
  const { created, failed } = await commitImport(file, schema, { userId: null });
  assert.equal(created.length, 3);
  assert.equal(failed.length, 0);
  assert.equal(await Lead.countDocuments({}), 3);
  await fs.unlink(file.path);
});

maybeTest("3. The brief's acceptance test: re-importing the SAME 3 rows again merges into the existing leads, creating zero duplicates", async () => {
  const first = await writeTempCsv(THREE_LEADS_CSV);
  await commitImport(first, schema, { userId: null });
  await fs.unlink(first.path);

  const second = await writeTempCsv(THREE_LEADS_CSV);
  const { created, failed } = await commitImport(second, schema, { userId: null });
  await fs.unlink(second.path);

  assert.equal(failed.length, 0);
  assert.equal(await Lead.countDocuments({}), 3, 'still exactly 3 leads after re-importing the same file');
  assert.equal(await mongoose.connection.collection('crmactivities').countDocuments({ body: /Repeat enquiry/ }), 3);
});

maybeTest('4. A row whose phone repeats WITHIN the same file merges into the row before it, rather than being rejected as a duplicate', async () => {
  const csv =
    'Name,Phone,Channel\nFirst Contact,01099988877,phone\nSecond Contact (same number),01099988877,whatsapp\n';
  const file = await writeTempCsv(csv);
  const { created, failed } = await commitImport(file, schema, { userId: null });
  await fs.unlink(file.path);
  assert.equal(failed.length, 0);
  assert.equal(created.length, 2);
  assert.equal(await Lead.countDocuments({ phoneE164: '+201099988877' }), 1);
});

maybeTest('5. An invalid channel is rejected at preview time with a clear row/column error', async () => {
  const csv = 'Name,Phone,Channel\nBad Row,01011122233,carrier_pigeon\n';
  const file = await writeTempCsv(csv);
  const result = await previewImport(file, schema);
  await fs.unlink(file.path);
  assert.equal(result.validCount, 0);
  assert.equal(result.invalidCount, 1);
  assert.ok(result.errors[0].errors.some(e => e.column === 'Channel'));
});

// ===================== Export: formula-injection protection =====================

test('sanitizeCell: a value starting with =, +, -, @, a tab or CR is prefixed so it is never read as a formula', () => {
  const { sanitizeCell } = require('../../services/crm/leadExportService');
  assert.equal(sanitizeCell('=cmd|"/c calc"!A1'), "'=cmd|\"/c calc\"!A1");
  assert.equal(sanitizeCell('+1+1'), "'+1+1");
  assert.equal(sanitizeCell('-1+1'), "'-1+1");
  assert.equal(sanitizeCell('@SUM(1,1)'), "'@SUM(1,1)");
  assert.equal(sanitizeCell('\t=1+1'), "'\t=1+1");
});

test('sanitizeCell: ordinary text (including Arabic and a plain negative-looking name) passes through unchanged', () => {
  const { sanitizeCell } = require('../../services/crm/leadExportService');
  assert.equal(sanitizeCell('Ahmed Samir'), 'Ahmed Samir');
  assert.equal(sanitizeCell('عمر حسن'), 'عمر حسن');
  assert.equal(sanitizeCell(null), '');
  assert.equal(sanitizeCell(undefined), '');
});

maybeTest('6. buildLeadExportRows: a lead whose Name was imported as a formula-like string is neutralized in the export row', async () => {
  const file = await writeTempCsv('Name,Phone,Channel\n=HYPERLINK("http://evil"),01055566677,phone\n');
  await commitImport(file, schema, { userId: null });
  await fs.unlink(file.path);

  const rows = await leadExportService.buildLeadExportRows();
  const row = rows.find(r => r[2] === '+201055566677');
  assert.ok(row);
  assert.ok(row[1].startsWith("'="), `expected the Name cell to be neutralized, got: ${row[1]}`);
});
