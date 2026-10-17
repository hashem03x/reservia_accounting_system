const { body } = require('express-validator');
const Vendor = require('../../models/vendor/vendor');
const Project = require('../../models/project/projectModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

const itemsValidators = [
  body('items').isArray({ min: 1 }).withMessage('A Purchase Order needs at least one line item.'),
  body('items.*.description').notEmpty().withMessage('Each line needs a description'),
  body('items.*.quantity').isFloat({ gt: 0 }).withMessage('Quantity must be a positive number'),
  body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('Unit price cannot be negative'),
  body('items.*.product').optional({ nullable: true }).isMongoId().withMessage('Product ID must be a mongoID'),
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

  body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),

  validatorMiddleware,
];

module.exports = { createRequisitionValidators, updateRequisitionValidators };
