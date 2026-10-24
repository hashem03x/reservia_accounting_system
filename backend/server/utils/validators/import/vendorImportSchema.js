const Vendor = require('../../../models/vendor/vendor');
const { isValidPhone } = require('../phoneValidator');
const { PaymentTerms } = require('../../paymentTerms');
const { EGYPTIAN_IBAN_REGEX, SWIFT_CODE_REGEX, PaymentModes, WalletProviders } = require('../../../models/shared/businessPartnerSchemas');
const { normalizeVendorPaymentAccounts } = require('../../vendorPaymentAccounts');

/**
 * AdditionalPaymentAccounts - any number of extra payment accounts in ONE cell, separated by ";",
 * each "type|field|field...":
 *   bank|BankName|AccountNumber|IBAN|SWIFT|AccountHolderName   (AccountNumber or IBAN required)
 *   instapay|Identifier
 *   wallet|Provider|WalletNumber                                (provider: vodafone_cash, orange_cash, etisalat_cash, we_pay, fawry, other)
 * Returns { accounts, error }.
 */
function parseAdditionalAccounts(cell) {
  const text = (cell || '').trim();
  if (!text) return { accounts: [], error: null };
  const accounts = [];
  const segments = text.split(';').map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < segments.length; i += 1) {
    const parts = segments[i].split('|').map(s => s.trim());
    const type = (parts[0] || '').toLowerCase();
    if (type === 'bank') accounts.push({ type, bank: { bankName: parts[1], accountNumber: parts[2], iban: parts[3], swiftCode: parts[4], accountHolderName: parts[5] } });
    else if (type === 'instapay') accounts.push({ type, instapay: { identifier: parts[1] } });
    else if (type === 'wallet') accounts.push({ type, wallet: { provider: (parts[1] || '').toLowerCase(), identifier: parts[2] } });
    else return { accounts: null, error: `Entry ${i + 1} ("${segments[i]}"): must start with bank|, instapay| or wallet|.` };
  }
  return { accounts, error: null };
}

// Vendor CSV import schema (docs section "Vendor CSV Import"). Mirrors the EXACT fields/rules of
// the real create path (controller/user/vendorController.js#createVendor = factory.createOne(Vendor),
// utils/validators/vendorValidators.js#createVendorValidators) - `createOne` below calls
// `Vendor.create()` directly (not `insertMany`), which already correctly triggers both the
// `pre('save')` AND the model's own `pre('insertMany')` vendorNumber-assignment hooks; `.create()`
// uses the former, so numbering is correct either way. Does NOT reproduce the previous importer's
// bugs: no `type` is no longer rejected (schema defaults to 'current', matching manual creation),
// the vendor name is never silently mutated, and taxInfo/bankInfo/paymentInfo/cashFlowActivity are
// no longer dropped.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Exactly vendorValidators.js's own regexes (createVendorValidators), written with the identical
// \u escapes (not retyped literal glyphs, which risk a silent mismatch across editors/encodings).
const NAME_REGEX = /^[a-zA-Z\s؀-ۿ\-–]+$/;
const LETTERS_REGEX = /^[a-zA-Zء-ي٠-٩\s]+$/;

exports.headers = [
  'Name',
  'Phone',
  'Email',
  'Type',
  'Balance',
  'Street',
  'City',
  'State',
  'Country',
  'PostalCode',
  'TaxRegistrationNumber',
  'CommercialRegistrationNumber',
  'PaymentTerms',
  'CustomPaymentDays',
  'PaymentMode',
  'InstapayIdentifier',
  'WalletProvider',
  'WalletIdentifier',
  'PaymentBankName',
  'PaymentBankAccountHolderName',
  'PaymentBankAccountNumber',
  'PaymentBankIBAN',
  'PaymentBankSwiftCode',
  'CashFlowActivity',
  'IsActive',
  'AdditionalPaymentAccounts',
];

exports.requiredHeaders = ['Name', 'Phone', 'Email'];

exports.exampleRow = [
  'Nile Supplies Co',
  '01123456789',
  'contact@nilesupplies.example.com',
  'current',
  '0',
  '45 Industrial Zone',
  'Giza',
  'Giza',
  'Egypt',
  '12577',
  '321-654-987',
  '456-789-123',
  'Net 30',
  '',
  'bank',
  '',
  '',
  '',
  'Banque Misr',
  'Nile Supplies Co',
  '9876543210123456',
  'EG380019000500000000263180099',
  'BMISEGCX',
  'operating',
  'true',
  'instapay|nilesupplies@instapay ; wallet|vodafone_cash|01012345678',
];

