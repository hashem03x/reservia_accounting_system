const Counter = require('../../models/config/counterModel');
const ApiError = require('../../utils/apiError');

// Sector-based Project ID generation (docs section "Automatic Project ID Generation"): format is
// `SECTOR_PREFIX-0000001`, where the prefix is the first three LETTERS of the project's actual,
// backend-resolved Sector name (services/project/sectorService.js#resolveProjectSector) - never a
// frontend-supplied prefix. The numeric sequence is independent per prefix (docs: "separate for
// each sector prefix"), so "Agriculture" and "Construction" projects are numbered in their own
// counters, both starting at 0000001.
//
// Mirrors journalEntryNumberService.js's atomic counter pattern exactly (fast-path-first
// increment, session-aware seed-on-first-use, E11000-tolerant race handling - see that file's long
// comment for why), parameterized by a per-prefix Counter document (`_id: "projectNumber:<PREFIX>"`)
// instead of one single sequence - this is the SAME Counter model/collection already used
// everywhere else (journalEntryNumber, customerNumber, vendorNumber, the Sales/Purchase Order
// codes), just one document per prefix instead of one document total. `Project.projectNumber`
// itself stays a plain, unique, required String (projectModel.js) - the schema's existing unique
// index is the final backstop against any collision, including with a historical project whose
// number was free-text (manually entered before this feature existed) and happens to coincide.
const RANGE_MIN = parseInt(process.env.PROJECT_NUMBER_RANGE_START, 10) || 1;
const RANGE_MAX = parseInt(process.env.PROJECT_NUMBER_RANGE_END, 10) || 9999999;

/**
 * Derives the 3-letter uppercase prefix from a sector name: letters only (spaces/punctuation/
 * digits stripped), first three of those, uppercased. Handles short names safely - a sector name
 * with fewer than 3 letters (e.g. "Ai") just yields a shorter prefix ("AI"), never throws.
 * Case/whitespace differences never matter - "agriculture", " Agriculture ", and "AGRICULTURE"
 * all produce "AGR".
 */
function sectorPrefix(sectorName) {
  const lettersOnly = String(sectorName || '')
    .trim()
    .replace(/[^a-zA-Z]/g, '');
  return lettersOnly.slice(0, 3).toUpperCase();
}

function sequenceNameFor(prefix) {
  return `projectNumber:${prefix}`;
}

function formatProjectNumber(prefix, seq) {
  return `${prefix}-${String(seq).padStart(7, '0')}`;
}

/**
 * Atomically allocates the next project number for the given sector name's prefix.
 * @param {string} sectorName - the project's REAL, already-resolved Sector name (the caller -
 *   projectController.js#createProject - must have already validated this against the Sector
 *   collection via resolveProjectSector; this function trusts it and only derives a prefix).
 * @param {import('mongoose').ClientSession} [session]
 */
async function getNextProjectNumber(sectorName, session) {
  const prefix = sectorPrefix(sectorName);
  if (!prefix) {
    throw new ApiError('A valid sector is required to generate a project number.', 400);
  }
  const sequenceName = sequenceNameFor(prefix);

  let updated = await Counter.findOneAndUpdate(
    { _id: sequenceName, $expr: { $lt: ['$seq', '$max'] } },
    { $inc: { seq: 1 } },
    { new: true, session }
  );

  if (!updated) {
    // Slow path: always retry the increment once after attempting to seed, regardless of whether
    // we won the seed race or a concurrent caller did (Counter.create's E11000 catch below makes
    // either outcome safe) - see journalEntryNumberService.js's long comment for the general
    // reasoning, and projectNumberAndOrderCode.test.js for the regression this specifically guards
    // against (a prior version here could falsely report "exhausted" under a concurrent
    // first-ever allocation for a brand-new prefix).
    try {
      await Counter.create([{ _id: sequenceName, seq: RANGE_MIN - 1, min: RANGE_MIN, max: RANGE_MAX }], { session });
    } catch (err) {
      if (err.code !== 11000) throw err; // lost the seed race to a concurrent first-ever caller - fine
    }
    updated = await Counter.findOneAndUpdate(
      { _id: sequenceName, $expr: { $lt: ['$seq', '$max'] } },
      { $inc: { seq: 1 } },
      { new: true, session }
    );
  }

  if (!updated) {
    const counter = await Counter.findById(sequenceName).session(session || null);
    const range = counter ? `${counter.min}-${counter.max}` : `${RANGE_MIN}-${RANGE_MAX}`;
    throw new ApiError(`Project number range (${range}) for sector prefix "${prefix}" is exhausted. Ask an administrator to configure a new range.`, 400);
  }

  return formatProjectNumber(prefix, updated.seq);
}

module.exports = { getNextProjectNumber, sectorPrefix, formatProjectNumber, sequenceNameFor, RANGE_MIN, RANGE_MAX };
