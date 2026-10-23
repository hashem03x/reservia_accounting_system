/**
 * READ-ONLY audit of historical Accounts Receivable attribution (client requirement "Accounts
 * Receivable Entry - the AR entry was not tagged to the underlying client").
 *
 * Until this fix, the revenue / cost recognition entries of a Sales Invoice (JV0010
 * PROJECT_REVENUE_RECOGNITION, JV0011 PROJECT_COST_RECOGNITION) took their customer Sub Account from
 * the PROJECT's customer first - so an invoice issued to a different customer than the project's
 * recorded its receivable under the project's customer, while its payments went to the invoice's
 * customer. New entries now use the invoice's own customer
 * (accountingEventService.js#resolveProjectCustomerNumber).
 *
 * This script lists the posted historical entries affected, i.e. whose line Sub Account differs
 * from the customer of the Sales Invoice that triggered them, with the amount on Accounts
 * Receivable. It NEVER changes anything: correcting a posted entry is an accounting decision (a
 * reversal + re-posting through the Journal Entries screen), not something to rewrite silently.
 * Lines with NO Sub Account at all are covered by the existing report:
 *   npm run db:repair-sub-accounts            (report-only by default)
 *
 * Usage:
 *   npm run db:audit-ar-attribution
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { AutomaticJournalAccountCodes } = require('../utils/accountingConstants');

async function auditArCustomerAttribution({ connect = true, log = console.log } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    log('Connecting to database...');
    await mongoose.connect(process.env.DB_URI);
    const dbName = assertSafeDatabaseName(mongoose.connection);
    log(`Connected (host: ${mongoose.connection.host}, db: ${dbName}).`);
    await assertNotLeopardDatabase(mongoose.connection);
  }
  const db = mongoose.connection;
  const ar = await db.collection('chartofaccounts').findOne({ code: AutomaticJournalAccountCodes.accountsReceivableProjects }, { projection: { _id: 1, code: 1 } });

  const entries = await db
    .collection('journalentries')
    .find({ accountingAction: { $in: ['PROJECT_REVENUE_RECOGNITION', 'PROJECT_COST_RECOGNITION'] }, triggeredBySalesOrder: { $ne: null }, status: { $in: ['posted', 'reversed'] } }, { projection: { entryNumber: 1, accountingAction: 1, status: 1, date: 1, triggeredBySalesOrder: 1, lines: 1, project: 1 } })
    .toArray();
  const orderIds = [...new Set(entries.map(e => String(e.triggeredBySalesOrder)))].map(id => new mongoose.Types.ObjectId(id));
  const orders = await db.collection('salesorders').find({ _id: { $in: orderIds } }, { projection: { code: 1, customer: 1 } }).toArray();
  const customers = await db.collection('users').find({ _id: { $in: orders.map(o => o.customer).filter(Boolean) } }, { projection: { customerNumber: 1, name: 1 } }).toArray();
  const customerById = new Map(customers.map(c => [String(c._id), c]));
  const orderById = new Map(orders.map(o => [String(o._id), o]));

  const findings = [];
  for (const entry of entries) {
    const order = orderById.get(String(entry.triggeredBySalesOrder));
    const invoiceCustomer = order?.customer ? customerById.get(String(order.customer)) : null;
    if (!invoiceCustomer || invoiceCustomer.customerNumber == null) continue;
    const parties = [...new Set((entry.lines || []).filter(l => l.partyType === 'customer').map(l => l.partyNumber))];
    if (parties.length === 1 && parties[0] === invoiceCustomer.customerNumber) continue;
    const arAmount = (entry.lines || []).filter(l => ar && String(l.account) === String(ar._id)).reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0);
    findings.push({
      entryNumber: entry.entryNumber,
      action: entry.accountingAction,
      status: entry.status,
      salesInvoice: order.code || String(order._id),
      invoiceCustomerNumber: invoiceCustomer.customerNumber,
      invoiceCustomerName: invoiceCustomer.name,
      recordedCustomerNumbers: parties,
      accountsReceivableAmount: Math.round(arAmount * 100) / 100,
    });
  }

  log(`Recognition entries checked: ${entries.length}`);
  log(`Attributed to a different customer than their Sales Invoice: ${findings.length}`);
  findings.forEach(f =>
    log(`  - JE #${f.entryNumber} (${f.action}, ${f.status}) - invoice ${f.salesInvoice}: customer ${f.invoiceCustomerNumber} (${f.invoiceCustomerName}), recorded as ${f.recordedCustomerNumbers.join(', ') || 'none'}; AR ${f.accountsReceivableAmount}`)
  );
  log('\nRead-only: nothing was changed. Correct an entry by reversing and re-posting it from Journal Entries if the business confirms it.');
  return { checked: entries.length, findings };
}

if (require.main === module) {
  auditArCustomerAttribution()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:audit-ar-attribution failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { auditArCustomerAttribution };
