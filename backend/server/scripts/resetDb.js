/**
 * DEVELOPMENT-ONLY: drops every collection owned by a current Reversia model, then recreates
 * them empty (same as db:init). This deletes all data in those collections - never run it
 * against a database you care about.
 *
 * Usage: npm run db:reset -- --yes
 * (the --yes flag is a required, explicit confirmation - running without it does nothing)
 *
 * Refuses unconditionally, with no override, if:
 *   - NODE_ENV is "production"
 *   - --yes was not passed
 *   - the connected database's name looks like a Leopard database
 *   - any Leopard/Shopify-only collection is found in the target database
 */
const mongoose = require('mongoose');
const { REVERSIA_MODELS } = require('./lib/reversiaModels');
const {
  loadEnv,
  SafetyError,
  assertDbUriConfigured,
  assertSafeDatabaseName,
  assertNotLeopardDatabase,
} = require('./lib/dbSafety');

async function resetDb() {
  loadEnv();

  if (process.env.NODE_ENV === 'production') {
    throw new SafetyError('Refusing to run db:reset: NODE_ENV is "production". This command is development-only.');
  }
  if (!process.argv.includes('--yes')) {
    throw new SafetyError(
      'Refusing to run db:reset without explicit confirmation. This permanently deletes all data in every ' +
        'Reversia collection. Re-run as: npm run db:reset -- --yes'
    );
  }
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const mongooseConn = await mongoose.connect(process.env.DB_URI);
  const connection = mongooseConn.connection;
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);

  await assertNotLeopardDatabase(connection);
  console.log(`\n!!! DROPPING all Reversia collections in "${dbName}" !!!\n`);

  const dropped = [];
  for (const { name, require: requireModel } of REVERSIA_MODELS) {
    const Model = requireModel();
    try {
      await Model.collection.drop();
      dropped.push(Model.collection.name);
      console.log(`  - dropped ${Model.collection.name} (${name})`);
    } catch (err) {
      // Mongo throws "ns not found" (26) when the collection doesn't exist yet - fine, nothing
      // to drop. Any other error is real and should stop the script.
      if (err.codeName !== 'NamespaceNotFound' && err.code !== 26) throw err;
      console.log(`  - ${Model.collection.name} (${name}) did not exist, skipping`);
    }
  }

  console.log(`\nDropped ${dropped.length} collection(s). Recreating them empty...\n`);

  for (const { name, require: requireModel } of REVERSIA_MODELS) {
    const Model = requireModel();
    await Model.init();
    console.log(`  - ${Model.collection.name} (${name}): recreated`);
  }

  console.log(`\nReset complete. "${dbName}" now has ${REVERSIA_MODELS.length} empty collection(s), 0 documents.`);
}

resetDb()
  .then(async () => {
    await mongoose.disconnect();
    console.log('Disconnected. Done.');
    process.exit(0);
  })
  .catch(async err => {
    console.error('\ndb:reset failed:');
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
