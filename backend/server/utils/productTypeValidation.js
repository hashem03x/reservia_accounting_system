// Pure, DB-free validation of the product/service type split - the single source of truth for
// "which fields are required for which type", shared by productValidator.js's create/update
// chains so the rules can never drift between the two. Kept dependency-free (no express-validator,
// no Mongoose) so it can be unit-tested directly, the same way utils/transformFileDataToProductData.js
// is tested in server/test/.
//
// Returns an error message string, or null when the fields are valid for the given type.
//
// `requirePucAccount`: a NEW service must name its PUC Account (Product.pucAccount - the account a
// Purchase Order of this service posts to instead of Materials Inventory). Callers pass `false`
// only where the field is genuinely optional (e.g. an update request that doesn't touch it).
function validateProductTypeFields({ type = 'product', cost, category, subcategory, durationValue, durationUnit, pucAccount, requirePucAccount = false }) {
  if (!['product', 'service'].includes(type)) {
    return 'type must be either "product" or "service"';
  }

  if (type === 'service') {
    const numericDuration = Number(durationValue);
    if (durationValue === undefined || durationValue === null || durationValue === '' || Number.isNaN(numericDuration) || numericDuration <= 0) {
      return 'A service requires a positive durationValue';
    }
    if (durationUnit && durationUnit !== 'month') {
      return 'durationUnit must be "month"';
    }
    if (requirePucAccount && !pucAccount) {
      return 'A service requires a PUC account';
    }
    return null;
  }

  // type === 'product'
  if (cost === undefined || cost === null || cost === '') return 'Product cost is required';
  if (!category) return 'Category is required for a product';
  if (!subcategory) return 'Subcategory is required for a product';
  if (pucAccount) return 'Only a service can have a PUC account';
  return null;
}

module.exports = { validateProductTypeFields };
