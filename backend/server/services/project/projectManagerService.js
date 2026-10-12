const mongoose = require('mongoose');
const ProjectManager = require('../../models/project/projectManagerModel');
const ApiError = require('../../utils/apiError');

const { PROJECT_MANAGER_NAME_COLLATION } = ProjectManager;

// All Project Manager rules live here (the controller, the Project validators and the import script
// call into this file), so "is this a valid project manager" is decided in one place.
//
// Projects reference a project manager by id (Project.projectManager). Project documents are read
// through the raw `projects` collection so usage counts include soft-deleted projects (they still
// hold the reference) and nothing else about a project is ever touched here.

const projectsCollection = () => mongoose.connection.collection('projects');
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blank = value => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
const clean = value => (blank(value) ? null : String(value).trim());

async function countProjectsByManager(ids) {
  if (!ids.length) return new Map();
  const rows = await projectsCollection()
    .aggregate([{ $match: { projectManager: { $in: ids } } }, { $group: { _id: '$projectManager', count: { $sum: 1 } } }])
    .toArray();
  return new Map(rows.map(r => [String(r._id), r.count]));
}

const countProjectsUsingManager = id => projectsCollection().countDocuments({ projectManager: new mongoose.Types.ObjectId(String(id)) });

/**
 * Project managers ordered by name. `activeOnly` returns only selectable ones (the Project forms);
 * `keyword` searches name, email and phone. Each carries `projectsCount` (why one cannot be deleted).
 */
async function listProjectManagers({ activeOnly = false, keyword = '' } = {}) {
  const filter = {};
  if (activeOnly) filter.isActive = true;
  const trimmed = typeof keyword === 'string' ? keyword.trim() : '';
  if (trimmed) {
    const re = { $regex: escapeRegExp(trimmed), $options: 'i' };
    filter.$or = [{ name: re }, { email: re }, { phone: re }];
  }
  const managers = await ProjectManager.find(filter).sort({ name: 1 }).collation(PROJECT_MANAGER_NAME_COLLATION).lean();
  const counts = await countProjectsByManager(managers.map(m => m._id));
  return managers.map(m => ({ ...m, projectsCount: counts.get(String(m._id)) || 0 }));
}

async function getProjectManager(id) {
  const manager = await ProjectManager.findById(id).lean();
  if (!manager) throw new ApiError(`No project manager found with id ${id}`, 404);
  return { ...manager, projectsCount: await countProjectsUsingManager(manager._id) };
}

async function assertAvailable({ name, email }, excludeId) {
  const other = { _id: { $ne: excludeId || null } };
  if (name !== undefined) {
    const sameName = await ProjectManager.findOne({ name: name.trim(), ...other }).collation(PROJECT_MANAGER_NAME_COLLATION).lean();
    if (sameName) throw new ApiError(`A project manager named "${sameName.name}" already exists.`, 400);
  }
  if (email) {
    const sameEmail = await ProjectManager.findOne({ email: email.toLowerCase(), ...other }).lean();
    if (sameEmail) throw new ApiError(`The email ${email.toLowerCase()} is already used by the project manager "${sameEmail.name}".`, 400);
  }
}

const duplicateError = err => (err?.code === 11000 ? new ApiError('A project manager with this name or email already exists.', 400) : err);

async function createProjectManager({ name, email, phone, isActive }) {
  const data = { name: String(name).trim(), email: clean(email), phone: clean(phone), isActive: isActive ?? true };
  await assertAvailable(data);
  try {
    const manager = await ProjectManager.create(data);
    return { ...manager.toObject(), projectsCount: 0 };
  } catch (err) {
    throw duplicateError(err); // two simultaneous creates: the unique indexes decide
  }
}

/**
 * Updates a project manager. Projects reference the manager by id, so a new name or contact shows on
 * every project and report at once - nothing on the projects needs rewriting.
 */
async function updateProjectManager(id, { name, email, phone, isActive }) {
  const manager = await ProjectManager.findById(id);
  if (!manager) throw new ApiError(`No project manager found with id ${id}`, 404);
  const changes = {};
  if (name !== undefined) changes.name = String(name).trim();
  if (email !== undefined) changes.email = clean(email);
  if (phone !== undefined) changes.phone = clean(phone);
  if (isActive !== undefined) changes.isActive = isActive;
  await assertAvailable({ name: changes.name !== undefined && changes.name.toLowerCase() !== manager.name.toLowerCase() ? changes.name : undefined, email: changes.email && changes.email !== manager.email ? changes.email : null }, manager._id);
  Object.assign(manager, changes);
  try {
    await manager.save();
  } catch (err) {
    throw duplicateError(err);
  }
  return getProjectManager(id);
}

