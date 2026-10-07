/**
 * Data-integrity backfill for journal entries created before every line was required to carry its
 * entry's Project (journalEntryModel.js RULE 3). Before that rule, automatic entries such as
 * PO_INVENTORY_RECEIPT were saved with `project` on the entry but `project: null,
 * projectNumber: null` on the lines.
 *
 * Deterministic, never guesses:
 *   entry.project -> that Project document's own projectNumber -> missing line.project / line.projectNumber
 *
 * Only these line fields are ever written, and only on entries that HAVE a parent project:
 *   - line.project is null                  -> set to entry.project, and projectNumber to its number
 *   - line.project === entry.project and
 *     line.projectNumber is missing/stale   -> set projectNumber to the project's real number
 * Left untouched and listed for manual review: a line that names a DIFFERENT project, and any entry
 * whose project no longer exists or has no Project Number. No amounts, accounts, statuses, Sub
 * Accounts or dates are touched, and entries without a project are never read for writing.
 *
 * Report-only by default. Writes only with --yes.
 *
 * Usage:
 *   npm run db:backfill-journal-line-projects            # report only
 *   npm run db:backfill-journal-line-projects -- --yes   # apply
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

const isBlank = value => value === null || value === undefined || value === '';

async function backfillJournalLineProjects() {
  const apply = process.argv.includes('--yes');

  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const { connection } = await mongoose.connect(process.env.DB_URI);
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
  await assertNotLeopardDatabase(connection);

  const entriesCollection = connection.collection('journalentries');
  const projectsCollection = connection.collection('projects');

  const candidates = await entriesCollection
    .find(
      { project: { $type: 'objectId' }, lines: { $elemMatch: { $or: [{ project: null }, { projectNumber: null }, { projectNumber: '' }] } } },
      { projection: { entryNumber: 1, source: 1, accountingAction: 1, status: 1, project: 1, lines: 1 } }
    )
    .toArray();

  // Entries whose lines all name the parent project but carry a stale number.
  const withProject = await entriesCollection.find({ project: { $type: 'objectId' } }, { projection: { _id: 1, project: 1, lines: 1, entryNumber: 1, source: 1, accountingAction: 1, status: 1 } }).toArray();
  const projectIds = [...new Set(withProject.map(e => String(e.project)))].map(id => new mongoose.Types.ObjectId(id));
  const projects = await projectsCollection.find({ _id: { $in: projectIds } }, { projection: { projectNumber: 1 } }).toArray();
  const numberByProject = new Map(projects.map(p => [String(p._id), p.projectNumber]));

  const candidateIds = new Set(candidates.map(e => String(e._id)));
  for (const entry of withProject) {
    const number = numberByProject.get(String(entry.project));
    const stale = (entry.lines || []).some(l => String(l.project) === String(entry.project) && !isBlank(l.projectNumber) && l.projectNumber !== number);
    if (stale && !candidateIds.has(String(entry._id))) {
      candidates.push(entry);
      candidateIds.add(String(entry._id));
    }
  }

  const plan = [];
  const review = [];
  for (const entry of candidates) {
    const projectNumber = numberByProject.get(String(entry.project));
    if (isBlank(projectNumber)) {
      review.push({ entryNumber: entry.entryNumber, reason: numberByProject.has(String(entry.project)) ? 'project has no Project Number' : 'project no longer exists' });
      continue;
    }
    const set = {};
    const originalFilter = { _id: entry._id };
    (entry.lines || []).forEach((line, i) => {
      if (isBlank(line.project)) {
        set[`lines.${i}.project`] = entry.project;
        set[`lines.${i}.projectNumber`] = projectNumber;
        originalFilter[`lines.${i}.project`] = line.project ?? null;
      } else if (String(line.project) === String(entry.project)) {
        if (line.projectNumber !== projectNumber) {
          set[`lines.${i}.projectNumber`] = projectNumber;
          originalFilter[`lines.${i}.project`] = line.project;
        }
      } else {
        review.push({ entryNumber: entry.entryNumber, reason: `line ${i + 1} names a different project` });
      }
    });
    if (Object.keys(set).length) plan.push({ entry, set, filter: originalFilter, lineCount: Object.keys(set).filter(k => k.endsWith('.projectNumber')).length });
  }

  const byKind = {};
  for (const { entry, lineCount } of plan) {
    const key = `${entry.source || '-'} / ${entry.accountingAction || '-'} [${entry.status}]`;
    byKind[key] = byKind[key] || { entries: 0, lines: 0 };
    byKind[key].entries += 1;
    byKind[key].lines += lineCount;
  }

  console.log(`\nJournal entries with a project: ${withProject.length}`);
  console.log(`Entries needing line Project/Project Number backfill: ${plan.length}`);
  if (plan.length) console.table(byKind);
  if (plan.length) console.log(`Entry numbers: ${plan.map(p => p.entry.entryNumber).sort((a, b) => a - b).join(', ')}`);
  if (review.length) {
    console.log(`\nLeft for manual review (never changed by this script): ${review.length}`);
    review.forEach(r => console.log(`  #${r.entryNumber}: ${r.reason}`));
  }

  if (!apply) {
    console.log('\nReport only: no changes made. Re-run with --yes to apply.');
    return { applied: false, entries: plan.length, review: review.length };
  }

  let modified = 0;
  for (const { set, filter } of plan) {
    // The filter re-checks each line's original project, so a line changed since the report is skipped.
    // eslint-disable-next-line no-await-in-loop
    const result = await entriesCollection.updateOne(filter, { $set: set });
    modified += result.modifiedCount;
  }
  console.log(`\nUpdated ${modified} of ${plan.length} journal entr${plan.length === 1 ? 'y' : 'ies'}.`);
  return { applied: true, entries: plan.length, modified, review: review.length };
}

if (require.main === module) {
  backfillJournalLineProjects()
    .then(() => mongoose.disconnect())
    .catch(async err => {
      console.error(err instanceof SafetyError ? `Refused: ${err.message}` : `Backfill failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { backfillJournalLineProjects };