exports.fetchContext = async function fetchContext() {
  const existing = await Vendor.find({}).select('contact.phone contact.email').lean();
  return {
    existingPhones: new Set(existing.filter(v => v.contact?.phone).map(v => v.contact.phone.trim().toLowerCase())),
    existingEmails: new Set(existing.filter(v => v.contact?.email).map(v => v.contact.email.trim().toLowerCase())),
  };
};

function parseBoolean(raw) {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return undefined;
  return ['true', '1', 'yes'].includes(v);
}

exports.validateRow = async function validateRow(row, { existingPhones, existingEmails }) {
  const errors = [];

  const name = (row.Name || '').trim();
  const phone = (row.Phone || '').trim();
  const email = (row.Email || '').trim();
  const type = (row.Type || '').trim() || 'current';
  const balance = (row.Balance || '').trim();
  const city = (row.City || '').trim();
  const state = (row.State || '').trim();
  const country = (row.Country || '').trim();
  const postalCode = (row.PostalCode || '').trim();
  const paymentTerms = (row.PaymentTerms || '').trim();
  const customPaymentDays = (row.CustomPaymentDays || '').trim();
  const paymentMode = (row.PaymentMode || '').trim() || null;
  const walletProvider = (row.WalletProvider || '').trim() || null;
  const iban = (row.PaymentBankIBAN || '').trim().toUpperCase();
  const swiftCode = (row.PaymentBankSwiftCode || '').trim().toUpperCase();
  const cashFlowActivity = (row.CashFlowActivity || '').trim() || null;

  if (!name) {
    errors.push({ column: 'Name', value: row.Name, message: 'Name is required.' });
  } else if (name.length < 2 || name.length > 50) {
    errors.push({ column: 'Name', value: row.Name, message: 'Name must be between 2 and 50 characters.' });
  } else if (!NAME_REGEX.test(name)) {
    errors.push({ column: 'Name', value: row.Name, message: 'Name must only contain letters, spaces and hyphens.' });
  }

  if (!phone) {
    errors.push({ column: 'Phone', value: row.Phone, message: 'Phone is required.' });
  } else if (!isValidPhone(phone)) {
    errors.push({ column: 'Phone', value: row.Phone, message: 'Not a valid Egyptian or international phone number.', suggestion: 'Use a format like 01012345678 or +201012345678.' });
  } else if (existingPhones.has(phone.toLowerCase())) {
    errors.push({ column: 'Phone', value: row.Phone, message: 'A vendor with this phone number already exists.' });
  }

  if (!email) {
    errors.push({ column: 'Email', value: row.Email, message: 'Email is required.' });
  } else if (!EMAIL_REGEX.test(email)) {
    errors.push({ column: 'Email', value: row.Email, message: 'Not a valid email address.' });
  } else if (existingEmails.has(email.toLowerCase())) {
    errors.push({ column: 'Email', value: row.Email, message: 'A vendor with this email already exists.' });
  }

  if (!['current', 'equity'].includes(type)) {
    errors.push({ column: 'Type', value: row.Type, message: 'Must be "current" or "equity".' });
  }

  if (balance && (Number.isNaN(Number(balance)) || Number(balance) < 0)) {
    errors.push({ column: 'Balance', value: row.Balance, message: 'Balance must be a non-negative number.' });
  }

  if (city && !LETTERS_REGEX.test(city)) errors.push({ column: 'City', value: row.City, message: 'City must only contain letters and spaces.' });
  if (state && !LETTERS_REGEX.test(state)) errors.push({ column: 'State', value: row.State, message: 'State must only contain letters and spaces.' });
  if (country && !LETTERS_REGEX.test(country)) errors.push({ column: 'Country', value: row.Country, message: 'Country must only contain letters and spaces.' });
  if (postalCode && !/^\d{5}(-\d{4})?$/.test(postalCode)) {
    errors.push({ column: 'PostalCode', value: row.PostalCode, message: 'Must be a valid postal code (e.g. 12345 or 12345-6789).' });
  }

  if (paymentTerms && !PaymentTerms.includes(paymentTerms)) {
    errors.push({ column: 'PaymentTerms', value: row.PaymentTerms, message: `Must be one of: ${PaymentTerms.join(', ')}.` });
  }
  if (paymentTerms === 'Custom' && !customPaymentDays) {
    errors.push({ column: 'CustomPaymentDays', value: row.CustomPaymentDays, message: 'Required when PaymentTerms is "Custom".' });
  }
  if (customPaymentDays && (Number.isNaN(Number(customPaymentDays)) || Number(customPaymentDays) < 0)) {
    errors.push({ column: 'CustomPaymentDays', value: row.CustomPaymentDays, message: 'Must be a non-negative number.' });
  }

  // Payment Info - exactly the real paymentInfoValidators' mode-specific required-field rule
  // (vendorValidators.js) - never a half-filled payment method.
  if (paymentMode && !PaymentModes.includes(paymentMode)) {
    errors.push({ column: 'PaymentMode', value: row.PaymentMode, message: `Must be one of: ${PaymentModes.join(', ')}.` });
  } else if (paymentMode === 'instapay' && !(row.InstapayIdentifier || '').trim()) {
    errors.push({ column: 'InstapayIdentifier', value: row.InstapayIdentifier, message: 'Required when PaymentMode is "instapay".' });
  } else if (paymentMode === 'wallet') {
    if (!walletProvider || !WalletProviders.includes(walletProvider)) {
      errors.push({ column: 'WalletProvider', value: row.WalletProvider, message: `Required when PaymentMode is "wallet" - must be one of: ${WalletProviders.join(', ')}.` });
    }
    if (!(row.WalletIdentifier || '').trim()) {
      errors.push({ column: 'WalletIdentifier', value: row.WalletIdentifier, message: 'Required when PaymentMode is "wallet".' });
    }
  } else if (paymentMode === 'bank') {
    if (!(row.PaymentBankName || '').trim()) errors.push({ column: 'PaymentBankName', value: row.PaymentBankName, message: 'Required when PaymentMode is "bank".' });
    if (!(row.PaymentBankAccountNumber || '').trim()) errors.push({ column: 'PaymentBankAccountNumber', value: row.PaymentBankAccountNumber, message: 'Required when PaymentMode is "bank".' });
  }
  if (iban && !EGYPTIAN_IBAN_REGEX.test(iban)) {
    errors.push({ column: 'PaymentBankIBAN', value: row.PaymentBankIBAN, message: 'Must be a valid Egyptian IBAN (starts with "EG", 29 characters total).' });
  }
  if (swiftCode && !SWIFT_CODE_REGEX.test(swiftCode)) {
    errors.push({ column: 'PaymentBankSwiftCode', value: row.PaymentBankSwiftCode, message: 'Must be a valid 8 or 11 character SWIFT/BIC code.' });
  }

  // Payment accounts: the PaymentMode columns above are the primary account; AdditionalPaymentAccounts
  // adds any number of others (same rules as the vendor form - utils/vendorPaymentAccounts.js).
  let paymentAccounts;
  const additional = parseAdditionalAccounts(row.AdditionalPaymentAccounts);
  if (additional.error) {
    errors.push({ column: 'AdditionalPaymentAccounts', value: row.AdditionalPaymentAccounts, message: additional.error });
  } else {
    const primary = [];
    if (paymentMode === 'bank') primary.push({ type: 'bank', isPrimary: true, bank: { bankName: row.PaymentBankName, accountHolderName: row.PaymentBankAccountHolderName, accountNumber: row.PaymentBankAccountNumber, iban, swiftCode } });
    if (paymentMode === 'instapay') primary.push({ type: 'instapay', isPrimary: true, instapay: { identifier: row.InstapayIdentifier } });
    if (paymentMode === 'wallet') primary.push({ type: 'wallet', isPrimary: true, wallet: { provider: walletProvider, identifier: row.WalletIdentifier } });
    if (primary.length || additional.accounts.length) {
      const { accounts, error } = normalizeVendorPaymentAccounts([...primary, ...additional.accounts]);
      if (error && additional.accounts.length) {
        // Number the error by the entry in the AdditionalPaymentAccounts cell (the primary is entry 0).
        const offset = primary.length;
        const message = error.replace(/Payment account (\d+)/, (_, n) => (Number(n) > offset ? `Entry ${Number(n) - offset}` : 'The primary account (PaymentMode columns)'));
        errors.push({ column: 'AdditionalPaymentAccounts', value: row.AdditionalPaymentAccounts, message });
      } else if (!error) {
        paymentAccounts = accounts;
      }
    }
  }

  if (cashFlowActivity && !['operating', 'investing', 'financing'].includes(cashFlowActivity)) {
    errors.push({ column: 'CashFlowActivity', value: row.CashFlowActivity, message: 'Must be "operating", "investing" or "financing".' });
  }

  if (errors.length > 0) return { errors, value: null };

  return {
    errors,
    value: {
      name,
      type,
      contact: { phone, email },
      balance: balance ? Number(balance) : 0,
      address: {
        street: (row.Street || '').trim() || undefined,
        city: city || undefined,
        state: state || undefined,
        country: country || undefined,
        postalCode: postalCode || undefined,
      },
      taxInfo: {
        taxRegistrationNumber: (row.TaxRegistrationNumber || '').trim() || undefined,
        commercialRegistrationNumber: (row.CommercialRegistrationNumber || '').trim() || undefined,
      },
      paymentInfo: paymentMode
        ? {
            mode: paymentMode,
            instapay: { identifier: (row.InstapayIdentifier || '').trim() || undefined },
            wallet: { provider: walletProvider || undefined, identifier: (row.WalletIdentifier || '').trim() || undefined },
            bank: {
              bankName: (row.PaymentBankName || '').trim() || undefined,
              accountHolderName: (row.PaymentBankAccountHolderName || '').trim() || undefined,
              accountNumber: (row.PaymentBankAccountNumber || '').trim() || undefined,
              iban: iban || undefined,
              swiftCode: swiftCode || undefined,
            },
          }
        : undefined,
      ...(paymentAccounts ? { paymentAccounts } : {}),
      paymentTerms: paymentTerms || undefined,
      customPaymentDays: customPaymentDays ? Number(customPaymentDays) : undefined,
      cashFlowActivity: cashFlowActivity || undefined,
      isActive: parseBoolean(row.IsActive),
    },
  };
};

