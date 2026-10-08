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
// 'cash'/'cash-equivalent' additionally double as ONE of the two structural signals for "can this
// account be used as a Payment Method" - see `isPaymentAccountEligible` below.
exports.AccountStates = ['current', 'non-current', 'operating', 'non-operating', 'direct', 'indirect', 'cash', 'cash-equivalent', 'other'];

// The CSV-imported Chart of Accounts' own group label for every real bank/cash account (see
// scripts/importReversiaAccountingData.js) - e.g. "misr banque", "NBE", "Bank Cairo" all carry
// `parentGroupNameEn: 'Cash & Cash Equivalents'`. This is the ONLY signal imported accounts
// actually carry (none of them have `state` set - that field is populated only when an admin
// explicitly classifies an account via the Edit Account screen, which nobody has done on the real
// data yet). Kept as a named constant (not a literal re-typed at every call site) so the one place
// this exact string is compared never drifts out of sync with itself.
exports.CashEquivalentParentGroupName = 'Cash & Cash Equivalents';

// Single source of truth for "is this ChartOfAccount document eligible to be selected as a Payment
// Method" (Sales/Purchase Orders, Payments, Advanced Payments - docs section "Payment Methods Must
// Come From Chart of Accounts"). An account qualifies via EITHER of two independent signals:
//   1. `parentGroupNameEn === 'Cash & Cash Equivalents'` - the real, already-populated signal every
//      imported bank/cash account actually carries today.
//   2. `type === 'asset' && state in ['cash', 'cash-equivalent']` - the explicit, admin-assigned
//      classification path (see AccountStates above) for any account the CSV import didn't cover,
//      e.g. a new cash/bank account created later through the app's own Create Account screen,
//      which has no `parentGroupNameEn` (that field is only ever set by the CSV import).
// Every consumer (the `accounts/cash-equivalent-eligible` list endpoint, every model's own
// pre-save backstop, every request validator's fast pre-check) calls this one function - never
// its own copy of the condition - so the dropdown and the backend validation can never disagree.
exports.isPaymentAccountEligible = function isPaymentAccountEligible(account) {
  if (!account) return false;
  if (account.type !== 'asset') return false;
  if (account.parentGroupNameEn === exports.CashEquivalentParentGroupName) return true;
  return ['cash', 'cash-equivalent'].includes(account.state);
};

// Single source of truth for "can this ChartOfAccount document be a Service's PUC Account"
// (Product.pucAccount - the Projects-Under-Construction / WIP account a Service purchase posts to,
// see accountingEventService.js#postPurchaseOrderJournalEntries, PO_SERVICE_TO_WIP). PUC accounts
// are balance-sheet WIP assets, so eligibility is structural: an active `asset` account that is not
// a Cash/Cash-Equivalent (payment) account. Never a hardcoded code list and never a name match -
// the admin picks the exact PUC account when creating/editing the Service. Used by the eligible-
// accounts endpoint, the product validator and the Product model backstop alike.
exports.isPucAccountEligible = function isPucAccountEligible(account) {
  if (!account) return false;
  if (account.isActive === false) return false;
  if (account.type !== 'asset') return false;
  return !exports.isPaymentAccountEligible(account);
};

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
  // Cost Recognition of a Sales Order: Dr COGS / Cr Materials Inventory for the project's
  // accumulated Executed % x the order's Cost of Items, fixed at the order's creation.
  'SO_COST_RECOGNITION',
  // A later Add Payment (not the order's own creation) funded from an Advanced Payment instead of
  // a Cash/Cash-Equivalent account (docs section "Add Payment - Advanced Payment") - kept distinct
  // from SO_CUSTOMER_ADVANCE_APPLIED/PO_SUPPLIER_ADVANCE_APPLIED so the idempotency key (sourceType
  // 'PAYMENT', not 'SO'/'PO') never collides with that order's own advance-applied entry.
  'PAYMENT_CUSTOMER_ADVANCE_APPLIED',
  'PAYMENT_VENDOR_ADVANCE_APPLIED',
  'PROJECT_REVENUE_RECOGNITION',
  // No longer posted (the COGS -> WIP cost recognition was removed). Kept so journal entries
  // already stored with this action stay valid - Mongoose re-validates enums on every save, e.g.
  // when such an entry is reversed.
  'PROJECT_COST_RECOGNITION',
];

// Automatic actions that are inherently project-related: they are only ever posted for a document
// that must have a project (every new Purchase/Sales Order requires one, and recognition is per
// project), so postAutomaticJournalEntry refuses to post them without one. Payment and Advanced
// Payment actions are NOT listed - a payment against a legacy project-less order, or an advance not
// yet tied to a project, legitimately has none; when they DO have one, every line still gets it.
exports.ProjectRequiredAccountingActions = [
  'PO_INVENTORY_RECEIPT',
  'PO_INVENTORY_TO_WIP',
  'PO_SERVICE_TO_WIP',
  'PO_SUPPLIER_ADVANCE_APPLIED',
  'SO_CUSTOMER_ADVANCE_APPLIED',
  'SO_COST_RECOGNITION',
  'PROJECT_REVENUE_RECOGNITION',
];

