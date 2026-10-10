const mongooseI18n = require('mongoose-i18n-localize');
const { Schema, model } = require('mongoose');
const { taxInfoSchema, bankInfoSchema, businessDocumentSchema } = require('../shared/businessPartnerSchemas');
const { getNextVendorNumber } = require('../../services/vendor/vendorNumberService');

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
          validator: function (v) {
            return /^(\+20|0)?1[0-9]{9}$/.test(v);
          },
          message: props => `${props.value} is not a valid Egyptian phone number`,
        },

        // required: [true, 'Phone number is required']
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
    paymentTerms: {
      type: String,
      default: 'Net 30',
      enum: {
        values: ['Net 15', 'Net 30', 'Net 45', 'Net 60'],
        message: '{VALUE} is not a valid payment term. Choose from "Net 15", "Net 30", "Net 45", "Net 60"',
      },
    },
    // Note: the vendor form has sent a `bankInfo` object since before this field existed on the
    // schema - Mongoose silently dropped it on every save (strict mode). Adding the field now
    // makes existing frontend behavior actually persist, it isn't new UI surface.
    taxInfo: taxInfoSchema,
    bankInfo: bankInfoSchema,
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
