/**
 * Vendor payment accounts (client requirement "Vendors - Multiple Bank Accounts, InstaPay Accounts,
 * and Wallets" - the vendor's settlement instructions): any number of accounts per vendor, of any
 * of the three types, several of the same type allowed. Pure, DB-free - shared by the vendor
 * request validators (create/update), the Vendor model backstop, the vendor CSV import and the
 * migration of the old single `paymentInfo` (scripts/migrateVendorPaymentAccounts.js).
 *
 * Account shape (only the fields of its own type are kept):
 *   { _id?, type: 'bank', label?, isPrimary, isActive, bank: { bankName, accountHolderName, accountNumber, iban, swiftCode } }
 *   { _id?, type: 'instapay', label?, isPrimary, isActive, instapay: { identifier } }
 *   { _id?, type: 'wallet', label?, isPrimary, isActive, wallet: { provider, identifier } }
 *
 * Rules: a bank account needs a bank name and an account number or IBAN; InstaPay an identifier;
 * a wallet a provider and an identifier. The same account cannot be listed twice. Exactly one ACTIVE
 * account is the primary (default) one whenever any active account exists - if none is marked, the
 * first active one becomes primary. The vendor's legacy single `paymentInfo` is derived from the
 * primary account, so every existing reader of it keeps showing the vendor's default account.
 *
 * These are the vendor's RECEIVING details - never the company's own Chart-of-Accounts cash/bank
 * account a payment is recorded from (Payment.paymentAccount).
 */

const { EGYPTIAN_IBAN_REGEX, SWIFT_CODE_REGEX, WalletProviders } = require('../models/shared/businessPartnerSchemas');

const PaymentAccountTypes = ['bank', 'instapay', 'wallet'];
const MAX_ACCOUNTS = 30;

const str = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** The identity of an account (what makes two entries "the same account"). */
function accountKey(a) {
  if (a.type === 'bank') return `bank|${(a.bank.iban || '').toUpperCase() || a.bank.accountNumber}`;
  if (a.type === 'instapay') return `instapay|${a.instapay.identifier.toLowerCase()}`;
  return `wallet|${a.wallet.provider}|${a.wallet.identifier}`;
}

/** Shows the last 4 characters only - for snapshots on payment records and compact labels. */
function maskTail(value) {
  const s = str(value);
  if (!s) return '';
  return s.length <= 4 ? s : `****${s.slice(-4)}`;
}

/** A short, masked description of an account, e.g. "Bank - Banque Misr ****3456". */
function describeAccount(a) {
  if (!a) return '';
  if (a.type === 'bank') return `Bank - ${a.bank?.bankName || ''} ${maskTail(a.bank?.iban || a.bank?.accountNumber)}`.trim();
  if (a.type === 'instapay') return `InstaPay - ${maskTail(a.instapay?.identifier)}`;
  return `Wallet (${a.wallet?.provider || ''}) - ${maskTail(a.wallet?.identifier)}`;
}

/**
 * Validates and normalizes a list of accounts. Returns { accounts, error }: on error, accounts is
 * null and error names the account (1-based) and the problem.
 */
