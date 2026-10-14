const { check } = require('express-validator');

const Vendor = require('../../models/vendor/vendor');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { EGYPTIAN_IBAN_REGEX, SWIFT_CODE_REGEX, PaymentModes, WalletProviders } = require('../../models/shared/businessPartnerSchemas');
const { isValidPhone } = require('./phoneValidator');

// Vendor "Payment Information" (docs section "Vendor Payment Information") - optional business
// data (mirrors taxAndBankInfoValidators below), but WHEN a `mode` is selected, exactly that
// mode's required sub-fields must be present - never a half-filled section. Shared by create and
// update since the rule is identical either way (unlike contact.email/contact.phone, nothing here
// becomes unconditionally mandatory at create time).
const paymentInfoValidators = [
    check('paymentInfo.mode')
        .optional({ nullable: true })
        .isIn(PaymentModes)
        .withMessage(`Payment mode must be one of: ${PaymentModes.join(', ')}`),
    check('paymentInfo.instapay.identifier').optional().isString().trim().isLength({ max: 100 }),
    check('paymentInfo.wallet.provider')
        .optional({ nullable: true })
        .isIn(WalletProviders)
        .withMessage(`Wallet provider must be one of: ${WalletProviders.join(', ')}`),
    check('paymentInfo.wallet.identifier').optional().isString().trim().isLength({ max: 100 }),
    check('paymentInfo.bank.bankName').optional().isString().trim().isLength({ max: 100 }),
    check('paymentInfo.bank.accountHolderName').optional().isString().trim().isLength({ max: 100 }),
    check('paymentInfo.bank.accountNumber').optional().isString().trim().isLength({ max: 50 }),
    check('paymentInfo.bank.iban')
        .optional({ nullable: true, checkFalsy: true })
        .isString().trim().toUpperCase()
        .matches(EGYPTIAN_IBAN_REGEX)
        .withMessage('IBAN must be a valid Egyptian IBAN: start with "EG", be exactly 29 characters long, and contain only letters and numbers.'),
    check('paymentInfo.bank.swiftCode')
        .optional({ nullable: true, checkFalsy: true })
        .isString().trim().toUpperCase()
        .matches(SWIFT_CODE_REGEX)
        .withMessage('SWIFT code must be a valid 8 or 11 character SWIFT/BIC code.'),
    check('paymentInfo').custom((value) => {
        if (!value || !value.mode) return true;
        if (value.mode === 'instapay' && !value.instapay?.identifier) {
            throw new Error('Instapay identifier is required when payment mode is Instapay.');
        }
        if (value.mode === 'wallet' && (!value.wallet?.provider || !value.wallet?.identifier)) {
            throw new Error('Wallet provider and identifier are both required when payment mode is Wallet.');
        }
        if (value.mode === 'bank' && (!value.bank?.bankName || !value.bank?.accountNumber)) {
            throw new Error('Bank name and account number are both required when payment mode is Bank Details.');
        }
        return true;
    }),
];

// Shared by create/update - tax/bank info is optional business data; only shape/length is
// checked when provided (mirrors customerValidator.js's identical shared block).
const taxAndBankInfoValidators = [
    check('taxInfo.taxRegistrationNumber').optional().isString().trim().isLength({ max: 50 }),
    check('taxInfo.commercialRegistrationNumber').optional().isString().trim().isLength({ max: 50 }),
    check('bankInfo.bankName').optional().isString().trim().isLength({ max: 100 }),
    check('bankInfo.branch').optional().isString().trim().isLength({ max: 100 }),
    check('bankInfo.accountNumber').optional().isString().trim().isLength({ max: 50 }),
    // Enforced here (not just the Mongoose schema validator) so an invalid IBAN/SWIFT code is
    // rejected with a clean 400 before ever reaching the database.
    check('bankInfo.iban')
        .optional({ nullable: true, checkFalsy: true })
        .isString()
        .trim()
        .toUpperCase()
        .matches(EGYPTIAN_IBAN_REGEX)
        .withMessage('IBAN must be a valid Egyptian IBAN: start with "EG", be exactly 29 characters long, and contain only letters and numbers.'),
    check('bankInfo.swiftCode')
        .optional({ nullable: true, checkFalsy: true })
        .isString()
        .trim()
        .toUpperCase()
        .matches(SWIFT_CODE_REGEX)
        .withMessage('SWIFT code must be a valid 8 or 11 character SWIFT/BIC code.'),
];

