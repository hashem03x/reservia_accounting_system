const { Schema, model } = require('mongoose');

// The company's Issued Capital - a single, well-known document (one row, never more), mirroring
// counterModel.js's own "one document per fixed _id" convention for a singleton config value
// rather than inventing a new pattern. Paid-in Capital and Unpaid Capital are NEVER stored here
// (or anywhere) - they are always computed at read time from the real Shareholder.shareCapital
// totals (services/equity/companyCapitalService.js), exactly like this codebase's existing
// "pure read-time aggregation, never a persisted/driftable summary" convention (e.g. the Cash Flow
// Forecast, the CRM pipeline summary) - so they can never drift out of sync with the actual
// contributions on record.
const SINGLETON_ID = 'company-capital';

const companyCapitalSchema = new Schema(
  {
    _id: { type: String, default: SINGLETON_ID },
    issuedCapital: { type: Number, required: [true, 'Issued capital is required'], min: [0.01, 'Issued capital must be greater than 0'] },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

const CompanyCapital = model('CompanyCapital', companyCapitalSchema);
CompanyCapital.SINGLETON_ID = SINGLETON_ID;

module.exports = CompanyCapital;
