const { body } = require('express-validator');

const validatorMiddleware = require('../../middleware/validatorMiddleware');
const Vendor = require('../../models/vendor/vendor');
const Warehouse = require('../../models/inventory/warehouseModel');

const createPurchaseOrderValidate = [
    body('vendorId').isMongoId().withMessage('Vendor ID must be a mongoID').custom(value => {
        return Vendor.exists({ _id: value });
    }).withMessage('Vendor does not exist'),


    body('warehouseId').isMongoId().withMessage('Warehouse ID must be a mongoID').custom(value => {
        return Warehouse.exists({ _id: value });
    }).withMessage('Warehouse does not exist1'),

    body('items').isArray().withMessage('Items must be an array'),

    body('items.*.productId').isMongoId().withMessage('Product ID must be a mongoID'),
    body('items.*.unitPrice').isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
    body('items.*.starterQuantity').isInt({ gt: 0 }).withMessage('Quantity must be a positive integer'),

    validatorMiddleware
];

module.exports = { createPurchaseOrderValidate };