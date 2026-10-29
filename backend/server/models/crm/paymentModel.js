const { Schema, model } = require('mongoose');
const { PAYMENT_PURPOSES, PAYMENT_PROVIDERS, PAYMENT_STATUSES } = require('../../utils/crm/constants');

// Reservia CRM - Phase 2 "Payments" (Developer Brief section 4F, due 2026-12-24).
//
// MODEL SHAPE ONLY - there is no service/controller/route wired to this yet, and NONE should be
// added that marks a payment `paid` from anything other than a real, verified confirmation. The
// brief is explicit: "Never generate fake Fawry references, simulate successful card
// transactions, or mark a payment as paid simply because the frontend was clicked." Building a
// "create payment" UI/endpoint ahead of real Fawry/card credentials (which this task has none of -
// see the final report's blockers section) would mean either leaving a fake success path in place
// or shipping something that silently does nothing real; both are worse than the feature not
// existing yet. `provider: 'bank_transfer'` / `'cash'` with `status: 'paid'` set by a human after
// manually confirming funds landed is the one path that IS safe to build without any external
// credential, and is a reasonable next increment once Phase 2 resumes.
const paymentSchema = new Schema(
  {
    lead: { type: Schema.Types.ObjectId, ref: 'CrmLead', required: true },
    quotation: { type: Schema.Types.ObjectId, ref: 'CrmQuotation', default: null },
    purpose: { type: String, enum: PAYMENT_PURPOSES, required: true },
    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    amountEgp: { type: Number, required: true, min: 0 },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
    reference: { type: String, trim: true, default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

paymentSchema.index({ lead: 1, createdAt: -1 });

module.exports = model('CrmPayment', paymentSchema);
