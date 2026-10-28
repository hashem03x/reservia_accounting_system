// Shared Payment Terms vocabulary for Customers and Vendors (docs section "Payment Terms for
// Customers and Vendors") - one source of truth so the Mongoose schema enums
// (models/userModel.js, models/vendor/vendor.js) and their express-validator chains
// (utils/validators/customerValidator.js, utils/validators/vendorValidators.js) can never drift.
// The four 'Net X' values are the ORIGINAL values Vendor.paymentTerms already shipped with -
// preserved exactly so no historical vendor document needs migrating; 'Immediate' and 'Custom'
// are the new additions.
const PaymentTerms = ['Immediate', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'Custom'];

module.exports = { PaymentTerms };