/** Deletes a project manager no project (including soft-deleted ones) refers to; otherwise refuses. */
async function deleteProjectManager(id) {
  const manager = await ProjectManager.findById(id);
  if (!manager) throw new ApiError(`No project manager found with id ${id}`, 404);
  const inUse = await countProjectsUsingManager(manager._id);
  if (inUse > 0) {
    throw new ApiError(
      `"${manager.name}" is the project manager of ${inUse} project${inUse === 1 ? '' : 's'} and cannot be deleted. Deactivate them instead - they stay on those projects but are no longer offered for new ones.`,
      400
    );
  }
  await ProjectManager.deleteOne({ _id: manager._id });
}

/**
 * Checks the project manager chosen for a project: an existing, active project manager. Keeping the
 * project's current manager is always allowed (even one deactivated since), so editing an old project
 * never forces a change.
 */
async function assertSelectableProjectManager(value, { currentValue = null } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(value))) throw new ApiError('Invalid project manager id', 400);
  if (currentValue && String(currentValue) === String(value)) return;
  const manager = await ProjectManager.findById(value).select('name isActive').lean();
  if (!manager) throw new ApiError('Project manager does not exist.', 400);
  if (!manager.isActive) throw new ApiError(`The project manager "${manager.name}" is inactive and cannot be selected.`, 400);
}

/**
 * Projects whose manager has no Project Manager record yet: before this collection existed, a project
 * referenced a staff user. Returns those users (name / email / phone) with their project counts.
 */
async function legacyProjectManagers() {
  const referenced = await projectsCollection().distinct('projectManager', { projectManager: { $type: 'objectId' } });
  if (!referenced.length) return [];
  const known = new Set((await ProjectManager.find({ _id: { $in: referenced } }).select('_id').lean()).map(m => String(m._id)));
  const missing = referenced.filter(id => !known.has(String(id)));
  if (!missing.length) return [];
  const [users, counts] = await Promise.all([mongoose.connection.collection('users').find({ _id: { $in: missing } }, { projection: { name: 1, email: 1, phone: 1 } }).toArray(), countProjectsByManager(missing)]);
  const userById = new Map(users.map(u => [String(u._id), u]));
  return missing.map(id => {
    const user = userById.get(String(id));
    return { _id: String(id), name: user?.name || null, email: user?.email || null, phone: user?.phone || null, projectsCount: counts.get(String(id)) || 0, userFound: !!user };
  });
}

/**
 * Creates a Project Manager record for each legacy manager (same _id as the user, so the projects'
 * references stay valid - no project is modified). Idempotent: a manager already imported is never
 * created again. A referenced user that no longer exists, or whose name clashes with an existing
 * project manager, is returned in `skipped` for the admin to resolve - never guessed.
 */
async function importLegacyProjectManagers() {
  const legacy = await legacyProjectManagers();
  const imported = [];
  const skipped = [];
  for (const m of legacy) {
    if (!m.userFound || !m.name) {
      skipped.push({ _id: m._id, reason: 'The user this project manager referred to no longer exists.', projectsCount: m.projectsCount });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const clash = await ProjectManager.findOne({ name: m.name.trim() }).collation(PROJECT_MANAGER_NAME_COLLATION).lean();
    // eslint-disable-next-line no-await-in-loop
    const emailTaken = m.email ? await ProjectManager.exists({ email: String(m.email).toLowerCase() }) : null;
    if (clash || emailTaken) {
      skipped.push({ _id: m._id, name: m.name, reason: clash ? `A project manager named "${clash.name}" already exists.` : `The email ${m.email} is already used by another project manager.`, projectsCount: m.projectsCount });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await ProjectManager.create({ _id: new mongoose.Types.ObjectId(m._id), name: m.name.trim(), email: clean(m.email), phone: clean(m.phone), isActive: true });
      imported.push({ _id: m._id, name: m.name, projectsCount: m.projectsCount });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      skipped.push({ _id: m._id, name: m.name, reason: 'Already imported or a duplicate name / email.', projectsCount: m.projectsCount });
    }
  }
  return { imported, skipped };
}

module.exports = {
  listProjectManagers,
  getProjectManager,
  createProjectManager,
  updateProjectManager,
  deleteProjectManager,
  assertSelectableProjectManager,
  legacyProjectManagers,
  importLegacyProjectManagers,
  countProjectsUsingManager,
};