exports.dedupeKeys = [
  { column: 'Phone', keyFn: row => row.Phone },
  { column: 'Email', keyFn: row => row.Email },
];

// Mirrors controller/user/vendorController.js#createVendor (= factory.createOne(Vendor) =
// `Vendor.create(req.body)`) exactly - a plain create with the same shape, so every schema
// validator/hook (vendorNumber assignment, IBAN/SWIFT format checks) runs identically to a
// manually created vendor.
exports.createOne = async function createOne(value) {
  return Vendor.create(value);
};

// Format guide of every column (utils/csvImport/formatGuide.js - downloaded from the import screen as
// a separate file, never mixed into the data template). Kept beside the validation above, and
// test/import/importFormatGuides.test.js fails if these and the real columns ever disagree.
// required: 'yes' (column and value required) | 'no' | 'conditional' (see the description).
exports.fieldSpecs = [
  {
    column: "Name",
    required: "yes",
    description: "Vendor name (2 to 50 characters).",
    format: "Letters (English/Arabic), spaces and hyphens only",
    maxLength: 50,
    example: "Nile Supplies Co"
  },
  {
    column: "Phone",
    required: "yes",
    description: "Main phone number - must not already belong to another vendor.",
    format: "Egyptian mobile (01XXXXXXXXX, 11 digits) or international with + and country code",
    example: "01123456789"
  },
  {
    column: "Email",
    required: "yes",
    description: "Email address - must not already belong to another vendor.",
    format: "Valid email address",
    example: "contact@nilesupplies.example.com"
  },
  {
    column: "Type",
    required: "no",
    description: "Vendor type (defaults to current).",
    format: "current or equity",
    example: "current"
  },
  {
    column: "Balance",
    required: "no",
    description: "Opening balance.",
    format: "Number (EGP), up to 2 decimals, no separators or currency symbol, >= 0",
    example: "0"
  },
  {
    column: "Street",
    required: "no",
    description: "Street address.",
    format: "Text",
    example: "45 Industrial Zone"
  },
  {
    column: "City",
    required: "no",
    description: "City.",
    format: "Letters and spaces",
    example: "Giza"
  },
  {
    column: "State",
    required: "no",
    description: "Governorate / state.",
    format: "Letters and spaces",
    example: "Giza"
  },
  {
    column: "Country",
    required: "no",
    description: "Country.",
    format: "Letters and spaces",
    example: "Egypt"
  },
  {
    column: "PostalCode",
    required: "no",
    description: "Postal code.",
    format: "5 digits, or 5 digits-4 digits",
    example: "12577"
  },
  {
    column: "TaxRegistrationNumber",
    required: "no",
    description: "Tax registration number.",
    format: "Text",
    example: "321-654-987"
  },
  {
    column: "CommercialRegistrationNumber",
    required: "no",
    description: "Commercial registration number.",
    format: "Text",
    example: "456-789-123"
  },
  {
    column: "PaymentTerms",
    required: "no",
    description: "Default payment terms of the vendor.",
    format: "One of: Immediate, Net 15, Net 30, Net 45, Net 60, Net 90, Custom",
    example: "Net 30"
  },
  {
    column: "CustomPaymentDays",
    required: "conditional",
    description: "Number of days - required when PaymentTerms is Custom.",
    format: "Whole number >= 0",
    example: "75"
  },
  {
    column: "PaymentMode",
    required: "no",
    description: "The vendor's PRIMARY (default) payment account type. Fill the matching columns below; leave empty for none.",
    format: "bank, instapay or wallet",
    example: "bank"
  },
  {
    column: "InstapayIdentifier",
    required: "conditional",
    description: "InstaPay address / mobile - required when PaymentMode is instapay.",
    format: "Text",
    maxLength: 100,
    example: "nilesupplies@instapay"
  },
  {
    column: "WalletProvider",
    required: "conditional",
    description: "Mobile wallet provider - required when PaymentMode is wallet.",
    format: "vodafone_cash, orange_cash, etisalat_cash, we_pay, fawry, other",
    example: "vodafone_cash"
  },
  {
    column: "WalletIdentifier",
    required: "conditional",
    description: "Wallet number - required when PaymentMode is wallet.",
    format: "Text / digits",
    maxLength: 100,
    example: "01012345678"
  },
  {
    column: "PaymentBankName",
    required: "conditional",
    description: "Bank name - required when PaymentMode is bank.",
    format: "Text",
    maxLength: 100,
    example: "Banque Misr"
  },
  {
    column: "PaymentBankAccountHolderName",
    required: "no",
    description: "Name the bank account is held in.",
    format: "Text",
    maxLength: 100,
    example: "Nile Supplies Co"
  },
  {
    column: "PaymentBankAccountNumber",
    required: "conditional",
    description: "Bank account number - required when PaymentMode is bank.",
    format: "Text / digits",
    maxLength: 50,
    example: "9876543210123456"
  },
  {
    column: "PaymentBankIBAN",
    required: "no",
    description: "IBAN of the bank account.",
    format: "Egyptian IBAN: \"EG\" + 27 letters/digits (29 characters total)",
    example: "EG380019000500000000263180099"
  },
  {
    column: "PaymentBankSwiftCode",
    required: "no",
    description: "SWIFT/BIC of the bank.",
    format: "SWIFT/BIC: 8 or 11 letters/digits",
    example: "BMISEGCX"
  },
  {
    column: "CashFlowActivity",
    required: "no",
    description: "Cash flow activity of payments to this vendor.",
    format: "operating, investing or financing",
    example: "operating"
  },
  {
    column: "IsActive",
    required: "no",
    description: "Whether the vendor is active (defaults to true).",
    format: "true/false, yes/no or 1/0",
    example: "true"
  },
  {
    column: "AdditionalPaymentAccounts",
    required: "no",
    description: "Any number of EXTRA payment accounts (several banks, InstaPay addresses, wallets) besides the primary one, separated by \";\". Each entry: bank|BankName|AccountNumber|IBAN|SWIFT|AccountHolderName (account number or IBAN required), instapay|Identifier, or wallet|Provider|WalletNumber. The same account cannot appear twice.",
    format: "type|field|field ; type|field ... (wallet providers: vodafone_cash, orange_cash, etisalat_cash, we_pay, fawry, other)",
    example: "instapay|nilesupplies@instapay ; wallet|vodafone_cash|01012345678"
  }
];
