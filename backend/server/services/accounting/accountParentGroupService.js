const mongoose = require('mongoose');
const AccountParentGroup = require('../../models/accounting/accountParentGroupModel');
const AccountParentGroupLog = require('../../models/accounting/accountParentGroupLogModel');
const ApiError = require('../../utils/apiError');
const { AccountTypes, CashEquivalentParentGroupName, FixedAssetAccountGroups } = require('../../utils/accountingConstants');
const { normalizeGroupName } = require('../../utils/accountGroupName');

// All Parent Account Group rules live here (the group controller, the Chart of Accounts controller
// and the legacy-data migration all call into this file), so "which group is this account in" and
// "can this group be used" are never decided two different ways.
//
// Accounts reference a group by name: ChartOfAccount.parentGroupNameEn / parentGroupNameAr stay the
// stored classification every report and business rule reads (Cash & Cash Equivalents, Fixed
// Assets, PUC, tax reports...). An account belongs to the group whose normalized English name equals
// its normalized `parentGroupNameEn` (utils/accountGroupName.js). Accounts are read/written through
// the raw `chartofaccounts` collection here: counts include inactive accounts (they still carry the
// classification), and a rename touches only the two name fields without running any other account
// save logic. Nothing here ever creates a journal entry or touches a balance.

const accountsCollection = () => mongoose.connection.collection('chartofaccounts');
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TYPE_RANK = Object.fromEntries(['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'].map((t, i) => [t, i]));
const typeRank = type => TYPE_RANK[type] ?? AccountTypes.length;

// Groups that automatic business rules look up by name - see accountingConstants.js
// (CashEquivalentParentGroupName decides payment-method accounts; FixedAssetAccountGroups decides
// the Fixed Assets module's accounts). Renaming, retyping, deactivating or deleting one would
// silently change which accounts those rules pick up.
const SYSTEM_DEFAULT_GROUP_KEYS = new Set([CashEquivalentParentGroupName, ...Object.values(FixedAssetAccountGroups)].map(normalizeGroupName));
const isSystemDefaultName = nameEn => SYSTEM_DEFAULT_GROUP_KEYS.has(normalizeGroupName(nameEn));

/**
 * Every distinct stored `parentGroupNameEn` spelling, grouped by its normalized key:
 * key -> { count, spellings: [exact stored strings] }.
 */
async function accountGroupNameUsage(session) {
  const rows = await accountsCollection()
    .aggregate([{ $match: { parentGroupNameEn: { $type: 'string', $ne: '' } } }, { $group: { _id: '$parentGroupNameEn', count: { $sum: 1 } } }], { session })
    .toArray();
  const usage = new Map();
  for (const row of rows) {
    const key = normalizeGroupName(row._id);
    if (!key) continue;
    const entry = usage.get(key) || { count: 0, spellings: [] };
    entry.count += row.count;
    entry.spellings.push(row._id);
    usage.set(key, entry);
  }
  return usage;
}

const toPlain = (doc, accountCount) => {
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  delete plain.nameEnKey;
  delete plain.nameArKey;
  return accountCount === undefined ? plain : { ...plain, accountCount };
};

const compareGroups = (a, b) => typeRank(a.type) - typeRank(b.type) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.nameEn).localeCompare(String(b.nameEn));

const SORTERS = {
  sortOrder: compareGroups,
  nameEn: (a, b) => String(a.nameEn).localeCompare(String(b.nameEn), 'en', { sensitivity: 'base' }),
  nameAr: (a, b) => String(a.nameAr).localeCompare(String(b.nameAr), 'ar', { sensitivity: 'base' }),
  type: (a, b) => typeRank(a.type) - typeRank(b.type) || compareGroups(a, b),
  accountCount: (a, b) => a.accountCount - b.accountCount || compareGroups(a, b),
  updatedAt: (a, b) => new Date(a.updatedAt) - new Date(b.updatedAt),
};

/**
 * Lists groups with the number of accounts classified under each. `status`: 'active' | 'inactive' |
 * anything else = all. `type` filters by account type. `keyword` matches either name or the
 * description. `sort` is one whitelisted field, optionally prefixed with '-' (default: account type
 * order, then sortOrder). Groups are a short list, so filtering by count/sorting happens in memory;
 * the response shape mirrors handlersFactory.js#getAll (results / paginationResult / data).
 */
