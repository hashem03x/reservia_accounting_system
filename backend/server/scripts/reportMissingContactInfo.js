/**
 * Read-only data-quality report (docs section "Mandatory Vendor and Customer Contact
 * Information" - "Existing data migration"): lists every Customer/Vendor with a missing or
 * malformed email/phone, so they can be remediated manually through the normal edit forms.
 *
 * Never writes anything - no record is mass-deleted, no contact info is fabricated or guessed.
 * This is purely an inspection tool for the admin to act on at their own pace.
 *
 * Usage:
 *   node server/scripts/reportMissingContactInfo.js
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { isValidPhone } = require('../utils/validators/phoneValidator');

const EMAIL_REGEX = /\S+@\S+\.\S+/;

function describeIssues({ phone, email }) {
  const issues = [];
  if (!phone) issues.push('missing phone');
  else if (!isValidPhone(phone)) issues.push('invalid phone format');
  if (!email) issues.push('missing email');
  else if (!EMAIL_REGEX.test(email)) issues.push('invalid email format');
  return issues;
}

async function reportMissingContactInfo() {
  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const mongooseConn = await mongoose.connect(process.env.DB_URI);
  const connection = mongooseConn.connection;
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);

  await assertNotLeopardDatabase(connection);

  // Raw collection reads (not the Mongoose models) - this is a read-only report, so there is no
  // need to pay for populate/hooks, and it avoids any risk of accidentally triggering a write
  // side-effect from a model's own save/validation hooks.
  const users = connection.collection('users');
  const vendors = connection.collection('vendors');

  const customers = await users.find({ role: 'user' }, { projection: { name: 1, phone: 1, email: 1, customerNumber: 1 } }).toArray();
  const vendorDocs = await vendors.find({}, { projection: { name: 1, contact: 1, vendorNumber: 1 } }).toArray();

  const flaggedCustomers = [];
  for (const c of customers) {
    const issues = describeIssues({ phone: c.phone, email: c.email });
    if (issues.length > 0) flaggedCustomers.push({ _id: c._id, name: c.name, customerNumber: c.customerNumber, issues });
  }

  const flaggedVendors = [];
  for (const v of vendorDocs) {
    const issues = describeIssues({ phone: v.contact?.phone, email: v.contact?.email });
    if (issues.length > 0) flaggedVendors.push({ _id: v._id, name: v.name, vendorNumber: v.vendorNumber, issues });
  }

  console.log(`\nCustomers checked: ${customers.length}. Flagged: ${flaggedCustomers.length}.`);
  for (const c of flaggedCustomers) {
    console.log(`  - [${c._id}] ${c.name || '(no name)'} (customerNumber ${c.customerNumber ?? 'n/a'}): ${c.issues.join(', ')}`);
  }

  console.log(`\nVendors checked: ${vendorDocs.length}. Flagged: ${flaggedVendors.length}.`);
  for (const v of flaggedVendors) {
    console.log(`  - [${v._id}] ${v.name || '(no name)'} (vendorNumber ${v.vendorNumber ?? 'n/a'}): ${v.issues.join(', ')}`);
  }

  console.log('\nNo records were modified - this is a report only.');

  return { customersChecked: customers.length, customersFlagged: flaggedCustomers.length, vendorsChecked: vendorDocs.length, vendorsFlagged: flaggedVendors.length };
}

reportMissingContactInfo()
  .then(async () => {
    await mongoose.disconnect();
    console.log('\nDisconnected. Done.');
    process.exit(0);
  })
  .catch(async err => {
    console.error('\nreportMissingContactInfo failed:');
    if (err instanceof SafetyError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    try {
      await mongoose.disconnect();
    } catch {
      // already disconnected / never connected - nothing to clean up
    }
    process.exit(1);
  });
