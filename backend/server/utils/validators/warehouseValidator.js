const { check } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

const Warehouse = require('../../models/inventory/warehouseModel');
exports.createWarehouseValidator = [
  // Validate each object in the array
  check('name')
    .notEmpty().withMessage('Name is required')
    .isString().withMessage('Name must be a string'),

  check('location')
    .notEmpty().withMessage('Location is required')
    .isString().withMessage('Location must be a string'),

  check('balance')
    .notEmpty().withMessage('The opening balance is required')
    .isNumeric().withMessage('Balance must be a number')
    .custom((value) => value >= 0).withMessage('Balance must be a positive number'),

  check('isDefault')
    .optional()
    .isBoolean().withMessage('isDefault must be a boolean'),

  validatorMiddleware
];


exports.updateWarehouseValidator = [
  check('name').optional().notEmpty().withMessage('Name cannot be empty'),
  check('location').optional().notEmpty().withMessage('Location cannot be empty'),
  check('capacity').optional().isInt({ min: 1 }).withMessage('Capacity must be a positive integer'),
  check('isActive').optional().isBoolean().withMessage('isActive must be a boolean'),
  validatorMiddleware
];

exports.deleteWarehouseValidator = [
  check('id')
    .notEmpty().withMessage('Warehouse ID is required')
    .isMongoId().withMessage('Invalid warehouse ID'),
  validatorMiddleware
];


