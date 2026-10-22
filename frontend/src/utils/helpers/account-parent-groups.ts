// Pure helpers for Parent Account Groups (no React, no requests) - shared by the Parent Account
// Groups page and the Chart of Accounts form's group dropdown, and unit-tested on their own.
//
// An account belongs to the group whose normalized English name equals its normalized
// `parentGroupNameEn` - the same normalization as backend/server/utils/accountGroupName.js.

type Translate = (en: string, ar: string) => string;
type GroupLike = { _id: string; nameEn: string; nameAr: string; type: string; isActive?: boolean };
type AccountLike = { type?: string; parentGroupNameEn?: string | null; parentGroupNameAr?: string | null };

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "cogs", "expense"] as const;

const TYPE_LABELS: Record<string, [string, string]> = {
  asset: ["Asset", "أصول"],
  liability: ["Liability", "خصوم"],
  equity: ["Equity", "حقوق ملكية"],
  revenue: ["Revenue", "إيرادات"],
  cogs: ["Cost of Sales", "تكلفة المبيعات"],
  expense: ["Expense", "مصروفات"],
};

export function accountTypeLabel(type: string, translate: Translate): string {
  const label = TYPE_LABELS[type];
  return label ? translate(label[0], label[1]) : type;
}

export function normalizeGroupName(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The group's name in the interface language (Arabic falls back to English). */
export function groupLabel(group: { nameEn: string; nameAr?: string | null }, isArabic: boolean): string {
  return isArabic && group.nameAr ? group.nameAr : group.nameEn;
}

/** The group an account is classified under, among `groups`, or null. */
export function findGroupForAccount<G extends GroupLike>(groups: G[], account: AccountLike | null | undefined): G | null {
  const key = normalizeGroupName(account?.parentGroupNameEn);
  if (!key) return null;
  return groups.find((g) => normalizeGroupName(g.nameEn) === key) ?? null;
}

// Select value meaning "the account's current group, left as it is" - used when that group is not
// among the selectable ones (deactivated since, or a legacy name with no managed group yet).
export const KEEP_CURRENT_GROUP = "__current__";

export type GroupSelectOption = { value: string; label: string; disabled?: boolean };
export type GroupSelectData = { group: string; items: GroupSelectOption[] }[];

/**
 * Dropdown data, grouped by account type (in chart order). When `accountType` is set, groups of
 * other types are shown disabled - they cannot be combined with that type. The account's current
 * group (edit form) is always offered, so editing never silently drops it.
 */
export function buildGroupSelectData(
  groups: GroupLike[],
  {
    isArabic,
    translate,
    accountType,
    currentAccount,
  }: { isArabic: boolean; translate: Translate; accountType?: string; currentAccount?: AccountLike | null },
): GroupSelectData {
  const sections: GroupSelectData = [];
  for (const type of ACCOUNT_TYPES) {
    const items = groups
      .filter((g) => g.type === type)
      .map((g) => ({ value: g._id, label: groupLabel(g, isArabic), disabled: !!accountType && g.type !== accountType }));
    if (items.length) sections.push({ group: accountTypeLabel(type, translate), items });
  }

  if (currentAccount?.parentGroupNameEn && !findGroupForAccount(groups, currentAccount)) {
    const name = isArabic && currentAccount.parentGroupNameAr ? currentAccount.parentGroupNameAr : currentAccount.parentGroupNameEn;
    sections.unshift({
      group: translate("Current group", "المجموعة الحالية"),
      items: [{ value: KEEP_CURRENT_GROUP, label: `${name} (${translate("current - not selectable for new accounts", "الحالية - غير متاحة للحسابات الجديدة")})` }],
    });
  }
  return sections;
}

/** The initial dropdown value for an account being edited ("" = no group). */
export function initialGroupValue(groups: GroupLike[], account: AccountLike | null | undefined): string {
  if (!account?.parentGroupNameEn) return "";
  return findGroupForAccount(groups, account)?._id ?? KEEP_CURRENT_GROUP;
}

/**
 * The `parentGroup` value to send to the Chart of Accounts API: the group id, null to clear it,
 * or undefined to leave the account's group untouched (the current group was kept).
 */
export function parentGroupPayload(value: string): string | null | undefined {
  if (value === KEEP_CURRENT_GROUP) return undefined;
  return value || null;
}

/**
 * The account type after picking `groupId`: a group decides the type (its accounts must share it).
 * Clearing the group or keeping the current one leaves the type as it is.
 */
export function typeForSelectedGroup(groups: GroupLike[], groupId: string, currentType: string): string {
  const group = groups.find((g) => g._id === groupId);
  return group ? group.type : currentType;
}

/** Whether the selected group still fits after the type changes to `type` (otherwise clear it). */
export function groupFitsType(groups: GroupLike[], groupId: string, type: string): boolean {
  if (!groupId || groupId === KEEP_CURRENT_GROUP) return true;
  const group = groups.find((g) => g._id === groupId);
  return !group || !type || group.type === type;
}
