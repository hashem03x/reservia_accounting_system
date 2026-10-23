const User = require('../../../models/userModel');
const { isValidPhone } = require('../phoneValidator');
const { PaymentTerms } = require('../../paymentTerms');
const { EGYPTIAN_IBAN_REGEX, SWIFT_CODE_REGEX } = require('../../../models/shared/businessPartnerSchemas');

// Customer CSV import schema (docs section "Customer CSV Import"). Mirrors the EXACT fields/rules
// of the real "create offline customer" path (controller/user/customerController.js#createCustomer
// + utils/validators/customerValidator.js#createCustomerValidate) - a CSV-imported customer must
// be indistinguishable from one created through the manual form, including getting a real
// `customerNumber` (which the pre-existing, now-replaced importer never did - see git history/PR
// notes - because it used `User.insertMany()`, and `User` has no `pre('insertMany')` hook, unlike
// `Vendor`). `createOne` below uses `User.create()` specifically so the model's real `pre('save')`
// hook (customerNumber assignment) always runs.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.headers = [
  'Name',
  'Phone',
  'Email',
  'AdditionalPhone',
  'Street',
  'City',
  'State',
  'Country',
  'PostalCode',
  'TaxRegistrationNumber',
  'CommercialRegistrationNumber',
  'BankName',
  'BankBranch',
  'BankAccountNumber',
  'BankIBAN',
  'BankSwiftCode',
  'PaymentTerms',
  'CustomPaymentDays',
  'Balance',
];

exports.requiredHeaders = ['Name', 'Phone', 'Email'];

exports.exampleRow = [
  'Ahmed Hassan',
  '01012345678',
  'ahmed.hassan@example.com',
  '',
  '12 Tahrir St',
  'Cairo',
  'Cairo',
  'Egypt',
  '11511',
  '123-456-789',
  '987-654-321',
  'National Bank of Egypt',
  'Downtown',
  '1234567890123456',
  'EG380019000500000000263180002',
  'NBEGEGCX',
  'Net 30',
  '',
  '0',
];

// Fetched ONCE before validating any row (not once per row) - a single pair of queries, not N+1.
// Preview and commit both call this fresh, so a customer created between preview and commit is
// still correctly caught at commit time.
exports.fetchContext = async function fetchContext() {
  const existing = await User.find({ $or: [{ phone: { $exists: true, $ne: null } }, { email: { $exists: true, $ne: null } }] })
    .select('phone email')
    .lean();
  return {
    existingPhones: new Set(existing.filter(u => u.phone).map(u => u.phone.trim().toLowerCase())),
    existingEmails: new Set(existing.filter(u => u.email).map(u => u.email.trim().toLowerCase())),
  };
};

