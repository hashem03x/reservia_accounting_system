const mongoose = require('mongoose');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const ApiError = require('../../utils/apiError');
const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');

// Sub Accounts on manual journal lines. A Sub Account is the existing party reference on a line -
// `partyType` + `partyNumber` (a Customer Number, Vendor Number or Shareholder Number), the same
// fields every automatic entry already stamps - never a parallel model.
//
//   - customer control accounts (Accounts Receivable - Projects, Advances from Customers) require a
//     customer; vendor control accounts (Suppliers, Advances to Suppliers) require a vendor;
//   - equity accounts accept a shareholder;
//   - any other account may carry a sub-account (it is optional there), but never one of the
//     wrong kind for a control account, and never a number that does not exist.

const CUSTOMER_CONTROL_CODES = [AutomaticJournalAccountCodes.accountsReceivableProjects, AutomaticJournalAccountCodes.customerAdvancesPayable];
const VENDOR_CONTROL_CODES = [AutomaticJournalAccountCodes.suppliers, AutomaticJournalAccountCodes.advanceToSuppliers];
const TYPE_LABELS = { customer: 'customer', vendor: 'vendor', shareholder: 'shareholder' };

/** The sub-account kind an account requires ('customer' | 'vendor'), or null. */
function requiredPartyTypeOf(account) {
  if (!account) return null;
  if (CUSTOMER_CONTROL_CODES.includes(account.code)) return 'customer';
  if (VENDOR_CONTROL_CODES.includes(account.code)) return 'vendor';
  return null;
}

/** For the Journal Entry form: the accounts that require a customer / vendor sub-account. */
async function lineRules() {
  const accounts = await ChartOfAccount.find({ code: { $in: [...CUSTOMER_CONTROL_CODES, ...VENDOR_CONTROL_CODES] } })
    .select('code')
    .lean();
  return {
    customerAccounts: accounts.filter(a => requiredPartyTypeOf(a) === 'customer').map(a => String(a._id)),
    vendorAccounts: accounts.filter(a => requiredPartyTypeOf(a) === 'vendor').map(a => String(a._id)),
  };
}

const idOf = ref => String(ref?._id || ref);

/** Throws a 400 for the first manual line whose Sub Account is missing, of the wrong kind or unknown. */
async function validateLineParties(lines, session) {
  const accountIds = [...new Set(lines.map(l => idOf(l.account)))].filter(id => mongoose.Types.ObjectId.isValid(id));
  const accounts = await ChartOfAccount.find({ _id: { $in: accountIds } }).select('code name type').session(session || null).lean();
  const accountById = new Map(accounts.map(a => [String(a._id), a]));

  const wanted = { customer: new Set(), vendor: new Set(), shareholder: new Set() };
  lines.forEach((line, index) => {
    const account = accountById.get(idOf(line.account));
    const label = `Journal line ${index + 1}${account ? ` (${account.code} - ${account.name})` : ''}`;
    const required = requiredPartyTypeOf(account);
    const hasNumber = line.partyNumber !== null && line.partyNumber !== undefined && line.partyNumber !== '';
    if (!hasNumber && line.partyType) throw new ApiError(`${label}: select the ${TYPE_LABELS[line.partyType] || 'sub-account'} for the sub-account.`, 400);
    if (!hasNumber) {
      if (required) throw new ApiError(`${label}: this account requires a ${required} sub-account.`, 400);
      return;
    }
    if (!Number.isInteger(Number(line.partyNumber))) throw new ApiError(`${label}: invalid sub-account number.`, 400);
    if (!TYPE_LABELS[line.partyType]) throw new ApiError(`${label}: the sub-account type is required.`, 400);
    if (required && line.partyType !== required) throw new ApiError(`${label}: this account requires a ${required} sub-account, not a ${line.partyType}.`, 400);
    if (line.partyType === 'shareholder' && account && account.type !== 'equity') throw new ApiError(`${label}: a shareholder sub-account can only be used on an equity account.`, 400);
    wanted[line.partyType].add(Number(line.partyNumber));
  });

  // Raw collections (users / vendors / shareholders) - independent of which models are loaded.
  const lookups = [
    ['customer', 'users', 'customerNumber'],
    ['vendor', 'vendors', 'vendorNumber'],
    ['shareholder', 'shareholders', 'shareholderNumber'],
  ];
  for (const [type, collection, field] of lookups) {
    const numbers = [...wanted[type]];
    if (numbers.length) {
      // eslint-disable-next-line no-await-in-loop
      const found = await mongoose.connection.collection(collection).find({ [field]: { $in: numbers } }, { projection: { [field]: 1 }, session: session || undefined }).toArray();
      const existing = new Set(found.map(f => f[field]));
      const missing = numbers.find(n => !existing.has(n));
      if (missing !== undefined) throw new ApiError(`The ${type} sub-account number ${missing} does not exist.`, 400);
    }
  }
}

module.exports = { requiredPartyTypeOf, lineRules, validateLineParties, CUSTOMER_CONTROL_CODES, VENDOR_CONTROL_CODES };
