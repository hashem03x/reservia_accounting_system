// Chart of Accounts ordering - always by account number (`code`) ascending, compared numerically
// so "2" < "10" < "100". Mirrors backend/server/utils/accountCodeSort.js; the backend already
// returns accounts in this order, this keeps any client-side list/merge in the same order.

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function compareAccountCodes(a?: string | null, b?: string | null): number {
  return collator.compare(String(a ?? ""), String(b ?? ""));
}

export function sortAccountsByCode<T extends { code?: string | null }>(accounts: T[] | null | undefined): T[] {
  return [...(accounts || [])].sort((a, b) => compareAccountCodes(a?.code, b?.code));
}
