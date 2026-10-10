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

module.exports = { pucAccountsOf, rawMaterialsPucAccount, WIP_CODES };
