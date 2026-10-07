const mongoose = require('mongoose');
const { loadEnv } = require('../../config/env');
const { LEOPARD_MARKER_MODEL_NAMES } = require('./reversiaModels');

// Every error thrown by this module is a SafetyError - a deliberately-written, human-readable
// message that is guaranteed never to contain a connection string or credential. initDb.js/
// resetDb.js use `instanceof SafetyError` to decide whether it's safe to print an error's
// `.message` verbatim, since a raw driver error (e.g. MongoParseError on a malformed URI) can
// otherwise echo the URI - credentials included - straight into the error message.
class SafetyError extends Error {}

// Fails fast, before ever opening a connection, if DB_URI isn't set at all. Deliberately does
// NOT attempt to parse or inspect the URI string itself here - a malformed/unusual connection
// string (e.g. one with no explicit database-name path segment) can make naive string-splitting
// accidentally capture the "user:password@host" authority section instead of a database name,
// which would then get logged. The database name used for every real safety check below always
// comes from the CONNECTED driver's own `connection.db.databaseName` instead, which is never
// credential-bearing no matter how the URI is written.
function assertDbUriConfigured() {
  if (!process.env.DB_URI) {
    throw new SafetyError('DB_URI is not set (checked config.env and .env). Refusing to guess a database to connect to.');
  }
}

// Cheap first check on the driver-resolved database name (not the raw URI - see above).
function assertSafeDatabaseName(connection) {
  const dbName = connection.db.databaseName;
  if (/leopard/i.test(dbName)) {
    throw new SafetyError(
      `Refusing to continue: the connected database's name ("${dbName}") looks like a Leopard database. ` +
        'Point DB_URI at a dedicated Reversia database (e.g. "reversia-accounting") instead.'
    );
  }
  return dbName;
}

// Inspects the ALREADY-CONNECTED database's real collections for proof it is (or was) a Leopard
// database: any collection matching a Leopard/Shopify-only model's computed collection name
// existing at all is conclusive, regardless of what the database is named - a database can be
// renamed, but it can't hide the collections the old storefront/Shopify integration actually
// wrote. This check has no override flag - both initDb.js and resetDb.js always run it.
async function assertNotLeopardDatabase(connection) {
  const collections = await connection.db.listCollections().toArray();
  const existingNames = new Set(collections.map(c => c.name));

  const leopardMarkerNames = LEOPARD_MARKER_MODEL_NAMES.map(modelName => mongoose.pluralize()(modelName.toLowerCase()));
  const foundMarkers = leopardMarkerNames.filter(name => existingNames.has(name));
  if (foundMarkers.length > 0) {
    throw new SafetyError(
      `Refusing to continue: found Leopard/Shopify-only collection(s) [${foundMarkers.join(', ')}] in database ` +
        `"${connection.db.databaseName}". This is a Leopard database, not a Reversia one.`
    );
  }
  return collections;
}

// db:init-only: on top of the Leopard checks above, also refuses if the database already holds
// any documents at all. Since the whole point of db:init is "zero business data", this is an
// unconditional abort with no override flag - a database that already holds data is exactly the
// case this script exists to protect against overwriting the wrong target. (db:reset, which
// intentionally deletes data, does NOT use this check - see resetDb.js.)
async function assertEmptyDatabase(connection) {
  const collections = await connection.db.listCollections().toArray();
  const nonEmpty = [];
  for (const { name } of collections) {
    const count = await connection.db.collection(name).estimatedDocumentCount();
    if (count > 0) nonEmpty.push(`${name} (${count})`);
  }
  if (nonEmpty.length > 0) {
    throw new SafetyError(
      `Refusing to initialize: database "${connection.db.databaseName}" is not empty - ` +
        `found document(s) in [${nonEmpty.join(', ')}]. db:init only ever runs against an empty database.`
    );
  }
}

module.exports = { loadEnv, SafetyError, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, assertEmptyDatabase };
