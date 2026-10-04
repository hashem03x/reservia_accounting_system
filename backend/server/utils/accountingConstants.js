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
// 'cash'/'cash-equivalent' additionally double as the structural signal for "can this account be
// used as a Payment Method" (see chartOfAccountController.js#getCashEquivalentAccounts) - an
// asset-type account with one of these two states, nothing else. Reuses this same secondary-
// classification mechanism rather than adding a separate boolean flag, for the same reason 'cogs'
// reuses `type` instead of a name match against "COGS": a real account whose own classification
// (set once, by an admin, via the existing Edit Account screen) drives eligibility everywhere,
// never a label/name string compared at read time.
exports.AccountStates = ['current', 'non-current', 'operating', 'non-operating', 'direct', 'indirect', 'cash', 'cash-equivalent', 'other'];

exports.JournalEntryStatus = ['draft', 'posted', 'reversed'];

// "source" identifies what business event produced a journal entry. `manual` covers everything an
// accountant enters by hand via the Journal Entries UI (the only source new entries use today -
// automatic journal-entry creation on project creation was removed, see
// docs/entities/projects.md). `project_creation` is kept in this list (not removed) purely so any
// pre-existing journal entries created by that now-removed automatic flow remain valid on save -
// Mongoose re-validates every enum path on save, including unmodified ones, so removing a value
// still in use by historical documents would break something as unrelated as reversing one of
// them. `fixed_asset_purchase` is still actively used by the optional fixed-asset journal entry.
// 'automatic' is for the automatic accounting engine (see services/accounting/accountingEventService.js)
// - system-generated entries triggered by a real business event (an Advanced Payment, a Purchase/
// Sales Order, a Payment, a Project's executed-percentage update), never typed by hand through the
// Journal Entries form. Kept distinct from 'manual' specifically so the mandatory-project rule
// (journalEntryModel.js RULE 2, scoped to `source === 'manual'`) never applies to these - most of
// them legitimately have no project (e.g. a customer advance payment not yet tied to one).
exports.JournalEntrySources = ['manual', 'project_creation', 'fixed_asset_purchase', 'automatic'];

// Every distinct automatic accounting action the engine can post - see
// services/accounting/accountingEventService.js and docs/entities/automatic-accounting.md for the
// full Business Event -> Accounting Action -> Journal Entry mapping (derived from
// "AUTOMATIC ENTERIES.xlsx"). A single business event may resolve to MORE than one of these (e.g.
// a Purchase Order receipt resolves to both PO_INVENTORY_RECEIPT and PO_INVENTORY_TO_WIP) - each
// one is its own independent JournalEntry, identified by (sourceType, sourceId, accountingAction).
exports.AccountingActions = [
  'ADVANCE_PAYMENT_RECEIVED_CUSTOMER',
  'ADVANCE_PAYMENT_PAID_VENDOR',
  'PO_INVENTORY_RECEIPT',
  'PO_INVENTORY_TO_WIP',
  'PO_SERVICE_TO_WIP',
  'PO_SUPPLIER_ADVANCE_APPLIED',
  'PO_PAYMENT_RECORDED',
  'SO_CUSTOMER_ADVANCE_APPLIED',
  'SO_PAYMENT_RECORDED',
  'PROJECT_REVENUE_RECOGNITION',
  'PROJECT_COST_RECOGNITION',
];

// The business-document type that triggered an automatic entry - paired with sourceId (that
// document's _id) and accountingAction to form the full idempotency key (see
// journalEntryModel.js's compound unique index). Distinct from JournalEntrySourceTypes below,
// which is the older (pre-existing) idempotency-key vocabulary for the two legacy automatic flows
// (project creation, fixed asset purchase) - kept separate rather than merged, since those two
// still only ever produce exactly one JE each and don't need an `accountingAction` to disambiguate.
exports.AccountingSourceTypes = ['ADVANCED_PAYMENT', 'PO', 'SO', 'PAYMENT', 'PROJECT'];

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

// Real account codes (from the actual imported Chart of Accounts - see
// scripts/importReversiaAccountingData.js) the automatic accounting engine posts to. Deliberately
// NOT reusing DefaultAccountCodes above - that map predates the CSV import and still holds
// placeholder codes (e.g. '1100') that don't match any real imported account. Three of these
// (suppliers, accountsReceivableProjects, revenue) were confirmed against the actual Chart of
// Accounts after the source "AUTOMATIC ENTERIES.xlsx" was found to reference the wrong codes for
// them (30000001, 11000011, 40000001 respectively - each an existing, unrelated real account) -
// see the mapping doc for the full conflict writeup.
exports.AutomaticJournalAccountCodes = {
  customerAdvancesPayable: '31000004', // Advance Payments from Customers (liability)
  advanceToSuppliers: '11000006', // Advance Payments to Suppliers (asset)
  materialsInventory: '11000007', // Materials Inventory (asset)
  inputVat: '11000017', // Egyptian Tax Authority - VAT (asset, input VAT receivable)
  suppliers: '31000001', // Suppliers - Construction Materials (liability) - NOT 30000001
  withholdingTaxPayable: '31000012', // Withholding Taxes Payable (liability)
  wipRawMaterials: '11000009', // PUC - Raw Materials (asset)
  wipLabourWages: '11000010', // PUC - Labour Wages (asset)
  wipEngineeringDesign: '11000011', // PUC - Engineering & Design (asset)
  accountsReceivableProjects: '11000004', // Accounts Receivable (Projects) (asset) - NOT 11000011
  withholdingTaxReceivable: '11000019', // Egyptian Tax Authority - Withholding & Addition (asset)
  vatPayable: '31000010', // VAT Payable (liability)
  revenue: '60000001', // Revenue (revenue) - generic, until a dedicated project-execution-revenue account exists
};

// Maps each `cogs`-type Chart of Accounts code to its corresponding Projects-Under-Construction
// (WIP) account code, for PROJECT_COST_RECOGNITION (Dr cogs account / Cr matching WIP account, per
// Project.averageCostLines). Code-based, not name-matched (see this file's AccountTypes comment
// above for why this codebase avoids string-matching display names for structural decisions).
// Only 3 pairs exist in the current Chart of Accounts - extend this map if more COGS/WIP account
// pairs are added later.
exports.CogsToWipAccountCodeMap = {
  '50000001': '11000009', // Raw Materials -> PUC Raw Materials
  '50000002': '11000010', // Labour Wages -> PUC Labour Wages
  '50000003': '11000011', // Engineering & Design -> PUC Engineering & Design
};
