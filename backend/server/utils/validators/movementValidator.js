const { body } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const Warehouse = require('../../models/inventory/warehouseModel');

const createMovementValidate = [
  body('movementType')
    .isIn(['transfer', 'sale', 'return'])
    .withMessage('Movement type must be one of [transfer, sale, return]')
    .notEmpty()
    .withMessage('Movement type is required'),

  body('quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer')
    .notEmpty()
    .withMessage('Quantity is required'),

  body('fromLocation')
    .isMongoId()
    .withMessage('From location must be a valid MongoDB ObjectId')
    .notEmpty()
    .withMessage('From location is required')
    .custom((value, { req }) => {
      if (req.body.movementType === 'transfer' && value === req.body.toLocation) {
        throw new Error('From and to locations must be different for transfers');
      }

      Warehouse.findById(value).then(warehouse => {
        if (!warehouse) {
          throw new Error('From location does not exist');
        }
      });

      return true;
    }),

  body('toLocation')
    .optional()
    .isMongoId()
    .withMessage('To location must be a valid MongoDB ObjectId')
    .custom((value, { req }) => {

      if (req.body.movementType === 'transfer' && value === req.body.fromLocation) {
        throw new Error('From and to locations must be different for transfers');
      }

      if (req.body.movementType === 'transfer' && !value) {
        throw new Error('To location is required for transfers');
      }

      Warehouse.findById(value).then(warehouse => {
        if (!warehouse) {
          throw new Error('To location does not exist');
        }
      });

      return true;
    }),

 
  body('product')
    .isMongoId()
    .withMessage('Product must be a valid MongoDB ObjectId')
    .notEmpty()
    .withMessage('Product is required'),

  validatorMiddleware
];

module.exports = {
  createMovementValidate
};
