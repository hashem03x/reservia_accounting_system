const Vendor = require('../../../models/vendor/vendor');
const { isValidPhone } = require('../phoneValidator');
const { PaymentTerms } = require('../../paymentTerms');
const { EGYPTIAN_IBAN_REGEX, SWIFT_CODE_REGEX, PaymentModes, WalletProviders } = require('../../../models/shared/businessPartnerSchemas');

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