function normalizeVendorPaymentAccounts(input) {
  if (input == null) return { accounts: [], error: null };
  if (!Array.isArray(input)) return { accounts: null, error: 'Payment accounts must be a list.' };
  if (input.length > MAX_ACCOUNTS) return { accounts: null, error: `A vendor can have at most ${MAX_ACCOUNTS} payment accounts.` };

  const accounts = [];
  const seen = new Set();
  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i] || {};
    const label = `Payment account ${i + 1}`;
    if (!PaymentAccountTypes.includes(raw.type)) return { accounts: null, error: `${label}: type must be bank, instapay or wallet.` };
    const account = {
      ...(raw._id ? { _id: raw._id } : {}),
      type: raw.type,
      label: str(raw.label).slice(0, 100) || undefined,
      isPrimary: raw.isPrimary === true,
      isActive: raw.isActive !== false,
    };
    if (raw.type === 'bank') {
      const b = raw.bank || {};
      account.bank = {
        bankName: str(b.bankName),
        accountHolderName: str(b.accountHolderName) || undefined,
        accountNumber: str(b.accountNumber) || undefined,
        iban: str(b.iban).toUpperCase() || undefined,
        swiftCode: str(b.swiftCode).toUpperCase() || undefined,
      };
      if (!account.bank.bankName) return { accounts: null, error: `${label}: the bank name is required.` };
      if (!account.bank.accountNumber && !account.bank.iban) return { accounts: null, error: `${label}: an account number or IBAN is required.` };
      if (account.bank.iban && !EGYPTIAN_IBAN_REGEX.test(account.bank.iban)) return { accounts: null, error: `${label}: the IBAN must be a valid Egyptian IBAN (starts with EG, 29 characters).` };
      if (account.bank.swiftCode && !SWIFT_CODE_REGEX.test(account.bank.swiftCode)) return { accounts: null, error: `${label}: the SWIFT/BIC code is not valid.` };
      if ([account.bank.bankName, account.bank.accountHolderName].some(v => v && v.length > 100) || (account.bank.accountNumber || '').length > 50) {
        return { accounts: null, error: `${label}: a bank field is too long (names 100, account number 50 characters).` };
      }
    } else if (raw.type === 'instapay') {
      account.instapay = { identifier: str(raw.instapay?.identifier) };
      if (!account.instapay.identifier) return { accounts: null, error: `${label}: the InstaPay identifier (address / mobile) is required.` };
      if (account.instapay.identifier.length > 100) return { accounts: null, error: `${label}: the InstaPay identifier cannot exceed 100 characters.` };
    } else {
      account.wallet = { provider: str(raw.wallet?.provider), identifier: str(raw.wallet?.identifier) };
      if (!WalletProviders.includes(account.wallet.provider)) return { accounts: null, error: `${label}: the wallet provider must be one of ${WalletProviders.join(', ')}.` };
      if (!account.wallet.identifier) return { accounts: null, error: `${label}: the wallet number is required.` };
      if (account.wallet.identifier.length > 100) return { accounts: null, error: `${label}: the wallet number cannot exceed 100 characters.` };
    }
    const key = accountKey(account);
    if (seen.has(key)) return { accounts: null, error: `${label}: the same account is listed twice.` };
    seen.add(key);
    accounts.push(account);
  }

  // Exactly one active primary account.
  const primaries = accounts.filter(a => a.isPrimary && a.isActive);
  if (primaries.length > 1) return { accounts: null, error: 'Only one payment account can be the primary (default) account.' };
  accounts.forEach(a => {
    if (!a.isActive) a.isPrimary = false;
  });
  if (primaries.length === 0) {
    const firstActive = accounts.find(a => a.isActive);
    if (firstActive) firstActive.isPrimary = true;
  }
  return { accounts, error: null };
}

/** The legacy single `paymentInfo` (businessPartnerSchemas.js) for a vendor's primary account. */
function paymentInfoFromAccounts(accounts) {
  const primary = (accounts || []).find(a => a.isPrimary && a.isActive !== false);
  if (!primary) return { mode: null };
  if (primary.type === 'bank') return { mode: 'bank', bank: { ...primary.bank } };
  if (primary.type === 'instapay') return { mode: 'instapay', instapay: { ...primary.instapay } };
  return { mode: 'wallet', wallet: { ...primary.wallet } };
}

/**
 * Accounts for a vendor that only has the old single `paymentInfo` (and/or the older `bankInfo`):
 * every filled-in method becomes an account; the one `paymentInfo.mode` selected is primary.
 * Used by the migration and as a read-time fallback.
 */
function accountsFromLegacy({ paymentInfo, bankInfo } = {}) {
  const candidates = [];
  const pi = paymentInfo || {};
  const bank = pi.bank || {};
  if (bank.bankName && (bank.accountNumber || bank.iban)) candidates.push({ type: 'bank', isPrimary: pi.mode === 'bank', bank });
  if (pi.instapay?.identifier) candidates.push({ type: 'instapay', isPrimary: pi.mode === 'instapay', instapay: pi.instapay });
  if (pi.wallet?.provider && pi.wallet?.identifier) candidates.push({ type: 'wallet', isPrimary: pi.mode === 'wallet', wallet: pi.wallet });
  const bi = bankInfo || {};
  const legacyBank = { bankName: bi.bankName, accountHolderName: bi.accountHolderName || bi.accountName, accountNumber: bi.accountNumber, iban: bi.iban, swiftCode: bi.swiftCode };
  if (legacyBank.bankName && (legacyBank.accountNumber || legacyBank.iban)) candidates.push({ type: 'bank', isPrimary: false, bank: legacyBank });

  // Drop exact duplicates (bankInfo was copied into paymentInfo.bank by an earlier migration).
  const unique = [];
  const keys = new Set();
  for (const c of candidates) {
    const { accounts } = normalizeVendorPaymentAccounts([c]);
    if (!accounts) continue; // an invalid legacy value is skipped (reported by the migration)
    const key = accountKey(accounts[0]);
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push({ ...accounts[0], isPrimary: c.isPrimary });
  }
  return normalizeVendorPaymentAccounts(unique).accounts || [];
}

module.exports = {
  PaymentAccountTypes,
  normalizeVendorPaymentAccounts,
  paymentInfoFromAccounts,
  accountsFromLegacy,
  describeAccount,
  maskTail,
};