async function listGroups({ keyword = '', status = 'all', type = '', sort = 'sortOrder', page = 1, limit = 50 } = {}) {
  const filter = {};
  if (status === 'active') filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;
  if (type && AccountTypes.includes(type)) filter.type = type;
  const trimmed = typeof keyword === 'string' ? keyword.trim() : '';
  if (trimmed) {
    const rx = { $regex: escapeRegExp(trimmed), $options: 'i' };
    filter.$or = [{ nameEn: rx }, { nameAr: rx }, { description: rx }];
  }

  const [groups, usage] = await Promise.all([AccountParentGroup.find(filter).lean(), accountGroupNameUsage()]);
  const rows = groups.map(g => toPlain(g, usage.get(normalizeGroupName(g.nameEn))?.count || 0));

  const rawSort = typeof sort === 'string' ? sort.trim() : '';
  const desc = rawSort.startsWith('-');
  const sorter = SORTERS[desc ? rawSort.slice(1) : rawSort] || SORTERS.sortOrder;
  rows.sort((a, b) => (desc ? -sorter(a, b) : sorter(a, b)));

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;
  const data = rows.slice(skip, skip + limitNum);

  return {
    results: data.length,
    paginationResult: {
      currentPage: pageNum,
      limit: limitNum,
      numberOfPages: Math.max(1, Math.ceil(rows.length / limitNum)),
      ...(skip + limitNum < rows.length ? { next: pageNum + 1 } : {}),
      ...(skip > 0 ? { prev: pageNum - 1 } : {}),
    },
    totalCount: rows.length,
    data,
  };
}

/** Active groups for the Chart of Accounts form's dropdown, optionally of one account type. */
async function getSelectableGroups({ type } = {}) {
  const filter = { isActive: true };
  if (type && AccountTypes.includes(type)) filter.type = type;
  const groups = await AccountParentGroup.find(filter).lean();
  return groups.map(g => toPlain(g)).sort(compareGroups);
}

async function findGroupOrFail(id, session) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(`Invalid parent group id ${id}`, 400);
  const group = await AccountParentGroup.findById(id).session(session || null);
  if (!group) throw new ApiError(`No parent group found with id ${id}`, 404);
  return group;
}

async function getGroup(id) {
  const group = await findGroupOrFail(id);
  const usage = await accountGroupNameUsage();
  return toPlain(group, usage.get(normalizeGroupName(group.nameEn))?.count || 0);
}

/** The group an account's stored English group name belongs to, or null. */
function findGroupByName(nameEn, session) {
  const key = normalizeGroupName(nameEn);
  if (!key) return null;
  return AccountParentGroup.findOne({ nameEnKey: key }).session(session || null);
}

async function assertNamesAvailable({ nameEn, nameAr }, excludeId) {
  const exclude = excludeId ? { _id: { $ne: excludeId } } : {};
  if (nameEn !== undefined) {
    const clash = await AccountParentGroup.findOne({ nameEnKey: normalizeGroupName(nameEn), ...exclude }).lean();
    if (clash) throw new ApiError(`A parent group named "${clash.nameEn}" already exists.`, 400);
  }
  if (nameAr !== undefined) {
    const clash = await AccountParentGroup.findOne({ nameArKey: normalizeGroupName(nameAr), ...exclude }).lean();
    if (clash) throw new ApiError(`A parent group with the Arabic name "${clash.nameAr}" already exists.`, 400);
  }
}

const duplicateError = err => (err?.code === 11000 ? new ApiError('A parent group with this name already exists.', 400) : err);
const validationError = err => (err?.name === 'ValidationError' ? new ApiError(Object.values(err.errors)[0]?.message || err.message, 400) : err);

const snapshot = g => ({
  nameEn: g.nameEn,
  nameAr: g.nameAr,
  type: g.type,
  description: g.description,
  sortOrder: g.sortOrder,
  isActive: g.isActive,
  isSystemDefault: g.isSystemDefault,
});

const log = (entry, session) => AccountParentGroupLog.create([entry], { session: session || undefined });

async function nextSortOrder(type) {
  const last = await AccountParentGroup.findOne({ type }).sort({ sortOrder: -1 }).lean();
  return last ? (last.sortOrder ?? 0) + 1 : 1;
}

