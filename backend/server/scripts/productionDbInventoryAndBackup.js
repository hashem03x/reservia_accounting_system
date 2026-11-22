/**
 * Phase D - full collection inventory, external (local-file) backup, and backup verification for
 * a production-shaped database. READ-ONLY against the source connection: this file never calls
 * anything but listCollections/countDocuments/collStats/find on it. Deletes NOTHING, anywhere,
 * ever - that is a separate, explicitly-authorized action this script does not perform.
 *
 * Deliberately does NOT use DB_URI/loadEnv() (config/env.js) - this is not a db:* script that runs
 * against whatever .env happens to point at. It requires its OWN, differently-named environment
 * variable (PROD_READONLY_URI) passed explicitly for one invocation, so it can never accidentally
 * pick up a stale/swapped .env and never writes to any file on disk itself.
 *
 * mongodump/mongorestore are not installed in this environment, so the backup is a type-preserving
 * EJSON export (one newline-delimited file per collection, streamed - a huge collection is never
 * held fully in memory) instead of a native BSON dump. Restorable by this same script's --verify
 * step, or any tool that understands MongoDB Extended JSON.
 *
 * Usage (PowerShell - env vars, not argv, carry the real connection string):
 *   $env:PROD_READONLY_URI="<connection string>"
 *   node server/scripts/productionDbInventoryAndBackup.js --confirm --out="<output directory>"
 *
 * Inventory only (counts/sizes, no document is ever read into memory or written to disk):
 *   node server/scripts/productionDbInventoryAndBackup.js --confirm --inventory-only --out="<output directory>"
 *
 * Verify a backup already taken (restores into a disposable LOCAL database - never the source -
 * compares counts, then drops that disposable database):
 *   node server/scripts/productionDbInventoryAndBackup.js --verify --out="<same output directory>"
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { SafetyError, assertNotLeopardDatabase } = require('./lib/dbSafety');

const { EJSON } = mongoose.mongo.BSON;

function parseArgs(argv = process.argv.slice(2)) {
  let confirm = false;
  let verify = false;
  let inventoryOnly = false;
  let outDir = null;
  for (const token of argv) {
    if (token === '--confirm') confirm = true;
    else if (token === '--verify') verify = true;
    else if (token === '--inventory-only') inventoryOnly = true;
    else if (token.startsWith('--out=')) outDir = token.slice('--out='.length).replace(/^"|"$/g, '');
  }
  return { confirm, verify, inventoryOnly, outDir };
}

/**
 * Inventory (always) + backup (unless `inventoryOnly`). Read-only against `uri`; writes only
 * under `outDir`. With `inventoryOnly: true`, no document is ever read into this process's memory
 * or written to disk - only listCollections/countDocuments/collStats, matching exactly what a
 * `du`/`db.stats()` pass over the database would show, nothing more.
 */
async function inventoryAndBackup({ uri, outDir, inventoryOnly = false }) {
  fs.mkdirSync(outDir, { recursive: true });

  console.log('Connecting (read-only)...');
  const conn = await mongoose.createConnection(uri).asPromise();
  try {
    await assertNotLeopardDatabase(conn);
    const dbName = conn.db.databaseName;
    console.log(`Connected (host: ${conn.host}, db: "${dbName}").`);

    const collectionNames = (await conn.db.listCollections().toArray()).map(c => c.name).sort();
    const inventory = [];
    const manifest = [];

    for (const name of collectionNames) {
      const coll = conn.db.collection(name);
      // eslint-disable-next-line no-await-in-loop
      const count = await coll.countDocuments();
      let sizeBytes = null;
      let avgObjSize = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        const stats = await conn.db.command({ collStats: name });
        sizeBytes = stats.size ?? null;
        avgObjSize = stats.avgObjSize ?? null;
      } catch {
        // Some deployments restrict collStats; the count above is still accurate either way.
      }
      inventory.push({ name, count, sizeBytes, avgObjSize });
      console.log(`  ${name}: ${count} document(s)${sizeBytes != null ? `, ~${Math.round(sizeBytes / 1024)} KB` : ''}`);

      if (inventoryOnly) continue;

      const filePath = path.join(outDir, `${name}.ejson.ndjson`);
      const writeStream = fs.createWriteStream(filePath);
      const hash = crypto.createHash('sha256');
      let written = 0;
      // eslint-disable-next-line no-await-in-loop
      for await (const doc of coll.find({})) {
        const line = `${EJSON.stringify(doc)}\n`;
        writeStream.write(line);
        hash.update(line);
        written += 1;
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve, reject) => writeStream.end(err => (err ? reject(err) : resolve())));
      manifest.push({ name, documentsWritten: written, file: path.basename(filePath), sha256: hash.digest('hex') });
      if (count !== written) console.log(`    WARNING: count() reported ${count} but ${written} were streamed`);
    }

    const report = { generatedAt: new Date().toISOString(), database: dbName, host: conn.host, inventoryOnly, inventory, backupManifest: manifest };
    const reportPath = path.join(outDir, 'inventory-and-backup-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n${inventoryOnly ? 'Inventory' : 'Inventory + backup'} complete. Report: ${reportPath}`);
    return report;
  } finally {
    await conn.close();
  }
}

