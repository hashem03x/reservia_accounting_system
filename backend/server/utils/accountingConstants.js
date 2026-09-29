// Shared enums/config for the new accounting foundation (Chart of Accounts, Journal Entries,
// Projects, Fixed Assets). Kept in one file, mirroring how appConstant.js centralizes the
// pre-existing Resources/Actions/PaymentMethods enums, rather than scattering string literals
// across models/controllers.

exports.AccountTypes = ['asset', 'liability', 'equity', 'revenue', 'expense'];

exports.JournalEntryStatus = ['draft', 'posted', 'reversed'];

// "source" identifies what business event produced a journal entry. `project_creation` is used
// for the automatic entry required by this phase; `manual` covers everything an accountant enters
// by hand via the Journal Entries UI. Extra values can be appended later (e.g.
// `fixed_asset_purchase`) without touching existing entries.
exports.JournalEntrySources = ['manual', 'project_creation', 'fixed_asset_purchase'];

exports.ProjectStatuses = ['active', 'completed', 'cancelled', 'on_hold'];

exports.FixedAssetStatuses = ['active', 'disposed', 'under_maintenance'];

// Well-known account codes the automatic accounting entries (project creation, fixed asset
// purchase) look up by code rather than by a hardcoded ObjectId. Overridable via env so a
// deployment can point at differently-coded accounts without a code change. These codes are only
// a *lookup key* - the actual ChartOfAccount documents are created by
// scripts/seedChartOfAccounts.js (see docs/entities/accounting.md), never invented at request
// time.
exports.DefaultAccountCodes = {
  accountsReceivable: process.env.ACCOUNT_CODE_ACCOUNTS_RECEIVABLE || '1100',
  unearnedRevenue: process.env.ACCOUNT_CODE_UNEARNED_REVENUE || '2400',
  cash: process.env.ACCOUNT_CODE_CASH || '1000',
  projectRevenue: process.env.ACCOUNT_CODE_PROJECT_REVENUE || '4000',
  fixedAssets: process.env.ACCOUNT_CODE_FIXED_ASSETS || '1500',
  accountsPayable: process.env.ACCOUNT_CODE_ACCOUNTS_PAYABLE || '2000',
  capital: process.env.ACCOUNT_CODE_CAPITAL || '3000',
};

// sourceType used on the JournalEntry.sourceId idempotency index for project-creation entries -
// kept as an exported constant so the controller/service and any future admin tooling agree on
// the exact string.
exports.JournalEntrySourceTypes = {
  PROJECT_CREATION: 'PROJECT_CREATION',
  FIXED_ASSET_PURCHASE: 'FIXED_ASSET_PURCHASE',
  MANUAL: 'MANUAL',
};
