const { Schema } = require('mongoose');
const { PaymentTermModes, InstallmentBases } = require('../../utils/documentPaymentTerms');

// The stored shape of a document's own payment terms (Purchase Order vendor terms, Project customer
// terms) - see utils/documentPaymentTerms.js for the rules, the calculation basis and rounding.
// Only the contractual inputs are stored; amounts and due dates are derived from the document's
// current value and issue date whenever the schedule is read, so they can never drift from them.
const installmentSchema = new Schema(
  {
    description: { type: String, trim: true, required: true, maxlength: 200 },
    basis: { type: String, enum: InstallmentBases, required: true },
    percentage: { type: Number, min: 0, max: 100, default: null },
    amount: { type: Number, min: 0, default: null },
    tenorDays: { type: Number, min: 0, required: true },
  },
  { _id: false }
);

const documentPaymentTermsSchema = new Schema(
  {
    mode: { type: String, enum: PaymentTermModes, required: true },
    lumpSumDueDate: { type: Date, default: null },
    installments: { type: [installmentSchema], default: [] },
  },
  { _id: false }
);

module.exports = { documentPaymentTermsSchema };