async function createGroup({ nameEn, nameAr, type, description, sortOrder, isActive }, userId) {
  if (!AccountTypes.includes(type)) throw new ApiError(`Account type must be one of: ${AccountTypes.join(', ')}`, 400);
  await assertNamesAvailable({ nameEn, nameAr });
  try {
    const group = await AccountParentGroup.create({
      nameEn,
      nameAr,
      type,
      description: description || '',
      sortOrder: sortOrder === undefined || sortOrder === null || sortOrder === '' ? await nextSortOrder(type) : Number(sortOrder),
      isActive: isActive ?? true,
      isSystemDefault: isSystemDefaultName(nameEn),
      createdBy: userId || null,
      updatedBy: userId || null,
    });
    await log({ action: 'create', group: group._id, groupNameEn: group.nameEn, actor: userId || null, after: snapshot(group) });
    // A group created for a name accounts already carry (e.g. one the migration flagged) picks
    // those accounts up immediately - they are matched by name, nothing is rewritten.
    const usage = await accountGroupNameUsage();
    return toPlain(group, usage.get(normalizeGroupName(group.nameEn))?.count || 0);
  } catch (err) {
    throw validationError(duplicateError(err));
  }
}

/**
 * Updates a group. Rules:
 *  - a system-default group keeps its names, type and active status (business rules read it);
 *  - the type cannot change while accounts are classified under the group (their own type would no
 *    longer match it) - reclassify those accounts first;
 *  - a rename also renames the group on every account classified under it, in the same transaction,
 *    so no account is left carrying a name that no longer exists. Only the two group-name fields of
 *    those accounts change; no balance, entry or other account field is touched.
 */
async function updateGroup(id, input, userId) {
  const current = await findGroupOrFail(id);
  const before = snapshot(current);

  const nameEn = typeof input.nameEn === 'string' ? input.nameEn.trim() : undefined;
  const nameAr = typeof input.nameAr === 'string' ? input.nameAr.trim() : undefined;
  const renamedEn = nameEn !== undefined && nameEn !== current.nameEn;
  const renamedAr = nameAr !== undefined && nameAr !== current.nameAr;
  const retyped = input.type !== undefined && input.type !== current.type;
  const statusChanged = input.isActive !== undefined && input.isActive !== current.isActive;

  if (current.isSystemDefault) {
    if (renamedEn || renamedAr) throw new ApiError(`"${current.nameEn}" is a system-default group used by automatic accounting rules - its name cannot be changed.`, 400);
    if (retyped) throw new ApiError(`"${current.nameEn}" is a system-default group - its account type cannot be changed.`, 400);
    if (statusChanged && input.isActive === false) throw new ApiError(`"${current.nameEn}" is a system-default group and cannot be deactivated.`, 400);
  }
  if (retyped && !AccountTypes.includes(input.type)) throw new ApiError(`Account type must be one of: ${AccountTypes.join(', ')}`, 400);

  const usage = (await accountGroupNameUsage()).get(normalizeGroupName(current.nameEn)) || { count: 0, spellings: [] };
  if (retyped && usage.count > 0) {
    throw new ApiError(
      `${usage.count} account${usage.count === 1 ? ' is' : 's are'} classified under "${current.nameEn}" as ${current.type} - the group's type cannot change while accounts use it. Move those accounts to another group first.`,
      400
    );
  }
  if (renamedEn || renamedAr) {
    await assertNamesAvailable({ nameEn: renamedEn ? nameEn : undefined, nameAr: renamedAr ? nameAr : undefined }, current._id);
  }

  let accountsUpdated = 0;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      accountsUpdated = 0;
      const group = await AccountParentGroup.findById(id).session(session);
      if (renamedEn) group.nameEn = nameEn;
      if (renamedAr) group.nameAr = nameAr;
      if (retyped) group.type = input.type;
      if (input.description !== undefined) group.description = input.description || '';
      if (input.sortOrder !== undefined && input.sortOrder !== null && input.sortOrder !== '') group.sortOrder = Number(input.sortOrder);
      if (statusChanged) group.isActive = input.isActive;
      group.updatedBy = userId || null;
      await group.save({ session });

      if ((renamedEn || renamedAr) && usage.spellings.length) {
        const result = await accountsCollection().updateMany(
          { parentGroupNameEn: { $in: usage.spellings } },
          { $set: { parentGroupNameEn: group.nameEn, parentGroupNameAr: group.nameAr, updatedAt: new Date() } },
          { session }
        );
        accountsUpdated = result.modifiedCount;
      }

      const onlyStatus = statusChanged && !renamedEn && !renamedAr && !retyped && input.description === undefined && input.sortOrder === undefined;
      await log(
        {
          action: onlyStatus ? (group.isActive ? 'activate' : 'deactivate') : 'update',
          group: group._id,
          groupNameEn: group.nameEn,
          actor: userId || null,
          before,
          after: snapshot(group),
          accountsUpdated,
        },
        session
      );
    });
  } catch (err) {
    throw validationError(duplicateError(err));
  } finally {
    await session.endSession();
  }
  return { ...(await getGroup(id)), accountsUpdated };
}