// CREATE: Validate required fields for creating a new vendor
const createVendorValidators = [
    ...taxAndBankInfoValidators,
    ...paymentInfoValidators,

    check('name')
        .notEmpty().withMessage('Name is required')
        .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters')
        .matches(/^[a-zA-Z\s\u0600-\u06FF\-\u2013]+$/).withMessage('Name must only contain letters, spaces and hyphens'),

     // Phone and email are both mandatory for every NEW vendor (docs section "Mandatory Vendor
     // and Customer Contact Information") - an existing vendor missing one is never retroactively
     // forced to backfill it (see updateVendorValidators below, which keeps both optional).
     check('contact.phone')
          .trim()
          .notEmpty().withMessage('Phone number is required')
          .custom(val => isValidPhone(val)).withMessage('Phone number must be a valid Egyptian or international phone number.'),

     check('contact.email')
        .trim()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Please provide a valid email address')
        .normalizeEmail()
        .custom((value) => {
            return Vendor.findOne({
                'contact.email': value
            }).then((vendor) => {
                if (vendor) {
                    return Promise.reject('Email is already in use');
                }
            });
        }),

    check('balance')
        .optional()
        .isInt({ min: 0 }).withMessage('Balance must be a non-negative integer'),

    check('address.street')
        .optional()
        .isString().withMessage('Street address must be a string')
        .isLength({ max: 100 }).withMessage('Street address cannot exceed 100 characters'),

    check('address.city')
        .optional()
        .isString().withMessage('City must be a string')
        .matches(/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/).withMessage('City name must only contain letters and spaces')
        .isLength({ max: 50 }).withMessage('City cannot exceed 50 characters'),

    check('address.state')
        .optional()
        .isString().withMessage('State must be a string')
        .matches(/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/).withMessage('State name must only contain letters and spaces')
        .isLength({ max: 50 }).withMessage('State cannot exceed 50 characters'),

    check('address.country')
        .optional()
        .isString().withMessage('Country must be a string')
        .matches(/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/).withMessage('Country name must only contain letters and spaces')
        .isLength({ max: 50 }).withMessage('Country cannot exceed 50 characters'),

    check('address.postalCode')
        .optional()
        .matches(/^\d{5}(-\d{4})?$/).withMessage('Postal code must be valid (e.g., 12345 or 12345-6789)'),

    check('paymentTerms')
        .optional()
        .isIn(['Net 15', 'Net 30', 'Net 45', 'Net 60']).withMessage('Invalid payment term. Choose from "Net 15", "Net 30", "Net 45", "Net 60"'),

    check('isActive')
        .optional()
        .isBoolean().withMessage('isActive must be a boolean'),

    check('cashFlowActivity')
        .optional({ nullable: true })
        .isIn(['operating', 'investing', 'financing']).withMessage('Cash flow activity must be operating, investing or financing'),
        validatorMiddleware
];

// UPDATE: Make validators optional since any field may be updated
const updateVendorValidators = [
    check('name').optional().notEmpty().withMessage('Name cannot be empty'),
    // Fixed: these used to check top-level `email`/`phone`, which never matches the actual
    // request shape (`contact.email`/`contact.phone` - see createVendorValidators above and
    // vendorController.js), making this check dead code. Format-only when present - never forces
    // an existing vendor missing contact info to backfill it just to edit something else.
    check('contact.email').optional().trim().isEmail().withMessage('Please provide a valid email'),
    check('contact.phone')
        .optional({ nullable: true })
        .trim()
        .custom(val => isValidPhone(val)).withMessage('Phone number must be a valid Egyptian or international phone number.'),
    ...taxAndBankInfoValidators,
    ...paymentInfoValidators,
    check('cashFlowActivity')
        .optional({ nullable: true })
        .isIn(['operating', 'investing', 'financing']).withMessage('Cash flow activity must be operating, investing or financing'),
    // Add other validators as needed
    validatorMiddleware,
  ];
  
// DELETE: Only require the vendor ID to delete a vendor
const deleteVendorValidators = [
    check('id')
        .notEmpty().withMessage('Vendor ID is required')
        .isMongoId().withMessage('Invalid vendor ID'),
        validatorMiddleware
];

// READ: Validate read request if using parameters (e.g., vendor ID for specific vendor)
const readVendorValidators = [
    check('id')
        .optional()
        .isMongoId().withMessage('Invalid vendor ID'),
    validatorMiddleware
];

module.exports = {
    createVendorValidators,
    updateVendorValidators,
    deleteVendorValidators,
    readVendorValidators
};
