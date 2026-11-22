const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// B6 - services/customer/sharedCustomerService.js is the ONE customer-matching mechanism both the
// CRM -> Commercial handoff and the Commercial -> ERP Won handoff (services/crm/wonToErpService.js)
// call into, plus the Deal Engine's own inline "create customer" action (projectController.js) - a
// Deal Engine customer is never a second, Commercial-only record, always the same shared `User`
// (role: 'user') collection the ERP's Sales/Purchase screens already use. Despite being this
// central, it had no dedicated test file before this change - everything below is new coverage,
// not a rewrite of existing tests. Pure User.create/find (no multi-document transaction in the
// success path), so this runs for real on a standalone Mongo, unlike the full Won handover.
const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_shared_customer';

let User, sharedCustomers;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../models/userModel');
  sharedCustomers = require('../services/customer/sharedCustomerService');
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('findOrCreateCustomer creates a new shared User (role: user) when no phone match exists', async () => {
  const { customer, created } = await sharedCustomers.findOrCreateCustomer({ name: 'Ahmed Ali', phone: '01211892995', email: 'ahmed.ali@example.com' });
  assert.equal(created, true);
  assert.ok(customer._id);
  assert.equal(customer.name, 'Ahmed Ali');

  const stored = await User.findById(customer._id).lean();
  assert.equal(stored.role, 'user');
  assert.equal(stored.isOffline, true); // never given a real login - an offline/CRM-created customer record
});

test('findOrCreateCustomer recognizes the SAME phone under any of its stored spellings - never duplicates', async () => {
  const first = await sharedCustomers.findOrCreateCustomer({ name: 'Mona Said', phone: '01022334455' });
  assert.equal(first.created, true);

  for (const spelling of ['01022334455', '+201022334455', '201022334455', '00201022334455']) {
    // eslint-disable-next-line no-await-in-loop
    const again = await sharedCustomers.findOrCreateCustomer({ name: 'Mona Said (resubmitted)', phone: spelling });
    assert.equal(again.created, false, `expected "${spelling}" to match the existing customer`);
    assert.equal(String(again.customer._id), String(first.customer._id));
    // The ORIGINAL name is kept - a later submission with a different name for the same phone
    // never silently overwrites the record it matched.
    assert.equal(again.customer.name, 'Mona Said');
  }
});

test('findOrCreateCustomer also matches on additionalPhone, not just the primary phone', async () => {
  const primary = await User.create({ name: 'Primary Phone Owner', phone: '01033445566', additionalPhone: '01144556677', role: 'user', isOffline: true, type: 'offline' });
  const { customer, created } = await sharedCustomers.findOrCreateCustomer({ name: 'Someone else entirely', phone: '01144556677' });
  assert.equal(created, false);
  assert.equal(String(customer._id), String(primary._id));
});

test('findOrCreateCustomer stores the email only when no other user already holds it; never fails the create over a taken email', async () => {
  await User.create({ name: 'Email Holder', phone: '01055667788', email: 'taken@example.com', role: 'user', isOffline: true, type: 'offline' });

  const { customer } = await sharedCustomers.findOrCreateCustomer({ name: 'New Customer', phone: '01066778899', email: 'taken@example.com' });
  assert.equal(customer.email, undefined); // silently dropped, not an error - User.email is unique

  const fresh = await sharedCustomers.findOrCreateCustomer({ name: 'Fresh Email Customer', phone: '01077889900', email: 'fresh@example.com' });
  assert.equal(fresh.customer.email, 'fresh@example.com');
});

test('findOrCreateCustomer rejects a missing name or an invalid/missing phone - never creates a customer from incomplete data', async () => {
  await assert.rejects(sharedCustomers.findOrCreateCustomer({ name: '', phone: '01011112222' }), /name is required/i);
  await assert.rejects(sharedCustomers.findOrCreateCustomer({ name: 'No Phone' }), /valid customer phone/i);
  await assert.rejects(sharedCustomers.findOrCreateCustomer({ name: 'Bad Phone', phone: '123' }), /valid customer phone/i);
});

test('findOrCreateCustomer: a concurrent create for the SAME new phone never duplicates the customer - the race loser gets the winner back', async () => {
  const phone = '01099887766';
  const results = await Promise.all([
    sharedCustomers.findOrCreateCustomer({ name: 'Racer A', phone }),
    sharedCustomers.findOrCreateCustomer({ name: 'Racer B', phone }),
  ]);
  assert.equal(results.filter(r => r.created).length, 1, 'exactly one of the two concurrent creates should have actually inserted');
  assert.equal(String(results[0].customer._id), String(results[1].customer._id));
  assert.equal(await User.countDocuments({ phone: { $in: sharedCustomers.phoneVariants(phone) } }), 1);
});

test('searchCustomers matches by name, email, customerNumber and any phone spelling, scoped to role: user and never soft-deleted', async () => {
  const target = await User.create({ name: 'Searchable Customer', phone: '01211119999', email: 'searchable@example.com', role: 'user', isOffline: true, type: 'offline' });
  await User.create({ name: 'Searchable Customer (deleted)', phone: '01211110000', role: 'user', isOffline: true, type: 'offline', isDeleted: true });
  await User.create({ name: 'Searchable Staff', phone: '01211118888', role: 'admin' });

  const byName = await sharedCustomers.searchCustomers('Searchable Customer');
  assert.ok(byName.some(c => String(c._id) === String(target._id)));
  assert.ok(!byName.some(c => c.name === 'Searchable Staff'), 'a staff User (role !== user) must never be returned');
  assert.ok(!byName.some(c => c.name.includes('deleted')), 'a soft-deleted User must never be returned');

  const byPhoneSpelling = await sharedCustomers.searchCustomers('+201211119999');
  assert.ok(byPhoneSpelling.some(c => String(c._id) === String(target._id)));

  const byCustomerNumber = await sharedCustomers.searchCustomers(String(target.customerNumber));
  assert.ok(byCustomerNumber.some(c => String(c._id) === String(target._id)));
});
