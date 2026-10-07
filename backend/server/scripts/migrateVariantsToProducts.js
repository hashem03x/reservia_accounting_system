/**
 * One-time, non-destructive migration for the Product/Variant architecture change (see
 * docs/entities/products.md): Product is now the sellable/stock-tracked item directly, and the
 * separate Variant collection/model has been removed from the running app.
 *
 * This script brings EXISTING data in line with the new shape:
 *
 *   1. Products: for every product that has associated Variant documents and no `stock` of its
 *      own yet, collapses all of that product's variants' per-warehouse stock into the product's
 *      own `stock` array (summed per warehouse), and backfills `sku`/`barcode` from the first
 *      variant that has one (generating a fresh barcode if none of its variants had one).
 *   2. PurchaseOrder.items[].variantId  -> items[].productId
 *   3. SalesOrder.items[].variant       -> items[].product
 *   4. PurchaseOrderReturn.variantId    -> productId
 *   5. SalesOrderReturn.variantId       -> productId
 *   6. Transfer: legacy `type: 'variant'/'variants'` -> `'products'`; `details[].variant` (and a
 *      legacy top-level `variant` field, if present) -> `.product`.
 *   7. Movement: legacy `variant` field (if present, with no `product` already set) -> `product`.
 *
 * Non-destructive by design: every step only ADDS the new field(s) alongside the old ones via
 * $set - it never deletes a document, never drops the `variants` collection, and never removes an
 * old field (variantId/variant stay in place, simply unused by the new code going forward). This
 * is intentional per the architecture-change spec ("never delete production data automatically").
 * Idempotent: every step's query only matches documents that still need it (old field present,
 * new field not yet set), so documents already migrated - or created fresh after this deploy,
 * which never had the old fields - are simply skipped. Safe to re-run.
 *
 * Collapsing variants into one product's `stock` is lossy at the color/size sub-detail level only
 * (a product has one sku/barcode/stock-per-warehouse now, not one per color/size combination) -
 * this is the accepted, approved consequence of the architecture change; quantities themselves are
 * preserved exactly (summed per warehouse, not discarded).
 *
 * Usage:
 *   node server/scripts/migrateVariantsToProducts.js --dry-run   # report only, no writes
 *   node server/scripts/migrateVariantsToProducts.js             # perform the migration
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const generateBarcode = require('../utils/generateBarcode');

async function migrateVariantsToProducts() {
  const dryRun = process.argv.includes('--dry-run');

  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const mongooseConn = await mongoose.connect(process.env.DB_URI);
  const connection = mongooseConn.connection;
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);

  await assertNotLeopardDatabase(connection);

  const db = connection.db;
  const collections = new Set((await db.listCollections().toArray()).map(c => c.name));

  const report = {
    products: { candidates: 0, updated: 0 },
    purchaseOrders: { candidates: 0, itemsRewritten: 0, docsUpdated: 0 },
    salesOrders: { candidates: 0, itemsRewritten: 0, docsUpdated: 0 },
    purchaseOrderReturns: { candidates: 0, updated: 0 },
    salesOrderReturns: { candidates: 0, updated: 0 },
    transfers: { candidates: 0, updated: 0 },
    movements: { candidates: 0, updated: 0 },
  };

  // =============================================================
  // Step 1: Build a variantId -> { productId, sku, barcode } map, and group variants by product.
  // =============================================================
  const variantsByProduct = new Map(); // productId(str) -> array of variant docs
  const variantToProduct = new Map(); // variantId(str) -> productId(str)

  if (collections.has('variants')) {
    const variantsCursor = db.collection('variants').find({});
    for await (const variant of variantsCursor) {
      if (!variant.productId) continue;
      const productIdStr = variant.productId.toString();
      variantToProduct.set(variant._id.toString(), productIdStr);
      if (!variantsByProduct.has(productIdStr)) variantsByProduct.set(productIdStr, []);
      variantsByProduct.get(productIdStr).push(variant);
    }
  }
  console.log(`\nFound ${variantToProduct.size} variant document(s) across ${variantsByProduct.size} product(s).`);

  // =============================================================
  // Step 2: Products - collapse each product's variants into its own stock/sku/barcode.
  // =============================================================
  const productsCol = db.collection('products');
  const productUpdates = [];

  for (const [productIdStr, variants] of variantsByProduct) {
    const product = await productsCol.findOne({ _id: new mongoose.Types.ObjectId(productIdStr) }, { projection: { stock: 1 } });
    if (!product) continue; // orphaned variants referencing a deleted product - nothing to migrate onto
    if (Array.isArray(product.stock) && product.stock.length > 0) continue; // already migrated / already has its own stock

    report.products.candidates += 1;

    const stockByWarehouse = new Map(); // warehouseId(str) -> { quantity, starterQuantity }
    let sku;
    let barcode;

    for (const variant of variants) {
      if (!sku && variant.sku) sku = variant.sku;
      if (!barcode && variant.variantCode) barcode = variant.variantCode.toString();

      for (const stockEntry of variant.stock || []) {
        if (!stockEntry.warehouse) continue;
        const whId = stockEntry.warehouse.toString();
        if (!stockByWarehouse.has(whId)) stockByWarehouse.set(whId, { quantity: 0, starterQuantity: 0 });
        const agg = stockByWarehouse.get(whId);
        agg.quantity += stockEntry.quantity || 0;
        agg.starterQuantity += stockEntry.starterQuantity || 0;
      }
    }

    const stock = Array.from(stockByWarehouse, ([warehouseId, agg]) => ({
      warehouse: new mongoose.Types.ObjectId(warehouseId),
      quantity: agg.quantity,
      starterQuantity: agg.starterQuantity,
    }));

    const setFields = { stock };
    if (sku) setFields.sku = sku;
    setFields.barcode = barcode || generateBarcode().toString();

    productUpdates.push({ productId: product._id, setFields });
  }

  console.log(`\nProducts needing migration: ${report.products.candidates}`);
  if (!dryRun) {
    for (const { productId, setFields } of productUpdates) {
      const result = await productsCol.updateOne({ _id: productId }, { $set: setFields });
      if (result.modifiedCount > 0) report.products.updated += 1;
    }
    console.log(`  Updated ${report.products.updated} product document(s).`);
  }

  // =============================================================
  // Step 3: PurchaseOrder.items[].variantId -> items[].productId
  // =============================================================
  if (collections.has('purchaseorders')) {
    const poCol = db.collection('purchaseorders');
    const candidates = await poCol.find({ 'items.variantId': { $exists: true } }).toArray();
    report.purchaseOrders.candidates = candidates.length;
    console.log(`\nPurchase orders with legacy items.variantId: ${candidates.length}`);

    if (!dryRun) {
      for (const po of candidates) {
        let changed = false;
        const items = (po.items || []).map(item => {
          if (item.variantId && !item.productId) {
            const productIdStr = variantToProduct.get(item.variantId.toString());
            if (productIdStr) {
              changed = true;
              report.purchaseOrders.itemsRewritten += 1;
              return { ...item, productId: new mongoose.Types.ObjectId(productIdStr) };
            }
          }
          return item;
        });
        if (changed) {
          await poCol.updateOne({ _id: po._id }, { $set: { items } });
          report.purchaseOrders.docsUpdated += 1;
        }
      }
      console.log(`  Updated ${report.purchaseOrders.docsUpdated} purchase order(s), ${report.purchaseOrders.itemsRewritten} item(s).`);
    }
  }

  // =============================================================
  // Step 4: SalesOrder.items[].variant -> items[].product
  // =============================================================
  if (collections.has('salesorders')) {
    const soCol = db.collection('salesorders');
    const candidates = await soCol.find({ 'items.variant': { $exists: true } }).toArray();
    report.salesOrders.candidates = candidates.length;
    console.log(`\nSales orders with legacy items.variant: ${candidates.length}`);

    if (!dryRun) {
      for (const so of candidates) {
        let changed = false;
        const items = (so.items || []).map(item => {
          if (item.variant && !item.product) {
            const productIdStr = variantToProduct.get(item.variant.toString());
            if (productIdStr) {
              changed = true;
              report.salesOrders.itemsRewritten += 1;
              return { ...item, product: new mongoose.Types.ObjectId(productIdStr) };
            }
          }
          return item;
        });
        if (changed) {
          await soCol.updateOne({ _id: so._id }, { $set: { items } });
          report.salesOrders.docsUpdated += 1;
        }
      }
      console.log(`  Updated ${report.salesOrders.docsUpdated} sales order(s), ${report.salesOrders.itemsRewritten} item(s).`);
    }
  }

  // =============================================================
  // Step 5 & 6: PurchaseOrderReturn / SalesOrderReturn: flat variantId -> productId
  // =============================================================
  const returnCollections = [
    { name: 'purchaseorderreturns', reportKey: 'purchaseOrderReturns' },
    { name: 'salesorderreturns', reportKey: 'salesOrderReturns' },
  ];

  for (const { name, reportKey } of returnCollections) {
    if (!collections.has(name)) continue;
    const col = db.collection(name);
    const candidates = await col.find({ variantId: { $exists: true }, productId: { $exists: false } }).toArray();
    report[reportKey].candidates = candidates.length;
    console.log(`\n${name} with legacy variantId: ${candidates.length}`);

    if (!dryRun) {
      for (const doc of candidates) {
        const productIdStr = variantToProduct.get(doc.variantId.toString());
        if (!productIdStr) continue;
        await col.updateOne({ _id: doc._id }, { $set: { productId: new mongoose.Types.ObjectId(productIdStr) } });
        report[reportKey].updated += 1;
      }
      console.log(`  Updated ${report[reportKey].updated} document(s).`);
    }
  }

  // =============================================================
  // Step 7: Transfer - type enum + details[].variant -> details[].product (+ legacy top-level variant)
  // =============================================================
  if (collections.has('transfers')) {
    const transfersCol = db.collection('transfers');
    const candidates = await transfersCol
      .find({
        $or: [{ type: { $in: ['variant', 'variants'] } }, { 'details.variant': { $exists: true } }, { variant: { $exists: true }, product: { $exists: false } }],
      })
      .toArray();
    report.transfers.candidates = candidates.length;
    console.log(`\nTransfers needing migration: ${candidates.length}`);

    if (!dryRun) {
      for (const transfer of candidates) {
        const setFields = {};

        if (transfer.type === 'variant' || transfer.type === 'variants') {
          setFields.type = 'products';
        }

        if (transfer.variant && !transfer.product) {
          const productIdStr = variantToProduct.get(transfer.variant.toString());
          if (productIdStr) setFields.product = new mongoose.Types.ObjectId(productIdStr);
        }

        if (Array.isArray(transfer.details) && transfer.details.some(d => d.variant && !d.product)) {
          setFields.details = transfer.details.map(detail => {
            if (detail.variant && !detail.product) {
              const productIdStr = variantToProduct.get(detail.variant.toString());
              if (productIdStr) return { ...detail, product: new mongoose.Types.ObjectId(productIdStr) };
            }
            return detail;
          });
        }

        if (Object.keys(setFields).length > 0) {
          await transfersCol.updateOne({ _id: transfer._id }, { $set: setFields });
          report.transfers.updated += 1;
        }
      }
      console.log(`  Updated ${report.transfers.updated} transfer(s).`);
    }
  }

  // =============================================================
  // Step 8: Movement - legacy variant field -> product
  // =============================================================
  if (collections.has('movements')) {
    const movementsCol = db.collection('movements');
    const candidates = await movementsCol.find({ variant: { $exists: true }, product: { $exists: false } }).toArray();
    report.movements.candidates = candidates.length;
    console.log(`\nMovements with legacy variant field: ${candidates.length}`);

    if (!dryRun) {
      for (const movement of candidates) {
        const productIdStr = variantToProduct.get(movement.variant.toString());
        if (!productIdStr) continue;
        await movementsCol.updateOne({ _id: movement._id }, { $set: { product: new mongoose.Types.ObjectId(productIdStr) } });
        report.movements.updated += 1;
      }
      console.log(`  Updated ${report.movements.updated} document(s).`);
    }
  }

  console.log(`\n${dryRun ? '--dry-run: no changes made. Re-run without --dry-run to apply.' : 'Migration complete.'}`);
  return { dryRun, report };
}

migrateVariantsToProducts()
  .then(async ({ report }) => {
    console.log('\nSummary:', JSON.stringify(report, null, 2));
    await mongoose.disconnect();
    console.log('Disconnected. Done.');
    process.exit(0);
  })
  .catch(async err => {
    console.error('\nmigrateVariantsToProducts failed:');
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
