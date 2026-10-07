/**
 * Re-derives the stored Project.remainingMoney of existing projects from the one calculation in
 * utils/projectExecution.js:
 *
 *   remainingMoney = contractValue − (contractValue × executedPercentage / 100)
 *
 * Before that rule, remainingMoney was contractValue − Payment receipts linked via
 * Payment.projectId (which nothing sets), so a project whose Executed % moved kept a stale
 * remainingMoney equal to its full contract value. API responses already show the correct value;
 * this only brings the stored field in line.
 *
 * Writes ONLY `remainingMoney`, ONLY on projects whose stored value differs, ONLY when the project
 * has a usable contractValue. Executed %, contract value and every other field are never touched;
 * no journal entries are posted. Soft-deleted projects are included (their stored value is
 * corrected the same way).
 *
 * Usage:
 *   npm run db:recalculate-project-remaining            # report only
 *   npm run db:recalculate-project-remaining -- --yes   # apply
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { computeProjectExecution } = require('../utils/projectExecution');

async function recalculateProjectRemaining() {
  const apply = process.argv.includes('--yes');

  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const { connection } = await mongoose.connect(process.env.DB_URI);
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
  await assertNotLeopardDatabase(connection);

  // Raw collection (not the Mongoose model): reads every project including soft-deleted ones, and
  // the update below writes this one field without running unrelated save hooks.
  const projects = connection.collection('projects');
  const all = await projects.find({}, { projection: { projectNumber: 1, contractValue: 1, executedPercentage: 1, remainingMoney: 1 } }).toArray();

  const changes = [];
  let skipped = 0;
  for (const project of all) {
    const execution = computeProjectExecution(project);
    if (!execution) {
      skipped += 1;
      continue;
    }
    if (project.remainingMoney !== execution.remainingMoney) {
      changes.push({ project, remainingMoney: execution.remainingMoney });
    }
  }

  console.log(`\nProjects: ${all.length} total, ${skipped} without a usable contract value (left untouched).`);
  console.log(`Projects whose stored remainingMoney differs from contractValue − executed amount: ${changes.length}`);
  for (const { project, remainingMoney } of changes) {
    console.log(`  ${project.projectNumber}: contract ${project.contractValue}, executed ${project.executedPercentage ?? 0}% -> remaining ${project.remainingMoney ?? '(none)'} => ${remainingMoney}`);
  }

  if (!apply) {
    console.log('\nReport only: no changes made. Re-run with --yes to apply.');
    return { applied: false, projects: changes.length };
  }

  let modified = 0;
  for (const { project, remainingMoney } of changes) {
    // The filter re-checks the inputs, so a project changed since the report is skipped.
    // eslint-disable-next-line no-await-in-loop
    const result = await projects.updateOne(
      { _id: project._id, contractValue: project.contractValue, executedPercentage: project.executedPercentage === undefined ? { $exists: false } : project.executedPercentage },
      { $set: { remainingMoney } }
    );
    modified += result.modifiedCount;
  }
  console.log(`\nUpdated remainingMoney on ${modified} of ${changes.length} project(s).`);
  return { applied: true, projects: changes.length, modified };
}

if (require.main === module) {
  recalculateProjectRemaining()
    .then(() => mongoose.disconnect())
    .catch(async err => {
      console.error(err instanceof SafetyError ? `Refused: ${err.message}` : `Recalculation failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { recalculateProjectRemaining };
