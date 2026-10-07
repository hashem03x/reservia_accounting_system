/**
 * Initializes a fresh, empty Reversia database: creates every collection the current backend's
 * Mongoose models define, and builds their indexes - and inserts zero documents. Safe to run
 * repeatedly against an already-initialized (still-empty) Reversia database.
 *
 * Usage: npm run db:init
 *
 * Refuses to run (see server/scripts/lib/dbSafety.js) if the connected database's name looks
 * like a Leopard database, if any Leopard/Shopify-only collection is found in it, or if it
 * already contains any documents at all. Never logs the connection string.
 */
const mongoose = require('mongoose');
const { REVERSIA_MODELS } = require('./lib/reversiaModels');
const {
  loadEnv,
  SafetyError,
  assertDbUriConfigured,
  assertSafeDatabaseName,
  assertNotLeopardDatabase,
  assertEmptyDatabase,
} = require('./lib/dbSafety');

// Model.init() issues admin commands (createCollection/createIndexes) that the MongoDB driver
// does NOT automatically retry on a transient network blip the way retryable writes are -
// observed in practice against some Atlas clusters as an intermittent TLS "ResetPool" error
// mid-run. A few short retries make repeated `npm run db:init` invocations reliable without
// masking a real, persistent failure (schema/permission errors still fail immediately, since
// each retry re-throws the same error and the loop gives up after the last attempt).
async function withRetries(fn, attempts = 3, delayMs = 500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

async function initDb() {
  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const mongooseConn = await mongoose.connect(process.env.DB_URI);
  const connection = mongooseConn.connection;
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);

  await assertNotLeopardDatabase(connection);
  await assertEmptyDatabase(connection);
  console.log('Safety checks passed: not a Leopard database, and currently empty.');

  const created = [];
  for (const { name, require: requireModel, purpose } of REVERSIA_MODELS) {
    const Model = requireModel();
    // Model.init() creates the collection (if autoCreate is enabled, which is the default) AND
    // builds every index declared on the schema - the one call that covers both "create
    // collections" and "apply current schema/index definitions" without inserting any document.
    await withRetries(() => Model.init());
    const indexes = await Model.collection.indexes();
    created.push({ name, collection: Model.collection.name, purpose, indexCount: indexes.length });
    console.log(`  - ${Model.collection.name} (${name}): ready, ${indexes.length} index(es)`);
  }

  console.log(`\nInitialized ${created.length} collection(s) in "${dbName}". 0 documents inserted.`);
  return { dbName, created };
}

initDb()
  .then(async () => {
    await mongoose.disconnect();
    console.log('Disconnected. Done.');
    process.exit(0);
  })
  .catch(async err => {
    console.error('\ndb:init failed:');
    // Only our own SafetyError messages are guaranteed never to contain a connection string -
    // a raw driver error (e.g. MongoParseError on a malformed URI) can otherwise echo the URI,
    // credentials included, straight into err.message.
    if (err instanceof SafetyError) {
      console.error(err.message);
    } else {
      console.error(`${err.name}: connection or database operation failed. Check DB_URI in config.env/.env.`);
    }
    try {
      await mongoose.disconnect();
    } catch {
      // already disconnected / never connected - nothing to clean up
    }
    process.exit(1);
  });