// The business-document type that triggered an automatic entry - paired with sourceId (that
// document's _id) and accountingAction to form the full idempotency key (see
// journalEntryModel.js's compound unique index). Distinct from JournalEntrySourceTypes below,
// which is the older (pre-existing) idempotency-key vocabulary for the two legacy automatic flows
// (project creation, fixed asset purchase) - kept separate rather than merged, since those two
// still only ever produce exactly one JE each and don't need an `accountingAction` to disambiguate.
exports.AccountingSourceTypes = ['ADVANCED_PAYMENT', 'PO', 'SO', 'PAYMENT', 'PROJECT'];

exports.ProjectStatuses = ['active', 'completed', 'cancelled', 'on_hold'];

// Project Sectors are admin-managed records now (models/project/sectorModel.js, Admin -> Sectors).
// These are the two values that used to be the hardcoded list - used ONLY by
// scripts/seedSectors.js to create matching Sector records, so existing options and projects keep
// working. Never used to validate a project's sector.
exports.DefaultProjectSectors = ['Villa', 'Industrials'];

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
  costRawMaterials: '50000001', // Raw Materials (cost)
  costLabourWages: '50000002', // Labour Wages (cost)
  costEngineeringDesign: '50000003', // Engineering & Design (cost)
};

// Sales Order Cost Recognition (SO_COST_RECOGNITION = JV0011 of "AUTOMATIC ENTERIES.xlsx"): the
// project is charged with its costs at the executed share of the contract - Dr each WIP (PUC)
// account / Cr its matching cost account, one pair per cost category, exactly as the sheet lists
// them. Products are raw materials (11000009); a service is charged to its own PUC account
// (Product.pucAccount) and so must be one of these WIP accounts.
exports.CostRecognitionAccountPairs = {
  [exports.AutomaticJournalAccountCodes.wipRawMaterials]: exports.AutomaticJournalAccountCodes.costRawMaterials,
  [exports.AutomaticJournalAccountCodes.wipEngineeringDesign]: exports.AutomaticJournalAccountCodes.costEngineeringDesign,
  [exports.AutomaticJournalAccountCodes.wipLabourWages]: exports.AutomaticJournalAccountCodes.costLabourWages,
};

// Main descriptions of the Sales Order automatic entries, taken verbatim from the sheet (every line
// stores the same description - see journalEntryModel.js).
exports.SalesOrderJournalDescriptions = {
  revenue: 'تنفيذ جزء من العقد للعميل', // JV0010
  costRecognition: 'تحميل المشروع بالتكاليف بنسبة المنفذ من العقد', // JV0011
};

// The originating business module of a journal entry - a NEW, dedicated "Module" column/field
// (docs section "Module field") distinct from `sourceType` (SO/PO/PAYMENT/ADVANCED_PAYMENT/PROJECT
// are internal idempotency-key vocabulary, not a display label). Normalized through this one map
// so an automatic entry's module can never drift into inconsistent casing/spelling. 'Manual' is
// the default for every hand-entered journal entry (source: 'manual'); the two legacy automatic
// flows (project_creation, fixed_asset_purchase) keep their own plain labels for the same reason.
exports.AccountingModules = ['Advanced Payment', 'Purchase Order', 'Sales Order', 'Payment', 'Manual', 'Fixed Asset', 'Project'];

// accountingAction -> Module label. Deliberately keyed by accountingAction (not sourceType) -
// PO_PAYMENT_RECORDED/SO_PAYMENT_RECORDED both carry `sourceType: 'PAYMENT'` but their real business
// module is Purchase Order / Sales Order respectively (matching the reference accounting table's
// own Module column); PROJECT_REVENUE_RECOGNITION/PROJECT_COST_RECOGNITION carry `sourceType:
// 'PROJECT'` but are themselves triggered by a Sales Order's contribution to executedPercentage, so
// the reference table itself labels them "Sales Order", not "Project".
exports.AccountingModuleByAction = {
  ADVANCE_PAYMENT_RECEIVED_CUSTOMER: 'Advanced Payment',
  ADVANCE_PAYMENT_PAID_VENDOR: 'Advanced Payment',
  PO_INVENTORY_RECEIPT: 'Purchase Order',
  PO_INVENTORY_TO_WIP: 'Purchase Order',
  PO_SERVICE_TO_WIP: 'Purchase Order',
  PO_SUPPLIER_ADVANCE_APPLIED: 'Purchase Order',
  PO_PAYMENT_RECORDED: 'Purchase Order',
  SO_CUSTOMER_ADVANCE_APPLIED: 'Sales Order',
  SO_PAYMENT_RECORDED: 'Sales Order',
  SO_COST_RECOGNITION: 'Sales Order',
  PAYMENT_CUSTOMER_ADVANCE_APPLIED: 'Payment',
  PAYMENT_VENDOR_ADVANCE_APPLIED: 'Payment',
  PROJECT_REVENUE_RECOGNITION: 'Sales Order',
  PROJECT_COST_RECOGNITION: 'Sales Order',
};
