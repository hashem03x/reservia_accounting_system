const { check, param } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

const Product = require('../../models/inventory/productModel');
const Variant = require('../../models/inventory/variantModel');
const Warehouse = require('../../models/inventory/warehouseModel');


// CREATE: Validation rules for creatuse ing a new variant
const createVariantValidate = [
    check('variantCode')
        .notEmpty().withMessage('Variant code is required')
        .isLength({ min: 6 }).withMessage('Variant code must be at least 6 characters long'),

    check('color')
        .notEmpty().withMessage('Color is required')
        .isString().withMessage('Color must be a string'),

    check('size')
        .notEmpty().withMessage('Size is required')
        .isString().withMessage('Size must be a string'),

    check('sku')
        .notEmpty().withMessage('SKU is required')
        .custom((value) => {
            return Variant.findOne({ sku: value }).then(variant => {
                if (variant) {
                    return Promise.reject('SKU already in use');
                }
                return true;
            });
        }),

    check('price')
        .optional()
        .isFloat({ min: 0 }).withMessage('Price must be a positive number'),

    check('stock')
        .isArray({ min: 1 }).withMessage('Stock must be an array with at least one item')
        .custom((stocks) => stocks.every(stock =>
            stock.warehouse && stock.quantity !== undefined &&
            Warehouse.exists({ _id: stock.warehouse }) &&
            typeof stock.quantity === 'number' && stock.quantity >= 0
        )).withMessage('Each stock item must have a valid warehouse and a non-negative quantity'),

    check('stockStatus')
        .optional()
        .isIn(['in_stock', 'out_of_stock', 'running_low']).withMessage('Stock status must be one of in_stock, out_of_stock, running_low'),

    check('stockLevel')
        .optional()
        .isInt({ min: 0 }).withMessage('Stock level must be a non-negative integer'),

    validatorMiddleware
];


const updateVariantValidate = [
    check('color')
        .optional()
        .isString().withMessage('Color must be a string'),

    check('size')
        .optional()
        .isString().withMessage('Size must be a string'),

    check('sku')
        .optional()
        .custom((value, { req }) => {
            return Variant.findOne({ sku: value, _id: { $ne: req.params.variantId } }).then((variant) => {
                if (variant) {
                    return Promise.reject('SKU already in use');
                }
                return true;
            });
        }),

        check('price')
        .optional()
        .isFloat({ min: 0 }).withMessage('Price must be a positive number'),

        check('stock')
        .optional()
        .isArray().withMessage('Stock must be an array')
        // .custom((stocks) => {
        //     if (!stocks) return true;
        //     return stocks.every((stock) => {
        //     if (stock.warehouse && stock.quantity === undefined) {
        //         return Warehouse.exists({ _id: stock.warehouse });
        //     }
        //     if (stock.quantity !== undefined && !stock.warehouse) {
        //         return typeof stock.quantity === 'number' && stock.quantity >= 0;
        //     }
        //     return stock.warehouse && stock.quantity !== undefined &&
        //         Warehouse.exists({ _id: stock.warehouse }) &&
        //         typeof stock.quantity === 'number' && stock.quantity >= 0;
        //     });
        // }).withMessage('Each stock item must have a valid warehouse and a non-negative quantity'),
        .custom((stocks) => {
            if (!stocks) return true;
            return stocks.every(
                (stock) =>
                    stock.warehouse &&
                    stock.quantity !== undefined &&
                    Warehouse.exists({ _id: stock.warehouse }) &&
                    typeof stock.quantity === 'number' &&
                    stock.quantity >= 0
            );
        }).withMessage('Each stock item must have a valid warehouse and a non-negative quantity'),

    check('stockStatus')
        .optional()
        .isIn(['in_stock', 'out_of_stock', 'running_low']).withMessage('Stock status must be one of in_stock, out_of_stock, running_low'),

    check('stockLevel')
        .optional()
        .isInt({ min: 0 }).withMessage('Stock level must be a non-negative integer'),

    validatorMiddleware,
];
// UPDATE: Validation rules for updating a variant (all fields optional)


// DELETE: Validation rules for deleting a variant by ID
const deleteVariantValidators = [
    check('id')
        .notEmpty().withMessage('Variant ID is required')
        .isMongoId().withMessage('Invalid Variant ID format')
        .custom((value, { req }) => {
            return Variant.exists({ _id: value, productId: req.params.productId }) && Product.exists({ _id: req.params.productId });
        }).withMessage('Variant or Proudct not found for the given IDs'),
    validatorMiddleware
];


// raed : validation rules for reading specific product variant 
const getVariantsSpecificProduct = [
    check('productId')
    .notEmpty()
    .isMongoId().withMessage('product Id is required')
    .custom((value) => {
        return Product.exists({ _id: value });
    }).withMessage('Product does not exist'),
    validatorMiddleware
]

// READ: Validation rules for reading a specific variant by ID
const readVariantValidators = [
    check('id')
        .notEmpty()
        .isMongoId().withMessage('Invalid Variant ID format')
        .custom((val, {req}) => {
            return Variant.exists({ _id: val, productId: req.params.productId }) && Product.exists({ _id: req.params.productId });
        }).withMessage('Variant or product not found for the given ID'),
    validatorMiddleware
];

module.exports = {
    createVariantValidate,
    updateVariantValidate,
    deleteVariantValidators,
    readVariantValidators,
    getVariantsSpecificProduct
};
