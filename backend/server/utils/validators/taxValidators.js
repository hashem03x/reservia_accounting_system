const { body } = require('express-validator');

// Shared by Sales Order and Purchase Order creation (docs sections "VAT on Sales Orders and
// Purchase Orders" / "Withholding Tax") - a single source so both order types enforce the exact
// same rule, never two near-identical copies that could drift apart.
//
// Only the percentages are ever accepted from a request body - `vatAmount`/`withholdingTaxAmount`/
// `grandTotal`/`totalAmount` are never read from req.body by either controller, so a client cannot
// manipulate them even by sending them; the model's own pre('save') hook is what actually computes
// and persists them, from the real item totals, every time.
const vatAndWithholdingTaxValidators = [
  body('vatPercentage').optional().isFloat({ min: 0 }).withMessage('VAT percentage cannot be negative'),

  // Only these four rates are valid business values (not an arbitrary percentage like VAT) - see
  // accountingConstants-adjacent docs section "Withholding Tax". Compared as numbers, not strings,
  // since a JSON request body sends a real number.
  body('withholdingTaxPercentage')
    .optional()
    .custom(value => [0, 1, 3, 5].includes(Number(value)))
    .withMessage('Withholding tax percentage must be one of: 0, 1, 3, 5'),
];

module.exports = { vatAndWithholdingTaxValidators };
