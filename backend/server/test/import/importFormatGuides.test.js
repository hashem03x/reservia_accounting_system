const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');

// Client requirement "Import Files - Format Documentation": every CSV importer documents each of its
// columns (purpose, required / optional, format, allowed values, max length, example), the
// documentation can never drift from the importer itself, and it is a separate download - the data
// template stays a clean header + example rows the parser accepts.

const { specProblems, formatGuideHandler, guideRows } = require('../../utils/csvImport/formatGuide');

const IMPORTERS = ['customer', 'vendor', 'product', 'po', 'poInvoice', 'salesInvoice'].map(name => ({ name, schema: require(`../../utils/validators/import/${name}ImportSchema`) }));

test('every importer documents exactly its own columns, and required columns are documented as required', () => {
  for (const { name, schema } of IMPORTERS) {
    assert.ok(Array.isArray(schema.fieldSpecs) && schema.fieldSpecs.length > 0, `${name} has a format guide`);
    assert.deepEqual(specProblems(schema), [], `${name}: ${specProblems(schema).join('; ')}`);
    assert.deepEqual(schema.fieldSpecs.map(s => s.column), schema.headers, `${name}: one spec per column, in template order`);
    for (const spec of schema.fieldSpecs) {
      assert.ok(['yes', 'no', 'conditional'].includes(spec.required), `${name}.${spec.column} required flag`);
      assert.ok(spec.format, `${name}.${spec.column} has a format`);
    }
  }
});

test('the sample templates are clean data files: header + example rows of the same width, no instruction rows', () => {
  for (const { name, schema } of IMPORTERS) {
    const rows = schema.exampleRows || [schema.exampleRow];
    for (const row of rows) assert.equal(row.length, schema.headers.length, `${name}: example row width`);
  }
});

function collectResponse() {
  const res = new PassThrough();
  const headers = {};
  let jsonBody = null;
  let statusCode = 200;
  res.setHeader = (k, v) => {
    headers[k.toLowerCase()] = v;
  };
  res.status = code => {
    statusCode = code;
    return res;
  };
  res.json = body => {
    jsonBody = body;
    res.end();
    return res;
  };
  const chunks = [];
  res.on('data', c => chunks.push(c));
  const done = new Promise(resolve => res.on('end', () => resolve({ headers, statusCode, jsonBody, text: Buffer.concat(chunks).toString('utf8') })));
  return { res, done };
}

test('the guide is served as JSON for the import screen and as a separate CSV download', async () => {
  const { schema } = IMPORTERS.find(i => i.name === 'vendor');
  const handler = formatGuideHandler(schema, 'reservia-vendors-format-guide.csv');

  const json = collectResponse();
  await handler({ query: {} }, json.res, err => assert.fail(err));
  const { jsonBody } = await json.done;
  assert.deepEqual(jsonBody.data.columns.map(c => c.column), schema.headers);
  assert.ok(jsonBody.data.general.some(g => /UTF-8/.test(g.text)));

  const csv = collectResponse();
  await handler({ query: { format: 'csv' } }, csv.res, err => assert.fail(err));
  const { headers, text } = await csv.done;
  assert.match(headers['content-type'], /text\/csv/);
  assert.match(headers['content-disposition'], /reservia-vendors-format-guide\.csv/);
  assert.match(text, /Section,Column,Required,Description,Format \/ allowed values,Max length,Example/);
  assert.match(text, /AdditionalPaymentAccounts/);
  assert.equal(guideRows(schema).filter(r => r.section === 'Columns').length, schema.headers.length);
});

test('the guide states the real limits the parser enforces (e.g. vendor name length, IBAN, withholding values)', () => {
  const spec = (name, column) => IMPORTERS.find(i => i.name === name).schema.fieldSpecs.find(s => s.column === column);
  assert.equal(spec('vendor', 'Name').maxLength, 50);
  assert.match(spec('customer', 'BankIBAN').format, /29 characters/);
  assert.match(spec('salesInvoice', 'WithholdingTaxPercentage').format, /0, 1, 3 or 5/);
  assert.match(spec('product', 'Cost').description, /optional/i);
  assert.equal(spec('product', 'Price').required, 'no');
});