exports.validateRow = async function validateRow(row, { existingPhones, existingEmails }) {
  const errors = [];

  const name = (row.Name || '').trim();
  const phone = (row.Phone || '').trim();
  const email = (row.Email || '').trim();
  const additionalPhone = (row.AdditionalPhone || '').trim();
  const balance = (row.Balance || '').trim();
  const paymentTerms = (row.PaymentTerms || '').trim();
  const customPaymentDays = (row.CustomPaymentDays || '').trim();
  const iban = (row.BankIBAN || '').trim().toUpperCase();
  const swiftCode = (row.BankSwiftCode || '').trim().toUpperCase();
  const postalCode = (row.PostalCode || '').trim();

  if (!name) errors.push({ column: 'Name', value: row.Name, message: 'Name is required.' });

  if (!phone) {
    errors.push({ column: 'Phone', value: row.Phone, message: 'Phone is required.' });
  } else if (!isValidPhone(phone)) {
    errors.push({ column: 'Phone', value: row.Phone, message: 'Not a valid Egyptian or international phone number.', suggestion: 'Use a format like 01012345678 or +201012345678.' });
  } else if (existingPhones.has(phone.toLowerCase())) {
    errors.push({ column: 'Phone', value: row.Phone, message: 'A customer with this phone number already exists.' });
  }

  if (!email) {
    errors.push({ column: 'Email', value: row.Email, message: 'Email is required.' });
  } else if (!EMAIL_REGEX.test(email)) {
    errors.push({ column: 'Email', value: row.Email, message: 'Not a valid email address.' });
  } else if (existingEmails.has(email.toLowerCase())) {
    errors.push({ column: 'Email', value: row.Email, message: 'A customer with this email already exists.' });
  }

  if (balance && Number.isNaN(Number(balance))) {
    errors.push({ column: 'Balance', value: row.Balance, message: 'Balance must be a number.' });
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

  if (iban && !EGYPTIAN_IBAN_REGEX.test(iban)) {
    errors.push({ column: 'BankIBAN', value: row.BankIBAN, message: 'Must be a valid Egyptian IBAN (starts with "EG", 29 characters total).' });
  }
  if (swiftCode && !SWIFT_CODE_REGEX.test(swiftCode)) {
    errors.push({ column: 'BankSwiftCode', value: row.BankSwiftCode, message: 'Must be a valid 8 or 11 character SWIFT/BIC code.' });
  }
  if (postalCode && !/^\d{5}(-\d{4})?$/.test(postalCode)) {
    errors.push({ column: 'PostalCode', value: row.PostalCode, message: 'Must be a valid postal code (e.g. 12345 or 12345-6789).' });
  }

  if (errors.length > 0) return { errors, value: null };

  return {
    errors,
    value: {
      name,
      phone,
      email,
      additionalPhone: additionalPhone || undefined,
      offlineAddress: {
        street: (row.Street || '').trim() || undefined,
        city: (row.City || '').trim() || undefined,
        state: (row.State || '').trim() || undefined,
        country: (row.Country || '').trim() || undefined,
        postalCode: postalCode || undefined,
      },
      taxInfo: {
        taxRegistrationNumber: (row.TaxRegistrationNumber || '').trim() || undefined,
        commercialRegistrationNumber: (row.CommercialRegistrationNumber || '').trim() || undefined,
      },
      bankInfo: {
        bankName: (row.BankName || '').trim() || undefined,
        branch: (row.BankBranch || '').trim() || undefined,
        accountNumber: (row.BankAccountNumber || '').trim() || undefined,
        iban: iban || undefined,
        swiftCode: swiftCode || undefined,
      },
      paymentTerms: paymentTerms || undefined,
      customPaymentDays: customPaymentDays ? Number(customPaymentDays) : undefined,
      balance: balance ? Number(balance) : 0,
    },
  };
};

exports.dedupeKeys = [
  { column: 'Phone', keyFn: row => row.Phone },
  { column: 'Email', keyFn: row => row.Email },
];

// Mirrors controller/user/customerController.js#createCustomer exactly - same fields, same
// role/type/isOffline flags - so an imported customer is indistinguishable from a manually
// created one. Uses User.create() (never insertMany) specifically so the model's own
// pre('save') hook assigns a real customerNumber.
exports.createOne = async function createOne(value) {
  return User.create({
    name: value.name,
    phone: value.phone,
    additionalPhone: value.additionalPhone,
    email: value.email,
    offlineAddress: value.offlineAddress,
    taxInfo: value.taxInfo,
    bankInfo: value.bankInfo,
    paymentTerms: value.paymentTerms,
    customPaymentDays: value.customPaymentDays,
    balance: value.balance,
    role: 'user',
    isOffline: true,
    type: 'offline',
  });
};

// Format guide of every column (utils/csvImport/formatGuide.js - downloaded from the import screen as
// a separate file, never mixed into the data template). Kept beside the validation above, and
// test/import/importFormatGuides.test.js fails if these and the real columns ever disagree.
// required: 'yes' (column and value required) | 'no' | 'conditional' (see the description).
exports.fieldSpecs = [
  {
    column: "Name",
    required: "yes",
    description: "Customer name.",
    format: "Text",
    example: "Delta Construction"
  },
  {
    column: "Phone",
    required: "yes",
    description: "Main phone number - must not already belong to another customer.",
    format: "Egyptian mobile (01XXXXXXXXX, 11 digits) or international with + and country code",
    example: "01012345678"
  },
  {
    column: "Email",
    required: "yes",
    description: "Email address - must not already belong to another customer.",
    format: "Valid email address",
    example: "accounts@delta.example.com"
  },
  {
    column: "AdditionalPhone",
    required: "no",
    description: "Second phone number.",
    format: "Egyptian mobile (01XXXXXXXXX, 11 digits) or international with + and country code",
    example: "01112345678"
  },
  {
    column: "Street",
    required: "no",
    description: "Street address.",
    format: "Text",
    example: "12 Tahrir St"
  },
  {
    column: "City",
    required: "no",
    description: "City.",
    format: "Text",
    example: "Cairo"
  },
  {
    column: "State",
    required: "no",
    description: "Governorate / state.",
    format: "Text",
    example: "Cairo"
  },
  {
    column: "Country",
    required: "no",
    description: "Country.",
    format: "Text",
    example: "Egypt"
  },
  {
    column: "PostalCode",
    required: "no",
    description: "Postal code.",
    format: "5 digits, or 5 digits-4 digits",
    example: "11511"
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
    example: "456789"
  },
  {
    column: "BankName",
    required: "no",
    description: "Customer's bank.",
    format: "Text",
    example: "Banque Misr"
  },
  {
    column: "BankBranch",
    required: "no",
    description: "Bank branch.",
    format: "Text",
    example: "Heliopolis"
  },
  {
    column: "BankAccountNumber",
    required: "no",
    description: "Bank account number.",
    format: "Text / digits",
    example: "1234567890123"
  },
  {
    column: "BankIBAN",
    required: "no",
    description: "IBAN of the bank account.",
    format: "Egyptian IBAN: \"EG\" + 27 letters/digits (29 characters total)",
    example: "EG380019000500000000263180099"
  },
  {
    column: "BankSwiftCode",
    required: "no",
    description: "SWIFT/BIC of the bank.",
    format: "SWIFT/BIC: 8 or 11 letters/digits",
    example: "BMISEGCX"
  },
  {
    column: "PaymentTerms",
    required: "no",
    description: "Default payment terms of the customer (decides a sales invoice due date).",
    format: "One of: Immediate, Net 15, Net 30, Net 45, Net 60, Custom",
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
    column: "Balance",
    required: "no",
    description: "Opening balance.",
    format: "Number (EGP), up to 2 decimals, no separators or currency symbol",
    example: "0"
  }
];
