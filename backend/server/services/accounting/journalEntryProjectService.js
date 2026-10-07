const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');

// Project propagation for Journal Entry lines - the one place every JE builder (the automatic
// accounting engine, the manual Journal Entry create/update endpoints, reversals) uses to give each
// line the Project and Project Number of its parent entry.
//
// The Project Number is always read from the Project document itself (Project.projectNumber) -
// never taken from a request body, never derived from text, never generated here. The model's own
// pre('save') hook (journalEntryModel.js) re-checks the result, so a builder that skips this helper
// still cannot persist a project-related entry with project-less lines.

const idOf = ref => ref?._id || ref || null;
const sameId = (a, b) => String(idOf(a)) === String(idOf(b));

/**
 * The live Project Number of a Project. Throws a clear 400 when the project does not exist (or is
 * soft-deleted) or has no Project Number - a journal entry is never posted with a guessed one.
 */
async function resolveProjectNumber(projectRef, session) {
  const Project = mongoose.model('Project');
  const project = await Project.findById(idOf(projectRef)).select('projectNumber').session(session || null).lean();
  if (!project) throw new ApiError('The project of this journal entry does not exist.', 400);
  if (!project.projectNumber) {
    throw new ApiError(`The project ${idOf(projectRef)} has no Project Number, so it cannot be used on a journal entry.`, 400);
  }
  return project.projectNumber;
}

/**
 * Returns `lines` with the parent entry's Project and its real Project Number on every line.
 *
 *   - No parent project: lines are returned unchanged (a genuinely non-project entry).
 *   - A line with no project: gets the parent project.
 *   - A line naming a DIFFERENT project: rejected with a 400 - a project-related entry's lines must
 *     all belong to that project. `allowLineProjectOverride` exists only for reversals, which must
 *     mirror a historical entry exactly; such a line keeps its own project and gets that project's
 *     own Project Number.
 *   - Any client-supplied `projectNumber` is replaced by the Project's real number.
 */
async function applyEntryProjectToLines({ project, lines, session, allowLineProjectOverride = false }) {
  if (!idOf(project)) return lines;

  const projectId = idOf(project);
  const numberCache = new Map([[String(projectId), await resolveProjectNumber(projectId, session)]]);
  const numberOf = async id => {
    if (!numberCache.has(String(id))) numberCache.set(String(id), await resolveProjectNumber(id, session));
    return numberCache.get(String(id));
  };

  const result = [];
  for (const [index, line] of (lines || []).entries()) {
    const plain = typeof line?.toObject === 'function' ? line.toObject() : { ...line };
    const lineProject = idOf(plain.project);
    if (lineProject && !sameId(lineProject, projectId)) {
      if (!allowLineProjectOverride) {
        throw new ApiError(
          `Journal line ${index + 1} references a different project than its journal entry (Project ${numberCache.get(String(projectId))}). Every line of a project-related journal entry must use the entry's own Project.`,
          400
        );
      }
      // eslint-disable-next-line no-await-in-loop
      result.push({ ...plain, project: lineProject, projectNumber: await numberOf(lineProject) });
    } else {
      result.push({ ...plain, project: projectId, projectNumber: numberCache.get(String(projectId)) });
    }
  }
  return result;
}

module.exports = { resolveProjectNumber, applyEntryProjectToLines };
