// Shared enums/config for the new accounting foundation (Chart of Accounts, Journal Entries,
// Projects, Fixed Assets). Kept in one file, mirroring how appConstant.js centralizes the
// pre-existing Resources/Actions/PaymentMethods enums, rather than scattering string literals
// across models/controllers.

// 'cogs' is kept distinct from 'expense' rather than folded into it, mirroring the CSV accounting
// import's own source data (which distinguishes "Costs" from "Expenses" in its type column, see
// scripts/importReversiaAccountingData.js's TYPE_MAP) - this is what lets Project Average Cost
// eligibility be determined structurally from `type === 'cogs'` instead of string-matching a
// "COGS" display name (see services/project/averageCostEligibilityService.js).
exports.AccountTypes = ['asset', 'liability', 'equity', 'revenue', 'expense', 'cogs'];

// Secondary classification on top of `type` (e.g. an asset can additionally be Current/Non-Current,
// an expense can be Operating/Non-Operating or Direct/Indirect) - a single flat controlled list
// rather than a type-specific enum, since which states are "appropriate" for a given type is a
// business judgment call made when the account is created/edited, not a fixed mapping this schema
// should hard-code. Optional/nullable - imported CSV accounts never have a source value for this
// (the source file has no such column), so it stays null until an admin assigns one.
exports.AccountStates = ['current', 'non-current', 'operating', 'non-operating', 'direct', 'indirect', 'other'];

exports.JournalEntryStatus = ['draft', 'posted', 'reversed'];

// "source" identifies what business event produced a journal entry. `manual` covers everything an
// accountant enters by hand via the Journal Entries UI (the only source new entries use today -
// automatic journal-entry creation on project creation was removed, see
// docs/entities/projects.md). `project_creation` is kept in this list (not removed) purely so any
// pre-existing journal entries created by that now-removed automatic flow remain valid on save -
// Mongoose re-validates every enum path on save, including unmodified ones, so removing a value
// still in use by historical documents would break something as unrelated as reversing one of
// them. `fixed_asset_purchase` is still actively used by the optional fixed-asset journal entry.
exports.JournalEntrySources = ['manual', 'project_creation', 'fixed_asset_purchase'];

exports.ProjectStatuses = ['active', 'completed', 'cancelled', 'on_hold'];

// Centralized so a new sector is a one-line addition here (plus its mirror in
// frontend/src/utils/constants/accounting.ts), not a hardcoded string scattered across the model,
// validators, and every frontend form/table. `null` (no sector) stays valid for projects created
// before this field existed - see docs/entities/projects.md. Renamed from `ProjectDepartments`
// (the field itself was renamed `department` -> `sector`) - the values themselves (Villa,
// Industrials) are unchanged.
exports.ProjectSectors = ['Villa', 'Industrials'];

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
