const mongooseI18n = require('mongoose-i18n-localize');
const { Schema, model } = require('mongoose');
const { taxInfoSchema, bankInfoSchema, paymentInfoSchema, businessDocumentSchema } = require('../shared/businessPartnerSchemas');
const { getNextVendorNumber } = require('../../services/vendor/vendorNumberService');
const { isValidPhone } = require('../../utils/validators/phoneValidator');
const { PaymentTerms } = require('../../utils/paymentTerms');
const { validatePaymentTermsConfig } = require('../../utils/paymentTermsConfig');

const vendorSchema = new Schema(
  {
    // Mirrors User.customerNumber exactly (see that field's comment) - the vendor's own
    // identifying number, needed for journal-entry/general-ledger "Sub Account" display (docs
    // section "Sub Account Mapping"). Auto-assigned below, never client-settable.
    vendorNumber: { type: Number, unique: true, sparse: true, immutable: true },
    type: {
      type: String,
      default: 'current',
      enum: {
        values: ['current', 'equity'],
        message: '{VALUE} is not a valid vendor type. Choose from "current" or "equity"',
      },
    },
    name: {
      type: String,
      required: [true, 'Vendor name is required'],
      minlength: [2, 'Vendor name must be at least 2 characters'],
      maxlength: [50, 'Vendor name cannot exceed 50 characters'],
      // Letters, spaces and hyphens (e.g. the "Supplier - Finance Activities" cash flow vendor).
      match: [/^[a-zA-Z\s\u0621-\u064A\u0660-\u0669\-\u2013]+$/, 'Vendor name must only contain letters, spaces and hyphens'],
    },
    contact: {
      phone: {
        type: String,
        unique: true,
        trim: true,
        required: [true, 'Phone number is required'],
        validate: {
          // Accepts a valid Egyptian mobile OR a generic international number (docs section
          // "Mandatory Vendor and Customer Contact Information") - shared with the
          // express-validator layer (vendorValidators.js) and the CSV import validator so all
          // three write paths (API create/update, bulk insertMany import) agree on exactly one
          // rule.
          validator: isValidPhone,
          message: props => `${props.value} is not a valid Egyptian or international phone number`,
        },
      },
      email: {
        type: String,
        default: undefined,
        lowercase: true,
        trim: true,
        match: [/\S+@\S+\.\S+/, 'Please provide a valid email address'],
        unique: true,
        sparse: true, // This makes the unique index ignore `null` values
      },
    },
    balance: {
      type: Number,
      default: 0,
    },
    address: {
      street: {
        type: String,
        trim: true,
        maxlength: [100, 'Street address cannot exceed 100 characters'],
      },
      city: {
        type: String,
        trim: true,
        match: [/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/, 'City name must only contain letters and spaces'],
        // required: [true, 'City is required']
      },
      state: {
        type: String,
        trim: true,
        // [\u0621-\u064A\u0660-\u0669 ]+$
        match: [/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/, 'State name must only contain letters and spaces'],
        maxlength: [50, 'State cannot exceed 50 characters'],
        // required: [true, 'State is required']
      },
      country: {
        type: String,
        trim: true,
        match: [/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/, 'Country name must only contain letters and spaces'],
        // required: [true, 'Country is required']
      },
      postalCode: {
        type: String,
        match: [/^\d{5}(-\d{4})?$/, 'Postal code must be valid (e.g., 12345 or 12345-6789)'],
        // required: [true, 'Postal code is required']
        // [/^[a-zA-Z0-9\s]+$/, 'Postal code must only contain letters, numbers, and spaces']
      },
    },
    // Payment Terms (docs section "Payment Terms for Customers and Vendors") - governs the
    // default due-date calculation for this vendor's future Purchase Invoices (see
    // utils/helpers/dueDate.js). Widened ADDITIVELY from the original ['Net 15','Net 30','Net
    // 45','Net 60'] - those four existing string values are preserved exactly so no historical
    // vendor document needs migrating; 'Immediate' and 'Custom' are new options alongside them.
    paymentTerms: {
      type: String,
      default: 'Net 30',
      enum: {
        values: PaymentTerms,
        message: '{VALUE} is not a valid payment term. Choose from "Immediate", "Net 15", "Net 30", "Net 45", "Net 60", "Custom"',
      },
    },
    // Only meaningful (and required by the validator layer) when paymentTerms === 'Custom'.
    customPaymentDays: { type: Number, min: 0, default: null },
    // Vendor Payment Terms - Lump Sum and Installments (docs section "Vendor Payment Terms").
    // Deliberately ADDITIVE and separate from paymentTerms/customPaymentDays above (never
    // replaces or migrates them) - those two remain the legacy flat due-date calculation
    // (utils/helpers/dueDate.js) every existing vendor already has and every existing Purchase
    // Invoice's `dueDate` still comes from. This richer config is what
    // utils/helpers/paymentSchedule.js reads to build a full multi-installment schedule, snapshotted
    // onto a Purchase Invoice at creation time - see purchaseOrder.js#paymentSchedule. A vendor
    // with no explicit config here behaves exactly as before (defaults to an immediate lump sum,
    // i.e. no change in behavior for any existing vendor).
    paymentTermsConfig: {
      kind: { type: String, enum: ['lump_sum', 'installments'], default: 'lump_sum' },
      lumpSum: {
        timing: { type: String, enum: ['immediate', 'deferred'], default: 'immediate' },
        durationDays: { type: Number, min: 0, default: 0 },
      },
      installments: {
        type: [
          {
            _id: false,
            durationDays: { type: Number, min: 0, required: true },
            percentage: { type: Number, min: 0, max: 100, required: true },
          },
        ],
        default: [],
      },
    },
    // Note: the vendor form has sent a `bankInfo` object since before this field existed on the
    // schema - Mongoose silently dropped it on every save (strict mode). Adding the field now
    // makes existing frontend behavior actually persist, it isn't new UI surface.
    taxInfo: taxInfoSchema,
    bankInfo: bankInfoSchema,
    // Structured "Payment Information" (docs section "Vendor Payment Information") - additive,
    // separate from `bankInfo` above, which is never deleted/renamed. See
    // scripts/migrateVendorPaymentInfo.js for the one-time, non-destructive copy of existing
    // `bankInfo` into `paymentInfo.bank` for vendors that predate this field.
    paymentInfo: paymentInfoSchema,
    documents: { type: [businessDocumentSchema], default: [] },
    // Cash Flow Statement classification of payments to this vendor (services/reports/
    // financialStatements.js#cashMovements). Null = by the counterpart account (operating for
    // Suppliers). A dedicated "Supplier - Finance Activities" vendor is set to 'financing', so
    // finance-cost expenses paid to it are financing cash flows - set explicitly per vendor,
    // never inferred from its name.
    cashFlowActivity: { type: String, enum: { values: ['operating', 'investing', 'financing', null], message: '{VALUE} is not a valid cash flow activity' }, default: null },
    isActive: {
      type: Boolean,
      default: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Mirrors userModel.js's identical customerNumber-assignment hook exactly, including the
// deliberately unconditional-on-isNew (not "only if unset") assignment, so a request body
// smuggling a vendorNumber directly can never survive - `immutable: true` above then blocks any
// later change.
vendorSchema.pre('save', async function (next) {
  if (!this.isNew) return next();
  this.vendorNumber = await getNextVendorNumber();
  next();
});

// Backstop for paymentTermsConfig (the request validator - vendorValidators.js - is only the fast
// pre-check): only re-validates when the field actually changed, same convention as
// productModel.js#pucAccount's backstop, so a legacy vendor being re-saved for an unrelated reason
// is never re-validated against a rule it predates.
vendorSchema.pre('save', function (next) {
  if (!this.isModified('paymentTermsConfig')) return next();
  const error = validatePaymentTermsConfig(this.paymentTermsConfig?.toObject ? this.paymentTermsConfig.toObject() : this.paymentTermsConfig);
  if (error) return next(new Error(error));
  next();
});

// insertMany() (the vendor CSV import) does not run pre('save') - number those vendors the same
// way, one atomic counter allocation per vendor, overwriting any client-supplied value.
vendorSchema.pre('insertMany', async function (next, docs) {
  const list = Array.isArray(docs) ? docs : [docs];
  for (const doc of list) {
    // eslint-disable-next-line no-await-in-loop
    doc.vendorNumber = await getNextVendorNumber();
  }
  next();
});

vendorSchema.plugin(mongooseI18n, { locales: ['en', 'ar'], defaultLocale: process.env.DEFAULT_LANGUAGE || 'en' });
module.exports = model('Vendor', vendorSchema);
