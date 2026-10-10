const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { AutomaticJournalAccountCodes, isPaymentAccountEligible } = require('../../utils/accountingConstants');

// PUC (Projects Under Construction / project WIP) accounts, from the Chart of Accounts - the same
// accounts the automatic entries already use for project costs:
//   - the WIP accounts the engine posts to (PUC - Raw Materials / Labour Wages / Engineering &
//     Design: AutomaticJournalAccountCodes.wip*),
//   - every account a Service uses as its PUC account (Product.pucAccount, PO_SERVICE_TO_WIP),
//   - and any other non-cash asset account named or grouped as PUC / Projects Under Construction
//     ("مشروعات تحت التنفيذ"), e.g. the PUC accounts project cost recognition (JV0011) credits.
// A project's PUC balance is the ledger balance of these accounts on lines tagged with the project.

const PUC_NAME = /\bpuc\b|projects?\s+under\s+(construction|execution)|تحت\s+التنفيذ|تحت\s+الإنشاء/i;
const WIP_CODES = [AutomaticJournalAccountCodes.wipRawMaterials, AutomaticJournalAccountCodes.wipLabourWages, AutomaticJournalAccountCodes.wipEngineeringDesign];

const looksLikePuc = account =>
  [account.name, account.nameAr, account.parentGroupNameEn, account.parentGroupNameAr, account.parentAccount?.name, account.parentAccount?.nameAr].some(text => text && PUC_NAME.test(text));

/** PUC accounts among `accounts` (Map id -> account, e.g. reportCommon.loadAccounts()). */
async function pucAccountsOf(accounts) {
  // eslint-disable-next-line global-require
  const Product = require('../../models/inventory/productModel');
  const servicePuc = new Set((await Product.collection.distinct('pucAccount', { pucAccount: { $ne: null } })).map(String));
  return [...accounts.values()].filter(account => {
    if (account.type !== 'asset' || isPaymentAccountEligible(account)) return false;
    return WIP_CODES.includes(account.code) || servicePuc.has(String(account._id)) || looksLikePuc(account);
  });
}

/** The PUC - Raw Materials account, where materials issued to a project are carried. */
async function rawMaterialsPucAccount(session) {
  return ChartOfAccount.findOne({ code: AutomaticJournalAccountCodes.wipRawMaterials }).session(session || null).lean();
}

// PUC cost categories. The engine's own WIP accounts map by their configured code; any other PUC
// account by its Chart of Accounts name / group (English or Arabic). An account that matches none is
// "Other Project Costs" - so every PUC line has exactly one category and nothing is left out. To add
// or re-map a category, change this table.
const PUC_CATEGORIES = [
  { key: 'materials', title: { en: 'Materials', ar: 'مواد' }, codes: [AutomaticJournalAccountCodes.wipRawMaterials], pattern: /material|raw|مواد|خام/i },
  { key: 'labor', title: { en: 'Labor', ar: 'عمالة' }, codes: [AutomaticJournalAccountCodes.wipLabourWages], pattern: /labou?r|wage|salar|أجور|اجور|عمال/i },
  { key: 'design', title: { en: 'Designs and Engineering', ar: 'التصميمات والهندسة' }, codes: [AutomaticJournalAccountCodes.wipEngineeringDesign], pattern: /design|engineer|تصميم|هندس/i },
  { key: 'equipment', title: { en: 'Equipment', ar: 'معدات' }, codes: [], pattern: /equipment|machine|معدات|آلات|الات/i },
  { key: 'subcontractors', title: { en: 'Subcontractors', ar: 'مقاولو الباطن' }, codes: [], pattern: /sub-?contract|مقاول/i },
  { key: 'services', title: { en: 'Services', ar: 'خدمات' }, codes: [], pattern: /service|خدم/i },
  { key: 'other', title: { en: 'Other Project Costs', ar: 'تكاليف أخرى للمشروع' }, codes: [], pattern: null },
];

/** The PUC category of a PUC account: by configured code first, then by its own name, then its group. */
function pucCategoryOf(account) {
  if (!account) return PUC_CATEGORIES[PUC_CATEGORIES.length - 1];
  const byCode = PUC_CATEGORIES.find(c => c.codes.includes(account.code));
  if (byCode) return byCode;
  // The name after "PUC - " / "مشروعات تحت التنفيذ - " is what distinguishes the account.
  const own = [account.name, account.nameAr].filter(Boolean).map(n => n.split(/\s[-–]\s/).pop()).join(' ');
  const group = [account.parentGroupNameEn, account.parentGroupNameAr].filter(Boolean).join(' ');
  return PUC_CATEGORIES.find(c => c.pattern && c.pattern.test(own)) || PUC_CATEGORIES.find(c => c.pattern && c.pattern.test(group)) || PUC_CATEGORIES[PUC_CATEGORIES.length - 1];
}

module.exports = { pucAccountsOf, rawMaterialsPucAccount, WIP_CODES, PUC_CATEGORIES, pucCategoryOf };
