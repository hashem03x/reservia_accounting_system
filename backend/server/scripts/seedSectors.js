/**
 * Creates the Sector records (Admin -> Sectors) that existing data needs, so no option disappears
 * from the Project form and every project's current sector is a real, manageable Sector:
 *
 *   - the two sectors that used to be the hardcoded list (DefaultProjectSectors: Villa, Industrials);
 *   - every distinct sector value already stored on a project (including soft-deleted projects),
 *     exactly as written there - no names are invented.
 *
 * Additive and idempotent, like db:seed-accounts: it only inserts sectors whose name does not exist
 * yet (compared case-insensitively) and never edits, deactivates or deletes an existing sector.
 * Projects are only read, never written.
 *
 * Usage:
 *   npm run db:seed-sectors                # create the missing sectors
 *   npm run db:seed-sectors -- --dry-run   # report only
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { DefaultProjectSectors } = require('../utils/accountingConstants');

async function seedSectors({ dryRun = process.argv.includes('--dry-run'), connect = true } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    console.log('Connecting to database...');
    await mongoose.connect(process.env.DB_URI);
  }
  const { connection } = mongoose;
  if (connect) {
    const dbName = assertSafeDatabaseName(connection);
    console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
    await assertNotLeopardDatabase(connection);
  }

  // eslint-disable-next-line global-require
  const Sector = require('../models/project/sectorModel');
  await Sector.init(); // the case-insensitive unique index must exist before inserting

  const usedOnProjects = (await connection.collection('projects').distinct('sector'))
    .filter(value => typeof value === 'string' && value.trim() !== '')
    .map(value => value.trim());

  // One entry per case-insensitive name; the hardcoded defaults first, then project values.
  const candidates = [];
  const seen = new Set();
  for (const name of [...DefaultProjectSectors, ...usedOnProjects]) {
    const key = name.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(name);
    }
  }

  const created = [];
  const existing = [];
  for (const name of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const found = await Sector.findOne({ name }).collation(Sector.SECTOR_NAME_COLLATION).lean();
    if (found) {
      existing.push(found.name);
    } else if (!dryRun) {
      // eslint-disable-next-line no-await-in-loop
      await Sector.create({ name, isActive: true });
      created.push(name);
    } else {
      created.push(name);
    }
  }

  console.log(`\nSector values in use on projects: ${usedOnProjects.length ? [...new Set(usedOnProjects)].join(', ') : '(none)'}`);
  console.log(`${dryRun ? 'Would create' : 'Created'}: ${created.length ? created.join(', ') : '(nothing)'}`);
  console.log(`Already existed: ${existing.length ? existing.join(', ') : '(none)'}`);
  if (dryRun) console.log('\n--dry-run: no changes made.');
  return { created, existing };
}

if (require.main === module) {
  seedSectors()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:seed-sectors failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { seedSectors };
