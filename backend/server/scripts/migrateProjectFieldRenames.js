/**
 * One-time, non-destructive migration: renames three fields on existing `projects` documents to
 * match the renamed Project schema (see docs/entities/projects.md):
 *
 *   projectAmount -> contractValue
 *   executor      -> projectManager
 *   department    -> sector
 *
 * Uses MongoDB's native `$rename` operator via raw collection access (NOT the Mongoose `Project`
 * model, which already only knows the NEW field names and would silently ignore the old ones on
 * any query/update) - `$rename` preserves the field's existing value and simply changes its key,
 * so no data is lost, no relationships (executor/projectManager both stay the same ObjectId ref to
 * User) are broken, and nothing is deleted or overwritten.
 *
 * Idempotent and safe to run more than once: `$rename` on a field that doesn't exist on a given
 * document is a silent no-op for that field (not an error) - so documents already migrated (or
 * created after this schema change, which never had the old field names at all) are simply
 * skipped. This also means it's safe to run against a live database with a mix of old-shape and
 * new-shape documents.
 *
 * Does NOT touch `startDate`/`deliveryDate` - those are new, unrelated fields with no old name to
 * migrate from; existing projects simply won't have them until edited (see the master spec's
 * "Database Migration / Existing Data Safety" section - no destructive update is performed).
 *
 * Usage:
 *   node server/scripts/migrateProjectFieldRenames.js --dry-run   # report only, no writes
 *   node server/scripts/migrateProjectFieldRenames.js             # perform the rename
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

const FIELD_RENAMES = {
  projectAmount: 'contractValue',
  executor: 'projectManager',
  department: 'sector',
};

async function migrateProjectFieldRenames() {
  const dryRun = process.argv.includes('--dry-run');

  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const mongooseConn = await mongoose.connect(process.env.DB_URI);
  const connection = mongooseConn.connection;
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);

  await assertNotLeopardDatabase(connection);

  const projects = connection.collection('projects');

  const oldFieldNames = Object.keys(FIELD_RENAMES);
  const matchAnyOldField = { $or: oldFieldNames.map(field => ({ [field]: { $exists: true } })) };

  const totalCandidates = await projects.countDocuments(matchAnyOldField);
  console.log(`\nFound ${totalCandidates} project document(s) with at least one old-named field.`);

  for (const [oldName, newName] of Object.entries(FIELD_RENAMES)) {
    const count = await projects.countDocuments({ [oldName]: { $exists: true } });
    console.log(`  - ${oldName} -> ${newName}: ${count} document(s)`);
  }

  if (dryRun) {
    console.log('\n--dry-run: no changes made. Re-run without --dry-run to apply.');
    return { dryRun: true, totalCandidates };
  }

  if (totalCandidates === 0) {
    console.log('\nNothing to migrate.');
    return { dryRun: false, totalCandidates, modifiedCount: 0 };
  }

  // A single $rename update covers all three fields at once per document - MongoDB ignores any
  // key in the $rename object whose source field isn't present on that particular document, so
  // this is safe even though not every document necessarily has all three old fields.
  const result = await projects.updateMany(matchAnyOldField, { $rename: FIELD_RENAMES });
  console.log(`\nMigrated ${result.modifiedCount} of ${result.matchedCount} matched document(s).`);

  return { dryRun: false, totalCandidates, modifiedCount: result.modifiedCount };
}

migrateProjectFieldRenames()
  .then(async () => {
    await mongoose.disconnect();
    console.log('Disconnected. Done.');
    process.exit(0);
  })
  .catch(async err => {
    console.error('\nmigrateProjectFieldRenames failed:');
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