/** Activate / deactivate. Deactivating never changes the accounts already classified under it. */
function setGroupStatus(id, isActive, userId) {
  return updateGroup(id, { isActive }, userId);
}

/**
 * Permanently deletes a group - only a non-system-default group no account is classified under.
 * A group in use is refused with a clear message; deactivating it is the way to retire it.
 */
async function deleteGroup(id, userId) {
  const group = await findGroupOrFail(id);
  if (group.isSystemDefault) throw new ApiError(`"${group.nameEn}" is a system-default group used by automatic accounting rules and cannot be deleted.`, 400);
  const inUse = (await accountGroupNameUsage()).get(normalizeGroupName(group.nameEn))?.count || 0;
  if (inUse > 0) {
    throw new ApiError(
      `The parent group "${group.nameEn}" is assigned to ${inUse} account${inUse === 1 ? '' : 's'} and cannot be deleted. Deactivate it instead - those accounts keep it, but it is no longer offered for new accounts.`,
      400
    );
  }
  await AccountParentGroup.deleteOne({ _id: group._id });
  await log({ action: 'delete', group: group._id, groupNameEn: group.nameEn, actor: userId || null, before: snapshot(group) });
}

/**
 * The group-name fields to store on a Chart of Accounts account for the group a client selected.
 * `parentGroup` is the selected group's id, null/'' to clear it, or undefined to leave the account's
 * group as it is. `type` is the account's (new) type; `current` the account being edited (null on
 * create). Returns the fields to $set - {} when nothing changes.
 *
 *  - The selected group must exist, be active and have the account's type. Keeping the account's
 *    current group is always allowed, even if that group has since been deactivated, so editing an
 *    old account never forces a classification change (its stored names are left untouched).
 *  - Changing only the account's type is refused when its current (managed) group has another type.
 *    A legacy name with no managed group yet is left alone.
 */
async function resolveAccountGroupAssignment({ parentGroup, type, current = null } = {}) {
  const finalType = type || current?.type;

  if (parentGroup === undefined) {
    if (current?.parentGroupNameEn && finalType && finalType !== current.type) {
      const group = await findGroupByName(current.parentGroupNameEn);
      if (group && group.type !== finalType) {
        throw new ApiError(`This account is in the parent group "${group.nameEn}", which is a ${group.type} group - choose a ${finalType} group or keep the type ${group.type}.`, 400);
      }
    }
    return {};
  }
  if (parentGroup === null || parentGroup === '') return { parentGroupNameEn: null, parentGroupNameAr: null };
  if (!mongoose.isValidObjectId(parentGroup)) throw new ApiError('Invalid parent group id', 400);

  const group = await AccountParentGroup.findById(parentGroup);
  if (!group) throw new ApiError('The selected parent group does not exist.', 400);
  const isCurrent = !!current && normalizeGroupName(current.parentGroupNameEn) === normalizeGroupName(group.nameEn);
  if (!group.isActive && !isCurrent) throw new ApiError(`The parent group "${group.nameEn}" is inactive and cannot be assigned.`, 400);
  if (finalType && group.type !== finalType) {
    throw new ApiError(`The parent group "${group.nameEn}" is for ${group.type} accounts - it cannot be used for a ${finalType} account.`, 400);
  }
  if (isCurrent) return {};
  return { parentGroupNameEn: group.nameEn, parentGroupNameAr: group.nameAr };
}

module.exports = {
  normalizeGroupName,
  isSystemDefaultName,
  accountGroupNameUsage,
  listGroups,
  getSelectableGroups,
  getGroup,
  findGroupByName,
  createGroup,
  updateGroup,
  setGroupStatus,
  deleteGroup,
  resolveAccountGroupAssignment,
};
