// Chart of Accounts ordering: always by account number (`code`) ascending, compared numerically
// so "2" < "10" < "100" (a plain string sort would give "10" < "100" < "2"). Codes are stored as
// strings and may contain non-digits (e.g. "CASH-01"), so this uses numeric-aware collation rather
// than parseInt. `_id` is only a tie-breaker (codes are unique, so it never matters in practice).

// Mongo query collation equivalent of compareAccountCodes - use with `.sort(ACCOUNT_CODE_SORT)`.
const ACCOUNT_CODE_COLLATION = { locale: 'en', numericOrdering: true };
const ACCOUNT_CODE_SORT = { code: 1, _id: 1 };

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function compareAccountCodes(a, b) {
  return collator.compare(String(a ?? ''), String(b ?? ''));
}

// Sorts accounts (or rows carrying an `account` object) by account code, without mutating input.
function sortByAccountCode(list, getCode = item => item?.code) {
  return [...(list || [])].sort((a, b) => compareAccountCodes(getCode(a), getCode(b)));
}

module.exports = { ACCOUNT_CODE_COLLATION, ACCOUNT_CODE_SORT, compareAccountCodes, sortByAccountCode };
