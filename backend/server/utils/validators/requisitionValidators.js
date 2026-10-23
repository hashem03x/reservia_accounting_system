const { body } = require('express-validator');
const Vendor = require('../../models/vendor/vendor');
const Project = require('../../models/project/projectModel');
const Product = require('../../models/inventory/productModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

// A line's `product` reference is optional (the description stays the canonical, required field -
// see docs section "Purchase Orders - Select Products From the Catalog": "the user enters the
// purchase-specific details... Keep product selection and document pricing separate"), but when
// given it must reference a real, existing Product - never silently accepted as an opaque id.
const productRefValidator = body('items.*.product')
  .optional({ nullable: true })
  .isMongoId()
  .withMessage('Product ID must be a mongoID')
  .custom(async value => {
    const exists = await Product.exists({ _id: value });
    if (!exists) throw new Error('The selected product does not exist');
    return true;
  });

// Purchase Order payment terms / issue date - shape only here; the rules that need the order's
// value (allocation <= 100% / <= value, lump-sum date >= issue date) are checked by the controller
// against the computed total, with the model as backstop (utils/documentPaymentTerms.js).
const termsValidators = [
  body('issueDate').optional({ nullable: true }).isISO8601().withMessage('Invalid issue date'),
  body('paymentTerms').optional({ nullable: true }).isObject().withMessage('Payment terms must be an object'),
];

// Every new line names a catalog product (its description is optional line notes) - see
// requisitionController.js#buildItems, which also keeps a draft's unchanged legacy lines editable.
const itemsValidators = [
  body('items').isArray({ min: 1 }).withMessage('A Purchase Order needs at least one line item.'),
  body('items.*.product').notEmpty().withMessage('Each line needs a product or service from the catalog'),
  body('items.*.description').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('items.*.quantity').isFloat({ gt: 0 }).withMessage('Quantity must be a positive number'),
  body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('Unit price cannot be negative'),
  productRefValidator,
  body('items.*.unit').optional({ nullable: true }).isString(),
];

const createRequisitionValidators = [
  body('vendorId')
    .notEmpty()
    .withMessage('Vendor is required')
    .isMongoId()
    .withMessage('Vendor ID must be a mongoID')
    .custom(async value => {
      const exists = await Vendor.exists({ _id: value });
      if (!exists) throw new Error('Vendor does not exist');
      return true;
    }),

  body('project')
    .notEmpty()
    .withMessage('Project is required')
    .isMongoId()
    .withMessage('Project ID must be a mongoID')
    .custom(async value => {
      const exists = await Project.exists({ _id: value });
      if (!exists) throw new Error('Project does not exist');
      return true;
    }),

  ...itemsValidators,
  ...termsValidators,

  body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),

  validatorMiddleware,
];

const updateRequisitionValidators = [
  body('vendorId')
    .optional()
    .isMongoId()
    .withMessage('Vendor ID must be a mongoID')
    .custom(async value => {
      const exists = await Vendor.exists({ _id: value });
      if (!exists) throw new Error('Vendor does not exist');
      return true;
    }),

  body('project')
    .optional()
    .isMongoId()
    .withMessage('Project ID must be a mongoID')
    .custom(async value => {
      const exists = await Project.exists({ _id: value });
      if (!exists) throw new Error('Project does not exist');
      return true;
    }),

  body('items').optional().isArray({ min: 1 }).withMessage('A Purchase Order needs at least one line item.'),
  body('items.*.description').if(body('items').exists()).optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('items.*.quantity').if(body('items').exists()).isFloat({ gt: 0 }).withMessage('Quantity must be a positive number'),
  body('items.*.unitPrice').if(body('items').exists()).isFloat({ min: 0 }).withMessage('Unit price cannot be negative'),
  productRefValidator,
  ...termsValidators,

  body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),

  validatorMiddleware,
];

module.exports = { createRequisitionValidators, updateRequisitionValidators };
