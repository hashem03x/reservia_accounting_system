// One normalization for Chart of Accounts parent group names, used wherever a group name typed by
// a person (or carried by the CSV import) has to be compared with another one: duplicate checks on
// AccountParentGroup, matching an account's stored `parentGroupNameEn` to its group, and the legacy
// data migration. Dash variants, repeated whitespace and letter case never make two groups
// different - the same rules services/fixedAssets/fixedAssetAccounts.js uses to match group names.
const normalizeGroupName = name =>
  (typeof name === 'string' ? name : '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

module.exports = { normalizeGroupName };
