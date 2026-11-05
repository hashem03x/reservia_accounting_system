/**
 * Loads the initial CRM Targets and Advertising Spend records specified in Change Request 1,
 * Feature 5 - the first real numbers entered under the new (segment, month) target schema and
 * (channel, segment, month) ad-spend schema (previously owner-keyed / source-enum-keyed; see
 * models/crm/targetModel.js and models/crm/adSpendModel.js for why that changed).
 *
 * Exact figures from the change request, nothing invented:
 *   Targets:
 *     Nov 2026, all segments: Enquiries 24, Qualified 7, Surveys 4, Proposals 2, Signed 0.
 *     Dec 2026, all segments: Surveys 4, Proposals 3, Signed 1, Value target EGP 990,000.
 *       Enquiries/Qualified are deliberately left UNSET ("to be entered after week 1") - this
 *       script does not create a Dec target document with guessed numbers; the MD enters those
 *       two fields later via the Targets screen, which upserts the SAME document.
 *   Advertising spend:
 *     Nov 2026: "Farm test" (farm) - 7,000 EGP.
 *     Dec 2026: "Farms" (farm) - 14,500 EGP; "Villas" (villa) - 2,700 EGP; "Compounds" (compound) - 800 EGP.
 *
 * Idempotent (upsert, like db:seed-sectors) - re-running after the MD has already edited a value
 * in the CRM UI would silently stomp their edit back to this script's own numbers, so it refuses
 * to touch a record that already exists; use the Targets/Advertising Spend screens for any
 * correction after the first run.
 *
 * Usage:
 *   npm run db:seed-crm-targets                # create the records above
 *   npm run db:seed-crm-targets -- --dry-run    # report only
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

const TARGETS = [
  { segment: 'all', year: 2026, month: 11, fields: { targetEnquiries: 24, targetQualified: 7, targetSurveys: 4, targetProposals: 2, targetSigned: 0 } },
  { segment: 'all', year: 2026, month: 12, fields: { targetSurveys: 4, targetProposals: 3, targetSigned: 1, targetValueEgp: 990000 } },
];

const AD_SPEND = [
  { channel: 'Farm test', segment: 'farm', year: 2026, month: 11, amountEgp: 7000 },
  { channel: 'Farms', segment: 'farm', year: 2026, month: 12, amountEgp: 14500 },
  { channel: 'Villas', segment: 'villa', year: 2026, month: 12, amountEgp: 2700 },
  { channel: 'Compounds', segment: 'compound', year: 2026, month: 12, amountEgp: 800 },
];

async function seedCrmChangeRequest1Targets({ dryRun = process.argv.includes('--dry-run'), connect = true } = {}) {
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
  const CrmTarget = require('../models/crm/targetModel');
  // eslint-disable-next-line global-require
  const CrmAdSpend = require('../models/crm/adSpendModel');
  await Promise.all([CrmTarget.init(), CrmAdSpend.init()]);

  const createdTargets = [];
  const skippedTargets = [];
  for (const { segment, year, month, fields } of TARGETS) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await CrmTarget.findOne({ segment, year, month }).lean();
    const label = `${segment} ${year}-${String(month).padStart(2, '0')}`;
    if (existing) {
      skippedTargets.push(label);
      continue;
    }
    if (!dryRun) {
      // eslint-disable-next-line no-await-in-loop
      await CrmTarget.create({ segment, year, month, ...fields });
    }
    createdTargets.push(label);
  }

  const createdSpend = [];
  const skippedSpend = [];
  for (const { channel, segment, year, month, amountEgp } of AD_SPEND) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await CrmAdSpend.findOne({ channel, year, month }).lean();
    const label = `${channel} ${year}-${String(month).padStart(2, '0')}`;
    if (existing) {
      skippedSpend.push(label);
      continue;
    }
    if (!dryRun) {
      // eslint-disable-next-line no-await-in-loop
      await CrmAdSpend.create({ channel, segment, year, month, amountEgp });
    }
    createdSpend.push(label);
  }

  console.log(`\nTargets - ${dryRun ? 'would create' : 'created'}: ${createdTargets.length ? createdTargets.join(', ') : '(nothing)'}`);
  console.log(`Targets - already existed (left untouched): ${skippedTargets.length ? skippedTargets.join(', ') : '(none)'}`);
  console.log(`\nAd spend - ${dryRun ? 'would create' : 'created'}: ${createdSpend.length ? createdSpend.join(', ') : '(nothing)'}`);
  console.log(`Ad spend - already existed (left untouched): ${skippedSpend.length ? skippedSpend.join(', ') : '(none)'}`);
  if (dryRun) console.log('\n--dry-run: no changes made.');
  return { createdTargets, skippedTargets, createdSpend, skippedSpend };
}

if (require.main === module) {
  seedCrmChangeRequest1Targets()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:seed-crm-targets failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { seedCrmChangeRequest1Targets };
