const Counter = require('../../models/config/counterModel');
const ApiError = require('../../utils/apiError');

const SEQUENCE_NAME = 'projectNumber';

// Mirrors journalEntryNumberService.js's atomic counter pattern exactly (fast-path-first
// increment, session-aware seed-on-first-use, E11000-tolerant race handling - see that file's
// long comment for why) - the only thing specific to projects is the output format below.
// `Project.projectNumber` itself stays a plain, unique, required String (projectModel.js) -
// nothing about the schema changes, only how a NEW project's number gets populated
// (controller/project/projectController.js#createProject calls getNextProjectNumber() instead of
// trusting req.body.projectNumber). Historical projects keep their existing manually-entered
// numbers forever - this counter only governs projects created from now on.
const RANGE_MIN = parseInt(process.env.PROJECT_NUMBER_RANGE_START, 10) || 1;
const RANGE_MAX = parseInt(process.env.PROJECT_NUMBER_RANGE_END, 10) || 999999;
const PREFIX = process.env.PROJECT_NUMBER_PREFIX || 'PRJ-';

function formatProjectNumber(seq) {
  return `${PREFIX}${String(seq).padStart(6, '0')}`;
}

async function getNextProjectNumber(session) {
  let updated = await Counter.findOneAndUpdate(
    { _id: SEQUENCE_NAME, $expr: { $lt: ['$seq', '$max'] } },
    { $inc: { seq: 1 } },
    { new: true, session }
  );

  if (!updated) {
    // Slow path: the fast increment found no counter document yet. Attempt to seed it - this
    // naturally no-ops (E11000) if a concurrent caller already won the seed race, which is exactly
    // the outcome we want (the document now exists either way) - so the increment below is always
    // retried once after this, regardless of which branch created it. An earlier version of this
    // function only retried when `Counter.findById` itself still reported "missing" at that exact
    // moment, which under concurrent first-time allocation could race: a sibling caller's seed
    // could land in the gap between the failed fast-path read and this re-check, making
    // `findById` report "exists" while `updated` was still null - skipping the retry entirely and
    // throwing a false "exhausted" error even though the counter was healthy. Always retrying here
    // closes that gap.
    try {
      await Counter.create([{ _id: SEQUENCE_NAME, seq: RANGE_MIN - 1, min: RANGE_MIN, max: RANGE_MAX }], { session });
    } catch (err) {
      if (err.code !== 11000) throw err; // lost the seed race to a concurrent first-ever caller - fine
    }
    updated = await Counter.findOneAndUpdate(
      { _id: SEQUENCE_NAME, $expr: { $lt: ['$seq', '$max'] } },
      { $inc: { seq: 1 } },
      { new: true, session }
    );
  }

  if (!updated) {
    const counter = await Counter.findById(SEQUENCE_NAME).session(session || null);
    const range = counter ? `${counter.min}-${counter.max}` : `${RANGE_MIN}-${RANGE_MAX}`;
    throw new ApiError(`Project number range (${range}) is exhausted. Ask an administrator to configure a new range.`, 400);
  }

  return formatProjectNumber(updated.seq);
}

module.exports = { getNextProjectNumber, formatProjectNumber, SEQUENCE_NAME, RANGE_MIN, RANGE_MAX };
