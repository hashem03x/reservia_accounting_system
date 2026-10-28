const { check } = require('express-validator');

const Vendor = require('../../models/vendor/vendor');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { EGYPTIAN_IBAN_REGEX, SWIFT_CODE_REGEX, PaymentModes, WalletProviders } = require('../../models/shared/businessPartnerSchemas');
const { isValidPhone } = require('./phoneValidator');
const { PaymentTerms } = require('../paymentTerms');
<<<<<<< HEAD
const { validatePaymentTermsConfig, validateInstallmentsRequirePaymentTerms } = require('../paymentTermsConfig');
=======
const { validatePaymentTermsConfig, validateScheduleAgainstPaymentTerms, IMMEDIATE_PAYMENT_TERMS_CONFIG } = require('../paymentTermsConfig');
const mongoose = require('mongoose');
const { normalizeVendorPaymentAccounts, paymentInfoFromAccounts } = require('../vendorPaymentAccounts');
>>>>>>> origin/main

// Payment Terms (docs section "Payment Terms for Customers and Vendors") - optional (defaults to
// 'Net 30' at the schema level if omitted entirely), but `customPaymentDays` is required exactly
// when `paymentTerms === 'Custom'`. Shared by create/update - mirrored by customerValidator.js's
// identical block for Customers.
const paymentTermsValidators = [
    check('paymentTerms').optional().isIn(PaymentTerms).withMessage(`Invalid payment term. Choose from ${PaymentTerms.map(t => `"${t}"`).join(', ')}`),
    check('customPaymentDays').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Custom payment days must be a non-negative integer'),
    check('customPaymentDays').custom((value, { req }) => {
        if (req.body.paymentTerms === 'Custom' && (value === undefined || value === null)) {
            throw new Error('customPaymentDays is required when paymentTerms is "Custom".');
        }
        return true;
    }),
];

// Vendor Payment Terms - Lump Sum and Installments (docs section "Vendor Payment Terms").
// Optional (a vendor with none keeps the implicit immediate-lump-sum default - see vendor.js's
// schema default), but when sent, it must be a complete, internally-consistent configuration -
// rejected with the SAME rule the Mongoose model's own backstop enforces
// (utils/paymentTermsConfig.js is the single shared source of truth for both layers).
// The schedule follows the Payment Terms (stored values fill in what an update leaves out):
// Immediate always saves an immediate lump sum (stale schedules are replaced), and Custom
// installments must add up to the custom days. Only applied when the request touches the terms or
// the schedule, so editing an unrelated field of an older vendor is never blocked. A new vendor
// without paymentTerms gets the schema default ('Net 30').
async function resolvePaymentTerms(req) {
    const body = req.body;
    if (body.paymentTerms === undefined && body.customPaymentDays === undefined && body.paymentTermsConfig === undefined) return null;
    const stored = req.params?.id && mongoose.Types.ObjectId.isValid(req.params.id)
        ? await Vendor.findById(req.params.id).select('paymentTerms customPaymentDays paymentTermsConfig').lean()
        : null;
    return {
        paymentTerms: body.paymentTerms !== undefined ? body.paymentTerms : stored?.paymentTerms,
        customPaymentDays: body.customPaymentDays !== undefined ? body.customPaymentDays : stored?.customPaymentDays,
        storedConfig: stored?.paymentTermsConfig,
    };
}

