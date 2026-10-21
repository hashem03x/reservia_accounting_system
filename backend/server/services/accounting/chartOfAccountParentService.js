// Which Chart of Accounts accounts may be selected as another account's Parent Account.
//
// There is no "is a parent" flag on the model - an account is a parent account when it appears in
// the Chart of Accounts table's "Parent Account" column for at least one other account. That column
// (pages/admin/accounts/index.tsx) shows, per account:
//   1. its `parentAccount` reference, when set - the real hierarchy link, otherwise
//   2. its `parentGroupNameEn` label - the CSV import's verbatim "Parent" column (see
//      chartOfAccountModel.js), which names the parent account by its English name, not by code.
// So the parent edges here are built exactly the same way: the reference wins, and a group label
// resolves to the account(s) whose own name it names (normalized the same way the Fixed Assets
// module matches group names, see fixedAssets/fixedAssetAccounts.js). An account that only HAS a
// parent, or merely belongs to some type/group, is never itself a parent because of that.
//
// The create/edit dropdown (`GET accounts/parent-eligible`) and the request validators both go
// through this one module, so the dropdown can never offer a parent the API would reject.

const { ACCOUNT_CODE_COLLATION, ACCOUNT_CODE_SORT } = require('../../utils/accountCodeSort');

const normalizeName = name =>
  (name || '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const idOf = ref => (ref ? String(ref._id || ref) : null);

/**
 * @param {Array<{ _id, name, parentAccount?, parentGroupNameEn? }>} accounts - the whole Chart of Accounts
 * @returns {Map<string, Set<string>>} parent account id -> ids of the accounts listing it as their Parent Account
 */
function buildChildrenIndex(accounts) {
  const idsByName = new Map();
  for (const account of accounts) {
    const key = normalizeName(account.name);
    if (!key) continue;
    if (!idsByName.has(key)) idsByName.set(key, []);
    idsByName.get(key).push(String(account._id));
  }

  const childrenOf = new Map();
  for (const account of accounts) {
    const id = String(account._id);
    const parentIds = account.parentAccount
      ? [idOf(account.parentAccount)]
      : idsByName.get(normalizeName(account.parentGroupNameEn)) || [];
    for (const parentId of parentIds) {
      if (parentId === id) continue;
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, new Set());
      childrenOf.get(parentId).add(id);
    }
  }
  return childrenOf;
}

/** Every account below `accountId` in the hierarchy (children, grandchildren, ...). */
function descendantIdsOf(accountId, childrenOf) {
  const found = new Set();
  const queue = [String(accountId)];
  while (queue.length) {
    for (const childId of childrenOf.get(queue.shift()) || []) {
      if (found.has(childId)) continue;
      found.add(childId);
      queue.push(childId);
    }
  }
  return found;
}

const isDesignatedParent = (accountId, childrenOf) => childrenOf.has(String(accountId));

/**
 * The accounts selectable as a Parent Account: active, designated parents. With `excludeId` (the
 * account being edited), that account and everything under it are left out - choosing any of them
 * would make the account its own ancestor.
 */
function selectParentEligible(accounts, { excludeId } = {}) {
  const childrenOf = buildChildrenIndex(accounts);
  const excluded = excludeId ? new Set([String(excludeId), ...descendantIdsOf(excludeId, childrenOf)]) : new Set();
  return accounts.filter(a => a.isActive !== false && isDesignatedParent(a._id, childrenOf) && !excluded.has(String(a._id)));
}

/**
 * Why `parentId` cannot be assigned as the Parent Account of `accountId` (null on create), or null
 * when it can. Re-saving an account with the parent it already has is always allowed, so editing
 * other fields never fails because of an existing relationship.
 */
function parentAssignmentError(accounts, parentId, { accountId } = {}) {
  const parent = accounts.find(a => String(a._id) === String(parentId));
  if (!parent) return 'Parent account does not exist.';
  if (accountId && String(parentId) === String(accountId)) return 'An account cannot be its own parent.';

  const account = accountId ? accounts.find(a => String(a._id) === String(accountId)) : null;
  if (account && idOf(account.parentAccount) === String(parentId)) return null;

  const childrenOf = buildChildrenIndex(accounts);
  if (accountId && descendantIdsOf(accountId, childrenOf).has(String(parentId))) {
    return 'An account cannot be placed under one of its own sub-accounts.';
  }
  if (parent.isActive === false) return 'The selected parent account is inactive.';
  if (!isDesignatedParent(parentId, childrenOf)) return 'The selected account is not designated as a parent account.';
  return null;
}

const loadAccounts = () => {
  const ChartOfAccount = require('../../models/accounting/chartOfAccountModel'); // eslint-disable-line global-require
  return ChartOfAccount.find({}).sort(ACCOUNT_CODE_SORT).collation(ACCOUNT_CODE_COLLATION).lean();
};

async function getParentEligibleAccounts({ excludeId } = {}) {
  return selectParentEligible(await loadAccounts(), { excludeId });
}

async function validateParentAssignment(parentId, { accountId } = {}) {
  return parentAssignmentError(await loadAccounts(), parentId, { accountId });
}

module.exports = {
  buildChildrenIndex,
  descendantIdsOf,
  selectParentEligible,
  parentAssignmentError,
  getParentEligibleAccounts,
  validateParentAssignment,
};
