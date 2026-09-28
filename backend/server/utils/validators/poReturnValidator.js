const { body } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const PO = require('../../models/vendor/purchaseOrder');
const Variant = require('../../models/inventory/variantModel');
const Warehouse = require('../../models/inventory/warehouseModel');
const { PaymentMethods } = require('../appConstant');

const createReturnValidate = [
    // Validate purchase order exists and is in valid state for return
    body('purchaseOrderId')
        .notEmpty().withMessage('Purchase Order ID is required')
        .isMongoId().withMessage('Purchase Order ID must be a mongoID'),

    body('warehouseId')
        .isMongoId().withMessage('Warehouse ID must be a mongoID')
        .notEmpty().withMessage('Warehouse ID is required'),

    // Validate return items
    // body('items')
    //     .isArray().withMessage('Items must be an array')
    //     .custom(async (value, { req }) => {
    //         const po = await PO.findById(req.body.purchaseOrder);

    //         for (const item of value) {
    //             // Check if item exists in original PO
    //             const originalItem = po.items.find(i => i.variant._id.toString() == item.variant);
    //             if (!originalItem) {
    //                 throw new Error(`Item ${item.variant} was not in original purchase order`);
    //             }

    //             // Check if return quantity is valid
    //             if (item.quantity > originalItem.quantity) {
    //                 throw new Error(`Cannot return more items than originally purchased for variant ${item.variant}`);
    //             }

    //             // Validate variant exists
    //             const variant = await Variant.findById(item.variant);
    //             if (!variant) {
    //                 throw new Error(`Variant with ID ${item.variant} does not exist`);
    //             }
    //         }
    //         return true;
    //     }),

    // body('items.*.variant')
    //     .isMongoId()
    //     .withMessage('Variant ID must be a mongoID')
    //     .notEmpty()
    //     .withMessage('Variant ID is required'),

    // body('items.*.quantity')
    //     .isInt({ gt: 0 }).withMessage('Return quantity must be a positive integer'),

    // body('items.*.reason')
    //     .optional()
    //     .isString()
    //     .withMessage('Return reason must be a string')
    //     .isIn(['defective', 'wrong_item', 'not_needed', 'other'])
    //     .withMessage('Invalid return reason')
    //     .custom((value, { req }) => {
    //         if (!value) {
    //             req.body.reason = 'other';
    //         }
    //         return true;
    //     }),

    body('variantId')
        .notEmpty().withMessage('Variant ID is required')
        .isMongoId().withMessage('Variant ID must be a mongoID'),

    body('returnedQuantity')
        .notEmpty().withMessage('Returned quantity is required')
        .isInt({ gt: 0 }).withMessage('Returned quantity must be a positive integer'),

    body('paymentMethod')
        .optional()
        // .withMessage('Payment method is required')
        .isIn(PaymentMethods)
        .withMessage('Invalid payment method'),

    body('notes')
        .optional()
        .isString().withMessage('Notes must be a string'),

    validatorMiddleware
];

module.exports = { createReturnValidate };
