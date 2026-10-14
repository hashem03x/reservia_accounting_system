/**
 * One-time, additive setup for the new atomic Sales/Purchase Order code counters
 * (services/shared/orderNumberService.js), which replace the old race-prone
 * `Model.countDocuments({}) + 1` code generator (see docs section "Order code fix").
 *
 * Seeds each counter's starting `seq` from the MAX existing numeric code already in that
 * collection (not 0) - so the very next order created after this script runs continues the real
 * historical sequence instead of colliding with existing codes. Does nothing destructive: it never
 * touches any SalesOrder/PurchaseOrder document, only creates/updates the two `counters` documents
 * (`salesOrderCode`, `purchaseOrderCode`). Safe to run more than once (idempotent: re-running after
 * new orders were created with the new atomic generator only ever raises the seeded `seq`, matching
 * reality - it never lowers it below what's already been issued).
 *
 * Usage:
 *   node server/scripts/seedOrderNumberCounters.js --dry-run   # report only, no writes
 *   node server/scripts/seedOrderNumberCounters.js --yes       # perform the seed
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { SALES_ORDER_SEQUENCE_NAME, PURCHASE_ORDER_SEQUENCE_NAME } = require('../services/shared/orderNumberService');

const RANGE_MIN = 1;
const RANGE_MAX = 999999999999;

async function maxExistingCode(collection) {
  const docs = await collection.find({ code: { $exists: true, $ne: null } }, { projection: { code: 1 } }).toArray();
  let max = 0;
  for (const doc of docs) {
    const n = parseInt(doc.code, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

async function seedCounter(countersCollection, sequenceName, seedSeq, dryRun) {
  const existing = await countersCollection.findOne({ _id: sequenceName });
  const targetSeq = Math.max(seedSeq, existing?.seq || 0);

  console.log(`  - ${sequenceName}: existing counter seq=${existing?.seq ?? '(none)'}, max code found=${seedSeq}, target seq=${targetSeq}`);

  if (dryRun) return;

  await countersCollection.updateOne(
    { _id: sequenceName },
    { $max: { seq: targetSeq }, $setOnInsert: { min: RANGE_MIN, max: RANGE_MAX } },
    { upsert: true }
  );
}

async function seedOrderNumberCounters() {
  const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--yes');

  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const mongooseConn = await mongoose.connect(process.env.DB_URI);
  const connection = mongooseConn.connection;
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);

  await assertNotLeopardDatabase(connection);

  const salesOrders = connection.collection('salesorders');
  const purchaseOrders = connection.collection('purchaseorders');
  const counters = connection.collection('counters');

  const maxSalesCode = await maxExistingCode(salesOrders);
  const maxPurchaseCode = await maxExistingCode(purchaseOrders);

  console.log(`\nHighest existing Sales Order code: ${maxSalesCode}`);
  console.log(`Highest existing Purchase Order code: ${maxPurchaseCode}\n`);

  await seedCounter(counters, SALES_ORDER_SEQUENCE_NAME, maxSalesCode, dryRun);
  await seedCounter(counters, PURCHASE_ORDER_SEQUENCE_NAME, maxPurchaseCode, dryRun);

  if (dryRun) {
    console.log('\n--dry-run (default): no changes made. Re-run with --yes to apply.');
  } else {
    console.log('\nDone - counters seeded.');
  }
}

seedOrderNumberCounters()
  .then(async () => {
    await mongoose.disconnect();
    console.log('Disconnected.');
    process.exit(0);
  })
  .catch(async err => {
    console.error('\nseedOrderNumberCounters failed:');
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
