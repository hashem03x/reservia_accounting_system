const mongoose = require('mongoose');
const Sector = require('../../models/project/sectorModel');
const ApiError = require('../../utils/apiError');

const { SECTOR_NAME_COLLATION } = Sector;

// All Sector rules live here (the controller, the Project validators and the Project model all
// call into this file), so "is this a valid sector" can never be decided two different ways.
//
// Projects reference a sector by its name (Project.sector, a string - the field's original
// format). Project documents are always read/written through the raw `projects` collection here:
// usage counts include soft-deleted projects (they still hold the value), and a rename updates only
// the `sector` field without running any other Project save logic.

const projectsCollection = () => mongoose.connection.collection('projects');
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Number of projects (including soft-deleted ones) per sector name, compared case-insensitively. */
async function countProjectsBySector(names, session) {
  if (!names.length) return new Map();
  const rows = await projectsCollection()
    .aggregate([{ $match: { sector: { $in: names } } }, { $group: { _id: '$sector', count: { $sum: 1 } } }], { collation: SECTOR_NAME_COLLATION, session })
    .toArray();
  const counts = new Map();
  for (const row of rows) {
    const key = String(row._id).toLocaleLowerCase();
    counts.set(key, (counts.get(key) || 0) + row.count);
  }
  return counts;
}

async function countProjectsUsingSector(name, session) {
  return projectsCollection().countDocuments({ sector: name }, { collation: SECTOR_NAME_COLLATION, session });
}

/**
 * Sectors ordered by name. `activeOnly` returns only selectable sectors (the Project form);
 * `keyword` filters by name. Each sector carries `projectsCount` so the admin page can show why a
 * sector cannot be deleted.
 */
async function listSectors({ activeOnly = false, keyword = '' } = {}) {
  const filter = {};
  if (activeOnly) filter.isActive = true;
  const trimmed = typeof keyword === 'string' ? keyword.trim() : '';
  if (trimmed) filter.name = { $regex: escapeRegExp(trimmed), $options: 'i' };

  const sectors = await Sector.find(filter).sort({ name: 1 }).collation(SECTOR_NAME_COLLATION).lean();
  const counts = await countProjectsBySector(sectors.map(s => s.name));
  return sectors.map(s => ({ ...s, projectsCount: counts.get(s.name.toLocaleLowerCase()) || 0 }));
}

async function getSector(id) {
  const sector = await Sector.findById(id).lean();
  if (!sector) throw new ApiError(`No sector found with id ${id}`, 404);
  return { ...sector, projectsCount: await countProjectsUsingSector(sector.name) };
}

/** The sector with this name (case-insensitive), or null. */
function findSectorByName(name, session) {
  return Sector.findOne({ name: typeof name === 'string' ? name.trim() : name })
    .collation(SECTOR_NAME_COLLATION)
    .session(session || null);
}

async function assertNameAvailable(name, excludeId) {
  const existing = await findSectorByName(name);
  if (existing && String(existing._id) !== String(excludeId || '')) {
    throw new ApiError(`A sector named "${existing.name}" already exists.`, 400);
  }
}

const duplicateError = err => (err?.code === 11000 ? new ApiError('A sector with this name already exists.', 400) : err);

async function createSector({ name, isActive }) {
  await assertNameAvailable(name);
  try {
    const sector = await Sector.create({ name, isActive: isActive ?? true });
    return { ...sector.toObject(), projectsCount: 0 };
  } catch (err) {
    throw duplicateError(err); // two simultaneous creates: the unique index decides
  }
}

/**
 * Updates a sector's name and/or status. A rename also renames the sector on every project that
 * uses it, in the same transaction, so projects never point at a name that no longer exists.
 */
async function updateSector(id, { name, isActive }) {
  const current = await Sector.findById(id);
  if (!current) throw new ApiError(`No sector found with id ${id}`, 404);

  const newName = typeof name === 'string' ? name.trim() : undefined;
  const renamed = newName !== undefined && newName !== current.name;
  if (renamed) await assertNameAvailable(newName, current._id);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const sector = await Sector.findById(id).session(session);
      const oldName = sector.name;
      if (renamed) sector.name = newName;
      if (isActive !== undefined) sector.isActive = isActive;
      await sector.save({ session });
      if (renamed) {
        await projectsCollection().updateMany({ sector: oldName }, { $set: { sector: sector.name } }, { collation: SECTOR_NAME_COLLATION, session });
      }
    });
  } catch (err) {
    throw duplicateError(err);
  } finally {
    await session.endSession();
  }
  return getSector(id);
}

/**
 * Permanently deletes a sector - only when no project (including soft-deleted ones) uses it. A
 * sector in use is refused with a clear message; deactivating it is the way to retire it.
 */
async function deleteSector(id) {
  const sector = await Sector.findById(id);
  if (!sector) throw new ApiError(`No sector found with id ${id}`, 404);

  const inUse = await countProjectsUsingSector(sector.name);
  if (inUse > 0) {
    throw new ApiError(
      `The sector "${sector.name}" is used by ${inUse} project${inUse === 1 ? '' : 's'} and cannot be deleted. Deactivate it instead - it will stay on those projects but no longer be offered for new ones.`,
      400
    );
  }
  await Sector.deleteOne({ _id: sector._id });
}

/**
 * The canonical stored value for a sector a client selected on a project: the Sector's own name
 * (normalizing case), or null when cleared. Rejects names that are not an existing active sector.
 * `currentValue` is the project's existing sector - keeping it unchanged is always allowed, even if
 * that sector has since been deactivated, so editing an old project never forces a sector change.
 */
async function resolveProjectSector(value, { currentValue = null, session } = {}) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'string') throw new ApiError('Sector must be a sector name.', 400);
  if (currentValue && value.trim() === currentValue) return currentValue;

  const sector = await findSectorByName(value, session);
  if (!sector) throw new ApiError(`"${value}" is not a valid sector.`, 400);
  if (!sector.isActive) throw new ApiError(`The sector "${sector.name}" is inactive and cannot be selected.`, 400);
  return sector.name;
}

module.exports = {
  listSectors,
  getSector,
  createSector,
  updateSector,
  deleteSector,
  resolveProjectSector,
  findSectorByName,
  countProjectsUsingSector,
};
