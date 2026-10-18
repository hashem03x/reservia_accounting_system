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

const itemsValidators = [
  body('items').isArray({ min: 1 }).withMessage('A Purchase Order needs at least one line item.'),
  body('items.*.description').notEmpty().withMessage('Each line needs a description'),
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
  body('items.*.description').if(body('items').exists()).notEmpty().withMessage('Each line needs a description'),
  body('items.*.quantity').if(body('items').exists()).isFloat({ gt: 0 }).withMessage('Quantity must be a positive number'),
  body('items.*.unitPrice').if(body('items').exists()).isFloat({ min: 0 }).withMessage('Unit price cannot be negative'),
  productRefValidator,

  body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),

  validatorMiddleware,
];

module.exports = { createRequisitionValidators, updateRequisitionValidators };
