// Computes the `sortOrder` a newly created ChartOfAccount should get, so new accounts land at the
// bottom of their type group (and, if given a parent, at the bottom of that parent's children)
// instead of an arbitrary position - see docs/entities/accounting.md's ordering requirement.
//
// Encoding: sortOrder = (type's position in TYPE_ORDER * BLOCK) + a running position within that
// block. A single ascending sort on `sortOrder` alone therefore reproduces the correct
// type-grouped order everywhere (API responses, selectors, reports) without needing a compound
// sort key - every consumer just needs to sort by `sortOrder` (ascending) instead of `code`.
const TYPE_ORDER = { asset: 0, liability: 1, equity: 2, revenue: 3, cogs: 4, expense: 5 };
const BLOCK = 1_000_000;
const DEFAULT_TYPE_RANK = Object.keys(TYPE_ORDER).length;

function typeBase(type) {
  return (TYPE_ORDER[type] ?? DEFAULT_TYPE_RANK) * BLOCK;
}

/**
 * @param {{ type: string, parentAccount?: string|null }} params
 * @returns {Promise<number>}
 */
async function getNextSortOrder({ type, parentAccount }) {
  const ChartOfAccount = require('../../models/accounting/chartOfAccountModel'); // eslint-disable-line global-require

  if (parentAccount) {
    const [lastChild, parentDoc] = await Promise.all([
      ChartOfAccount.findOne({ parentAccount }).sort({ sortOrder: -1 }).lean(),
      ChartOfAccount.findById(parentAccount).lean(),
    ]);
    if (lastChild) return lastChild.sortOrder + 1;
    // First child of this parent - start right after the parent itself so it still sorts within
    // the same type block even if the parent is near the end of it.
    return (parentDoc?.sortOrder ?? typeBase(type)) + 1;
  }

  const lastTopLevel = await ChartOfAccount.findOne({ type, parentAccount: null }).sort({ sortOrder: -1 }).lean();
  if (lastTopLevel) return lastTopLevel.sortOrder + 1;
  return typeBase(type) + 1;
}

module.exports = { getNextSortOrder, typeBase, TYPE_ORDER, BLOCK };
