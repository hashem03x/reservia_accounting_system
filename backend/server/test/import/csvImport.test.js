const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;

// CSV Import System - Phase 1 (docs section "CSV Import System and Downloadable Sample
// Templates"). Tests the shared parsing/validation runner (csvImportRunner.js) directly against
// real temp CSV files (so BOM/quoting/escaping genuinely round-trip through csv-parse, not a
// hand-built row array), plus the Customer/Vendor import schemas and the permission middleware
// shared by every importer.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_csv_import';

let User, Vendor;
let previewImport, commitImport;
let customerSchema, vendorSchema;
let checkUserPermissions, Resources, Actions;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  Vendor = require('../../models/vendor/vendor');
  ({ previewImport, commitImport } = require('../../services/csvImport/csvImportRunner'));
  customerSchema = require('../../utils/validators/import/customerImportSchema');
  vendorSchema = require('../../utils/validators/import/vendorImportSchema');
  ({ checkUserPermissions } = require('../../middleware/hasPermission'));
  ({ Resources, Actions } = require('../../utils/appConstant'));
  await Promise.all([User.init(), Vendor.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Vendor.deleteMany({})]);
  seq += 1;
});

async function writeTempCsv(content, { bom = false } = {}) {
  const file = path.join(os.tmpdir(), `csv-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  const buffer = bom ? Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(content, 'utf8')]) : Buffer.from(content, 'utf8');
  await fs.writeFile(file, buffer);
  return { path: file };
}

const CUSTOMER_HEADER = 'Name,Phone,Email';

// ===================== Shared: parsing =====================

test('1. Valid CSV parsing: a well-formed file previews with the expected valid count', async () => {
  const file = await writeTempCsv(`${CUSTOMER_HEADER}\nAhmed Hassan,01012345678,ahmed@example.com\nSara Ali,01112345678,sara@example.com\n`);
  const result = await previewImport(file, customerSchema);
  assert.equal(result.totalRows, 2);
  assert.equal(result.validCount, 2);
  assert.equal(result.invalidCount, 0);
});

test('2. BOM and Arabic text: a UTF-8 BOM-prefixed file with Arabic names parses correctly', async () => {
  const file = await writeTempCsv(`${CUSTOMER_HEADER}\nأحمد حسن,01012345678,arabic@example.com\n`, { bom: true });
  const result = await previewImport(file, customerSchema);
  assert.equal(result.validCount, 1);
  assert.equal(result.previewRows[0].data.Name, 'أحمد حسن');
});

test('3. Quoted commas and escaped quotes are parsed correctly, not split as extra columns', async () => {
  const file = await writeTempCsv(`${CUSTOMER_HEADER},Street\nAhmed,01012345678,ahmed2@example.com,"12 ""Tahrir"" St, Downtown"\n`);
  const result = await previewImport(file, customerSchema);
  assert.equal(result.validCount, 1);
  assert.equal(result.previewRows[0].data.Street, '12 "Tahrir" St, Downtown');
});

test('4. Missing required headers are rejected with a clear message, nothing is parsed into rows', async () => {
  const file = await writeTempCsv('Name,Phone\nAhmed,01012345678\n');
  await assert.rejects(() => previewImport(file, customerSchema), /missing required column.*Email/i);
});

test('5. Duplicate headers in the file are rejected', async () => {
  const file = await writeTempCsv('Name,Name,Phone,Email\nAhmed,Ahmed,01012345678,ahmed3@example.com\n');
  await assert.rejects(() => previewImport(file, customerSchema), /duplicate column headers/i);
});

test('6. An empty file (header only, no data rows) is rejected', async () => {
  const file = await writeTempCsv(`${CUSTOMER_HEADER}\n`);
  await assert.rejects(() => previewImport(file, customerSchema), /no data rows/i);
});

test('7. Row-count limit: a file with more rows than the configured maximum is rejected', async () => {
  const { MAX_ROWS } = require('../../utils/csvImport/limits');
  const lines = [CUSTOMER_HEADER];
  for (let i = 0; i < MAX_ROWS + 1; i += 1) lines.push(`Person ${i},0100000${String(i).padStart(4, '0')},person${i}@example.com`);
  const file = await writeTempCsv(lines.join('\n'));
  await assert.rejects(() => previewImport(file, customerSchema), /exceeds the limit/i);
});

test('8. Invalid row reporting: a bad row reports its row number, column, and a clear explanation', async () => {
  const file = await writeTempCsv(`${CUSTOMER_HEADER}\n,01012345678,not-an-email\n`);
  const result = await previewImport(file, customerSchema);
  assert.equal(result.invalidCount, 1);
  const [err] = result.errors;
  assert.equal(err.row, 2);
  assert.ok(err.errors.some(e => e.column === 'Name'));
  assert.ok(err.errors.some(e => e.column === 'Email' && /not a valid email/i.test(e.message)));
});

test('9. Duplicate records within the uploaded file: the second occurrence is flagged, not the first', async () => {
  const file = await writeTempCsv(`${CUSTOMER_HEADER}\nAhmed,01099999999,dup@example.com\nSomeone Else,01088888888,dup@example.com\n`);
  const result = await previewImport(file, customerSchema);
  assert.equal(result.invalidCount, 1);
  assert.equal(result.errors[0].row, 3);
  assert.ok(result.errors[0].errors.some(e => e.column === 'Email' && /duplicate email/i.test(e.message)));
});

test('10. Duplicate business identifiers against EXISTING records are detected at preview time, read-only', async () => {
  await User.create({ name: 'Existing Customer', phone: '01077777777', email: 'existing@example.com', role: 'user', type: 'offline' });
  const countBefore = await User.countDocuments({});

  const file = await writeTempCsv(`${CUSTOMER_HEADER}\nNew Name,01077777777,new@example.com\n`);
  const result = await previewImport(file, customerSchema);

  assert.equal(result.invalidCount, 1);
  assert.ok(result.errors[0].errors.some(e => e.column === 'Phone' && /already exists/i.test(e.message)));
  assert.equal(await User.countDocuments({}), countBefore, 'preview must never write anything');
});

test('Unauthorized import attempts: checkUserPermissions rejects a user without the create permission, admin bypasses', async () => {
  let captured = null;
  const next = err => {
    captured = err;
  };
  const middleware = checkUserPermissions({ resource: Resources.customers, action: Actions.create });
  // Central Business Portal (docs section "Central Business Portal"): checkUserPermissions now
  // also requires active ERP system membership - every mock user below needs one to exercise the
  // SAME resource/action logic this test always covered, now under that precondition.
  const erpMembership = { system: 'ERP', role: 'operator', isActive: true };

  middleware({ user: { role: 'operator', permissions: [], systemMemberships: [erpMembership] } }, {}, next);
  assert.ok(captured, 'a user with no matching permission must be rejected');
  assert.equal(captured.statusCode, 403);

  captured = null;
  middleware({ user: { role: 'admin', permissions: [], systemMemberships: [{ ...erpMembership, role: 'admin' }] } }, {}, next);
  assert.ok(!captured, 'an admin with active ERP membership must still always bypass the resource/action check');

  captured = null;
  middleware({ user: { role: 'admin', permissions: [], systemMemberships: [] } }, {}, next);
  assert.ok(captured, 'an admin with NO active ERP membership must be rejected, even though role===admin would otherwise bypass everything');
  assert.equal(captured.statusCode, 403);
});

// ===================== Customer import =====================

test('Customer import: a valid row commits a real User with role=user, type=offline, isOffline=true, and a real customerNumber', async () => {
  const file = await writeTempCsv(`${CUSTOMER_HEADER}\nAhmed Hassan,01066666666,committed@example.com\n`);
  const { created, failed } = await commitImport(file, customerSchema);
  assert.equal(failed.length, 0);
  assert.equal(created.length, 1);

  const user = await User.findById(created[0].id);
  assert.equal(user.role, 'user');
  assert.equal(user.type, 'offline');
  assert.equal(user.isOffline, true);
  assert.ok(Number.isInteger(user.customerNumber), 'a customerNumber must be assigned (the previous insertMany-based importer never assigned one)');
});

test('Customer import: missing required field (no email) is rejected, not silently skipped or defaulted', async () => {
  const file = await writeTempCsv('Name,Phone,Email\nNo Email Guy,01055555555,\n');
  const { created, failed } = await commitImport(file, customerSchema);
  assert.equal(created.length, 0);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].errors.some(e => e.column === 'Email'));
});

test('Customer import: invalid email/phone formats are rejected per the real validation rules', async () => {
  const file = await writeTempCsv(`${CUSTOMER_HEADER}\nBad Phone,123,badphone@example.com\nBad Email,01044444444,not-an-email\n`);
  const { created, failed } = await commitImport(file, customerSchema);
  assert.equal(created.length, 0);
  assert.equal(failed.length, 2);
});

test('Customer import: duplicate business identifier (phone already in use) is reported clearly', async () => {
  await User.create({ name: 'Already Here', phone: '01033333333', email: 'already@example.com', role: 'user', type: 'offline' });
  const file = await writeTempCsv(`${CUSTOMER_HEADER}\nDuplicate Phone,01033333333,brandnew@example.com\n`);
  const { created, failed } = await commitImport(file, customerSchema);
  assert.equal(created.length, 0);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].errors.some(e => /already exists/i.test(e.message)));
});

test('Customer import: payment terms and tax/bank info are preserved (not silently dropped, unlike the previous importer)', async () => {
  const header = 'Name,Phone,Email,TaxRegistrationNumber,BankIBAN,PaymentTerms,CustomPaymentDays';
  const file = await writeTempCsv(`${header}\nFull Customer,01022222222,full@example.com,123-456,EG380019000500000000263180002,Custom,45\n`);
  const { created, failed } = await commitImport(file, customerSchema);
  assert.equal(failed.length, 0, JSON.stringify(failed));
  const user = await User.findById(created[0].id);
  assert.equal(user.taxInfo.taxRegistrationNumber, '123-456');
  assert.equal(user.bankInfo.iban, 'EG380019000500000000263180002');
  assert.equal(user.paymentTerms, 'Custom');
  assert.equal(user.customPaymentDays, 45);
});

// ===================== Vendor import =====================

const VENDOR_HEADER = 'Name,Phone,Email,Type,Street,City,State,Country';

test('Vendor import: a valid row commits a real Vendor with a real vendorNumber, name never mutated', async () => {
  const file = await writeTempCsv(`${VENDOR_HEADER}\nNile & Co.,01066677788,nileandco@example.com,current,St,City,State,Country\n`);
  const { created, failed } = await commitImport(file, vendorSchema);
  // "Nile & Co." contains "&" and "." - the real name-format rule rejects this (matches manual
  // creation exactly - the previous importer used to silently strip these characters instead).
  assert.equal(created.length, 0);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].errors.some(e => e.column === 'Name'));
});

test('Vendor import: Type defaults to "current" when the column is blank (matches manual creation; the previous importer rejected a blank Type)', async () => {
  const file = await writeTempCsv('Name,Phone,Email,Type\nNile Supplies,01066677789,nile2@example.com,\n');
  const { created, failed } = await commitImport(file, vendorSchema);
  assert.equal(failed.length, 0, JSON.stringify(failed));
  const vendor = await Vendor.findById(created[0].id);
  assert.equal(vendor.type, 'current');
  assert.ok(Number.isInteger(vendor.vendorNumber));
});

test('Vendor import: invalid payment-term/payment-info combinations are rejected', async () => {
  const header = 'Name,Phone,Email,PaymentMode,WalletIdentifier';
  // "wallet" mode requires BOTH provider and identifier - provider missing here.
  const file = await writeTempCsv(`${header}\nWallet Vendor,01066677790,walletvendor@example.com,wallet,01000000000\n`);
  const { created, failed } = await commitImport(file, vendorSchema);
  assert.equal(created.length, 0);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].errors.some(e => e.column === 'WalletProvider'));
});

test('Vendor import: duplicate vendor email within the same file is reported on the second row', async () => {
  const file = await writeTempCsv(`${VENDOR_HEADER}\nVendor One,01066677791,samevendor@example.com,current,S,C,St,Co\nVendor Two,01066677792,samevendor@example.com,current,S,C,St,Co\n`);
  const { created, failed } = await commitImport(file, vendorSchema);
  assert.equal(created.length, 1);
  assert.equal(failed.length, 1);
  assert.ok(failed[0].errors.some(e => e.column === 'Email' && /duplicate/i.test(e.message)));
});

// ===================== Templates =====================

test('Sample templates: every header has a matching example value (template and schema can never drift)', async () => {
  assert.equal(customerSchema.headers.length, customerSchema.exampleRow.length);
  assert.equal(vendorSchema.headers.length, vendorSchema.exampleRow.length);
});

// ===================== Formula-injection guard (Phase 2 hardening) =====================

test('formulaGuard#sanitizeForCsv: a value starting with =, +, -, or @ is neutralized with a leading quote; everything else passes through', () => {
  const { sanitizeForCsv } = require('../../utils/csvImport/formulaGuard');
  assert.equal(sanitizeForCsv('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.equal(sanitizeForCsv('+1234'), "'+1234");
  assert.equal(sanitizeForCsv('-1234'), "'-1234");
  assert.equal(sanitizeForCsv('@mention'), "'@mention");
  assert.equal(sanitizeForCsv('A normal value'), 'A normal value');
  assert.equal(sanitizeForCsv(''), '');
  assert.equal(sanitizeForCsv(null), null);
  assert.equal(sanitizeForCsv(42), '42');
});

test('Sample templates: the example row itself passes the schema\'s own validation', async () => {
  const customerRow = Object.fromEntries(customerSchema.headers.map((h, i) => [h, customerSchema.exampleRow[i]]));
  const { errors } = await customerSchema.validateRow(customerRow, { existingPhones: new Set(), existingEmails: new Set() });
  assert.deepEqual(errors, [], JSON.stringify(errors));

  const vendorRow = Object.fromEntries(vendorSchema.headers.map((h, i) => [h, vendorSchema.exampleRow[i]]));
  const { errors: vendorErrors } = await vendorSchema.validateRow(vendorRow, { existingPhones: new Set(), existingEmails: new Set() });
  assert.deepEqual(vendorErrors, [], JSON.stringify(vendorErrors));
});
