// Run with: npm run test:unit   (Node's built-in test runner; Node strips the types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEEP_CURRENT_GROUP,
  accountTypeLabel,
  buildGroupSelectData,
  findGroupForAccount,
  groupFitsType,
  groupLabel,
  initialGroupValue,
  normalizeGroupName,
  parentGroupPayload,
  typeForSelectedGroup,
} from "./account-parent-groups.ts";

const en = (e: string) => e;
const ar = (_e: string, a: string) => a;

const groups = [
  { _id: "g-cash", nameEn: "Cash & Cash Equivalents", nameAr: "النقدية وما في حكمها", type: "asset" },
  { _id: "g-ar", nameEn: "Accounts Receivable", nameAr: "العملاء", type: "asset" },
  { _id: "g-ap", nameEn: "Accounts Payable", nameAr: "الموردين", type: "liability" },
];

test("names are matched normalized (case, spacing, dash variants), like the backend", () => {
  assert.equal(normalizeGroupName("  Accumulated  Depreciation – Fixed ASSETS "), "accumulated depreciation - fixed assets");
  assert.equal(normalizeGroupName(null), "");
  assert.equal(findGroupForAccount(groups, { parentGroupNameEn: "cash  &  cash equivalents" })?._id, "g-cash");
  assert.equal(findGroupForAccount(groups, { parentGroupNameEn: "Inventory" }), null);
  assert.equal(findGroupForAccount(groups, { parentGroupNameEn: null }), null);
});

test("labels follow the interface language (English and Arabic)", () => {
  assert.equal(groupLabel(groups[0], false), "Cash & Cash Equivalents");
  assert.equal(groupLabel(groups[0], true), "النقدية وما في حكمها");
  assert.equal(groupLabel({ nameEn: "Only English", nameAr: "" }, true), "Only English");
  assert.equal(accountTypeLabel("cogs", en), "Cost of Sales");
  assert.equal(accountTypeLabel("liability", ar), "خصوم");
  assert.equal(accountTypeLabel("unknown", en), "unknown");
});

test("options are grouped by account type in chart order, in the interface language", () => {
  const data = buildGroupSelectData(groups, { isArabic: false, translate: en });
  assert.deepEqual(
    data.map((s) => [s.group, s.items.map((i) => i.label)]),
    [
      ["Asset", ["Cash & Cash Equivalents", "Accounts Receivable"]],
      ["Liability", ["Accounts Payable"]],
    ],
  );
  const arabic = buildGroupSelectData(groups, { isArabic: true, translate: ar });
  assert.equal(arabic[0].group, "أصول");
  assert.equal(arabic[0].items[1].label, "العملاء");
  assert.deepEqual(buildGroupSelectData([], { isArabic: false, translate: en }), [], "empty state: no options");
});

test("groups of another type are disabled once the account type is chosen", () => {
  const data = buildGroupSelectData(groups, { isArabic: false, translate: en, accountType: "liability" });
  assert.deepEqual(
    data.flatMap((s) => s.items).map((i) => [i.value, !!i.disabled]),
    [
      ["g-cash", true],
      ["g-ar", true],
      ["g-ap", false],
    ],
  );
});

test("picking a group sets the account type; a type change clears a group that no longer fits", () => {
  assert.equal(typeForSelectedGroup(groups, "g-ap", "asset"), "liability");
  assert.equal(typeForSelectedGroup(groups, "", "asset"), "asset", "clearing the group keeps the type");
  assert.equal(typeForSelectedGroup(groups, KEEP_CURRENT_GROUP, "expense"), "expense");
  assert.equal(groupFitsType(groups, "g-cash", "asset"), true);
  assert.equal(groupFitsType(groups, "g-cash", "liability"), false);
  assert.equal(groupFitsType(groups, "", "liability"), true);
  assert.equal(groupFitsType(groups, KEEP_CURRENT_GROUP, "liability"), true, "the backend decides for an unmanaged current group");
});

test("editing an existing (migrated) account preselects its group", () => {
  assert.equal(initialGroupValue(groups, { parentGroupNameEn: "Accounts Receivable" }), "g-ar");
  assert.equal(initialGroupValue(groups, { parentGroupNameEn: null }), "");
  assert.equal(parentGroupPayload("g-ar"), "g-ar");
  assert.equal(parentGroupPayload(""), null, "clearing sends null");
});

test("an inactive or unmanaged current group is kept and offered, and is not re-sent on save", () => {
  const account = { type: "asset", parentGroupNameEn: "Old Deposits", parentGroupNameAr: "تأمينات قديمة" };
  assert.equal(initialGroupValue(groups, account), KEEP_CURRENT_GROUP);
  const data = buildGroupSelectData(groups, { isArabic: true, translate: ar, currentAccount: account });
  assert.equal(data[0].items[0].value, KEEP_CURRENT_GROUP);
  assert.match(data[0].items[0].label, /^تأمينات قديمة/);
  assert.equal(parentGroupPayload(KEEP_CURRENT_GROUP), undefined, "undefined = leave the group untouched");

  const managed = buildGroupSelectData(groups, { isArabic: false, translate: en, currentAccount: { parentGroupNameEn: "Accounts Receivable" } });
  assert.ok(!managed.some((s) => s.items.some((i) => i.value === KEEP_CURRENT_GROUP)), "no extra option when the group is selectable");
});
