const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { FixedAssetAccountGroups: G } = require('../../utils/accountingConstants');

// Which Chart of Accounts accounts the Fixed Assets module may use, resolved from the accounts'
// own group data (never account codes): an account belongs to a group when its parent group -
// `parentGroupNameEn` (set by the Chart of Accounts import) or its `parentAccount`'s name - is that
// group. The accumulated depreciation/amortization and Depreciation & Amortization groups may also
// be single accounts of that name, so for those an account's own name counts too.

const normalize = name =>
  (name || '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const groupNamesOf = account => [account.parentGroupNameEn, account.parentAccount?.name].map(normalize).filter(Boolean);
const inGroup = (account, group) => groupNamesOf(account).includes(normalize(group));
const isOrInGroup = (account, group) => normalize(account.name) === normalize(group) || inGroup(account, group);
const isUsable = account => !!account && account.isActive !== false;

/** 'tangible' | 'intangible' for an account a Fixed Asset can be recorded on, otherwise null. */
function assetClassOf(account) {
  if (!isUsable(account) || account.type !== 'asset') return null;
  // The contra accounts can sit inside the same groups - never an asset account themselves.
  if (isOrInGroup(account, G.accumulatedDepreciation) || isOrInGroup(account, G.accumulatedAmortization)) return null;
  if (inGroup(account, G.tangibleAssets)) return 'tangible';
  if (inGroup(account, G.intangibleAssets)) return 'intangible';
  return null;
}

/** Accumulated Depreciation (tangible) / Accumulated Amortization (intangible) accounts. */
function isAccumulatedAccountFor(account, assetClass) {
  if (!isUsable(account)) return false;
  return isOrInGroup(account, assetClass === 'intangible' ? G.accumulatedAmortization : G.accumulatedDepreciation);
}

function isDepreciationExpenseAccount(account) {
  return isUsable(account) && isOrInGroup(account, G.depreciationExpense);
}

const loadAccounts = (filter, session) =>
  ChartOfAccount.find(filter)
    .populate({ path: 'parentAccount', select: 'name' })
    .sort({ code: 1 })
    .session(session || null)
    .lean();

/** The selectable accounts for the Fixed Asset form, from the live Chart of Accounts. */
async function getFixedAssetAccountOptions() {
  const accounts = await loadAccounts({ isActive: { $ne: false } });
  const pick = ({ _id, code, name, nameAr, type }) => ({ _id, code, name, nameAr, type });
  return {
    assetAccounts: accounts.filter(a => assetClassOf(a)).map(a => ({ ...pick(a), assetClass: assetClassOf(a) })),
    accumulatedDepreciationAccounts: accounts.filter(a => isAccumulatedAccountFor(a, 'tangible')).map(pick),
    accumulatedAmortizationAccounts: accounts.filter(a => isAccumulatedAccountFor(a, 'intangible')).map(pick),
    depreciationExpenseAccounts: accounts.filter(isDepreciationExpenseAccount).map(pick),
  };
}

/**
 * Validates the three accounts of a Fixed Asset against the Chart of Accounts groups and returns
 * the asset's class. Throws a message naming the expected group.
 */
async function resolveFixedAssetAccounts({ assetAccount, accumulatedAccount, depreciationAccount }, session) {
  const ids = [assetAccount, accumulatedAccount, depreciationAccount].map(id => String(id?._id || id));
  const accounts = await loadAccounts({ _id: { $in: ids } }, session);
  const byId = new Map(accounts.map(a => [String(a._id), a]));
  const [asset, accumulated, expense] = ids.map(id => byId.get(id));

  const assetClass = assetClassOf(asset);
  if (!assetClass) {
    throw new Error(`The asset account must be an active account under "${G.tangibleAssets}" or "${G.intangibleAssets}".`);
  }
  if (!isAccumulatedAccountFor(accumulated, assetClass)) {
    throw new Error(`The accumulated account must be an active "${assetClass === 'intangible' ? G.accumulatedAmortization : G.accumulatedDepreciation}" account.`);
  }
  if (!isDepreciationExpenseAccount(expense)) {
    throw new Error(`The depreciation account must be an active "${G.depreciationExpense}" account.`);
  }
  return { assetClass, assetAccount: asset, accumulatedAccount: accumulated, depreciationAccount: expense };
}

module.exports = { assetClassOf, isAccumulatedAccountFor, isDepreciationExpenseAccount, getFixedAssetAccountOptions, resolveFixedAssetAccounts };
