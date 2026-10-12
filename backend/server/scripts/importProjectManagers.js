/**
 * Brings the project managers existing projects already have into Admin -> Project Managers. Before
 * that list existed a project referenced a staff user; each such user becomes a Project Manager with
 * the SAME id (name, email, phone copied), so every project keeps its manager with no project
 * changed. Idempotent - a manager already in the list is never created again. Users that no longer
 * exist, or whose name / email clash with an existing project manager, are printed for the admin to
 * resolve and never changed. The same import is available to admins on the Project Managers page.
 *
 * Usage:
 *   npm run db:import-project-managers            # report only
 *   npm run db:import-project-managers -- --yes   # apply
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

async function importProjectManagers() {
  const apply = process.argv.includes('--yes');

  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const { connection } = await mongoose.connect(process.env.DB_URI);
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
  await assertNotLeopardDatabase(connection);

  const { legacyProjectManagers, importLegacyProjectManagers } = require('../services/project/projectManagerService'); // eslint-disable-line global-require
  const legacy = await legacyProjectManagers();
  console.log(`\nProject managers referenced by projects but not in the Project Managers list: ${legacy.length}`);
  if (legacy.length) console.table(legacy.map(m => ({ id: m._id, name: m.name || '(user not found)', email: m.email || '-', projects: m.projectsCount })));

  if (!apply) {
    console.log('\nReport only: no changes made. Re-run with --yes to import them.');
    return { applied: false, legacy: legacy.length };
  }
  const { imported, skipped } = await importLegacyProjectManagers();
  console.log(`\nImported ${imported.length} project manager(s).`);
  if (skipped.length) {
    console.log(`Left for the admin to resolve (never changed): ${skipped.length}`);
    skipped.forEach(s => console.log(`  ${s._id} ${s.name || ''}: ${s.reason}`));
  }
  return { applied: true, imported: imported.length, skipped: skipped.length };
}

if (require.main === module) {
  importProjectManagers()
    .then(() => mongoose.disconnect())
    .catch(async err => {
      console.error(err instanceof SafetyError ? `Refused: ${err.message}` : `Import failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { importProjectManagers };