/**
 * Restores every backed-up collection into a disposable LOCAL database (never the production
 * source) and compares document counts against the report's inventory. Drops that disposable
 * database when done either way - it is a throwaway verification copy, not a system of record.
 */
async function verifyBackup({ outDir }) {
  const reportPath = path.join(outDir, 'inventory-and-backup-report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  const verifyDbName = `reservia_backup_verify_${Date.now()}`;
  const conn = await mongoose.createConnection(`mongodb://127.0.0.1:27017/${verifyDbName}`).asPromise();
  const results = [];
  try {
    for (const entry of report.backupManifest) {
      const filePath = path.join(outDir, entry.file);
      const coll = conn.db.collection(entry.name);
      const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
      let batch = [];
      let restored = 0;
      // eslint-disable-next-line no-await-in-loop
      for await (const line of rl) {
        if (!line.trim()) continue;
        batch.push(EJSON.parse(line));
        if (batch.length >= 1000) {
          // eslint-disable-next-line no-await-in-loop
          await coll.insertMany(batch, { ordered: false });
          restored += batch.length;
          batch = [];
        }
      }
      if (batch.length) {
        // eslint-disable-next-line no-await-in-loop
        await coll.insertMany(batch, { ordered: false });
        restored += batch.length;
      }
      const expected = report.inventory.find(i => i.name === entry.name)?.count ?? entry.documentsWritten;
      const ok = restored === entry.documentsWritten && restored === expected;
      results.push({ name: entry.name, expected, backedUp: entry.documentsWritten, restored, ok });
      console.log(`  verify ${entry.name}: expected ${expected}, backed up ${entry.documentsWritten}, restored ${restored} - ${ok ? 'OK' : 'MISMATCH'}`);
    }
  } finally {
    await conn.dropDatabase();
    await conn.close();
  }

  const allOk = results.every(r => r.ok);
  console.log(`\nVerification ${allOk ? 'PASSED' : 'FAILED'} - disposable verify database "${verifyDbName}" dropped.`);
  return { ok: allOk, results };
}

if (require.main === module) {
  const { confirm, verify, inventoryOnly, outDir } = parseArgs();
  (async () => {
    if (!outDir) throw new SafetyError('Pass --out="<directory>" for the backup/report output.');
    if (verify) {
      const { ok } = await verifyBackup({ outDir });
      process.exit(ok ? 0 : 1);
      return;
    }
    if (!process.env.PROD_READONLY_URI) {
      throw new SafetyError('Set PROD_READONLY_URI (environment variable, not a CLI flag) to the connection string before running this script. Deliberately NOT the same variable as DB_URI.');
    }
    if (!confirm) {
      throw new SafetyError('Refusing to continue without --confirm. This connects to and reads the given database - confirm only once the connection string is verified as the intended target.');
    }
    await inventoryAndBackup({ uri: process.env.PROD_READONLY_URI, outDir, inventoryOnly });
  })().catch(err => {
    console.error(err instanceof SafetyError ? err.message : `${err.name}: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { inventoryAndBackup, verifyBackup, parseArgs };