const paymentTermsConfigValidators = [
    check('paymentTermsConfig').customSanitizer(async (value, { req }) => {
        const terms = await resolvePaymentTerms(req);
        if (terms?.paymentTerms !== 'Immediate') return value;
        return { ...IMMEDIATE_PAYMENT_TERMS_CONFIG, lumpSum: { ...IMMEDIATE_PAYMENT_TERMS_CONFIG.lumpSum }, installments: [] };
    }),
    check('paymentTermsConfig').custom(async (value, { req }) => {
        const error = validatePaymentTermsConfig(value);
        if (error) throw new Error(error);
        const terms = await resolvePaymentTerms(req);
        if (!terms) return true;
        const mismatch = validateScheduleAgainstPaymentTerms(terms.paymentTerms, terms.customPaymentDays, value !== undefined ? value : terms.storedConfig);
        if (mismatch) throw new Error(mismatch);
        return true;
    }),
    // Cross-field rule (docs section "Vendor Payment Terms"): whenever installments are enabled,
    // paymentTerms/customPaymentDays become mandatory. Resolved against the EFFECTIVE state (this
    // request's body first, the already-stored vendor second) so a PATCH that enables installments
    // without re-sending paymentTerms is judged by its real resulting value - and so an unrelated
    // update (e.g. renaming a vendor) that never touches any of these three fields is never
    // re-validated against this rule at all, never re-checked against a value it isn't changing.
    check('paymentTermsConfig').custom(async (value, { req }) => {
        const touchesPaymentTerms = value !== undefined || req.body.paymentTerms !== undefined || req.body.customPaymentDays !== undefined;
        if (!touchesPaymentTerms) return true;

        let kind = value?.kind;
        let paymentTerms = req.body.paymentTerms;
        let customPaymentDays = req.body.customPaymentDays;

        if (req.params?.id && (kind === undefined || paymentTerms === undefined || customPaymentDays === undefined)) {
            const existing = await Vendor.findById(req.params.id).select('paymentTerms customPaymentDays paymentTermsConfig.kind').lean();
            if (existing) {
                if (kind === undefined) kind = existing.paymentTermsConfig?.kind;
                if (paymentTerms === undefined) paymentTerms = existing.paymentTerms;
                if (customPaymentDays === undefined) customPaymentDays = existing.customPaymentDays;
            }
        }
        // Still-unresolved fields (a brand-new vendor, nothing to look up) default exactly like the
        // Mongoose schema itself (vendor.js) would - an omitted field is judged as what it will
        // actually become, never as "missing".
        if (kind === undefined) kind = 'lump_sum';
        if (paymentTerms === undefined) paymentTerms = 'Net 30';
        if (customPaymentDays === undefined) customPaymentDays = null;

        const error = validateInstallmentsRequirePaymentTerms({ kind }, paymentTerms, customPaymentDays);
        if (error) throw new Error(error);
        return true;
    }),
];

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

// Vendor payment accounts (utils/vendorPaymentAccounts.js): validated and normalized here, and the
// legacy single paymentInfo set to the primary account (updates use findByIdAndUpdate, so the
// model's save hook does not run for them). On update, an account a payment record points at can
// be deactivated but not removed, and an id that is not one of this vendor's accounts is refused.
const paymentAccountsValidator = check('paymentAccounts')
    .optional({ nullable: true })
    .custom(async (value, { req }) => {
        const { accounts, error } = normalizeVendorPaymentAccounts(value);
        if (error) throw new Error(error);
        if (req.params && req.params.id) {
            const existing = await Vendor.findById(req.params.id).select('paymentAccounts').lean();
            const existingIds = new Set(((existing && existing.paymentAccounts) || []).map(a => String(a._id)));
            const unknown = accounts.find(a => a._id && !existingIds.has(String(a._id)));
            if (unknown) throw new Error('A payment account in the request does not belong to this vendor.');
            const kept = new Set(accounts.filter(a => a._id).map(a => String(a._id)));
            const removed = ((existing && existing.paymentAccounts) || []).filter(a => !kept.has(String(a._id)));
            if (removed.length) {
                const used = await mongoose.connection.collection('payments').countDocuments({ 'vendorPaymentAccount.accountId': { $in: removed.map(a => a._id) } });
                if (used) throw new Error(`A payment account that ${used} payment record(s) were sent to cannot be deleted - deactivate it instead.`);
            }
        }
        req.body.paymentAccounts = accounts;
        req.body.paymentInfo = paymentInfoFromAccounts(accounts);
        return true;
    });

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

    ...paymentTermsValidators,
    ...paymentTermsConfigValidators,

    check('isActive')
        .optional()
        .isBoolean().withMessage('isActive must be a boolean'),

    check('cashFlowActivity')
        .optional({ nullable: true })
        .isIn(['operating', 'investing', 'financing']).withMessage('Cash flow activity must be operating, investing or financing'),
    paymentAccountsValidator,
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
    ...paymentTermsValidators,
    ...paymentTermsConfigValidators,
    check('cashFlowActivity')
        .optional({ nullable: true })
        .isIn(['operating', 'investing', 'financing']).withMessage('Cash flow activity must be operating, investing or financing'),
    paymentAccountsValidator,
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
