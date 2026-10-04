const { body } = require('express-validator');

const validatorMiddleware = require('../../middleware/validatorMiddleware');
const Vendor = require('../../models/vendor/vendor');
const Warehouse = require('../../models/inventory/warehouseModel');
const Project = require('../../models/project/projectModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { vatAndWithholdingTaxValidators } = require('./taxValidators');

const createPurchaseOrderValidate = [
    body('vendorId').isMongoId().withMessage('Vendor ID must be a mongoID').custom(value => {
        return Vendor.exists({ _id: value });
    }).withMessage('Vendor does not exist'),


    body('warehouseId').isMongoId().withMessage('Warehouse ID must be a mongoID').custom(value => {
        return Warehouse.exists({ _id: value });
    }).withMessage('Warehouse does not exist1'),

    // Optional - mirrors Sales Order's own project validation (existence-checked when provided,
    // never required for every order - see purchaseOrder.js's `project` field comment).
    body('project').optional({ nullable: true }).isMongoId().withMessage('Project ID must be a mongoID').custom(async value => {
        const exists = await Project.exists({ _id: value });
        if (!exists) throw new Error('Project does not exist');
        return true;
    }),

    // Optional - mirrors Sales Order's 'account'/'advanced_payment' cases (docs section "Payment
    // Methods Must Come From Chart of Accounts" / "Vendor Advanced Payments").
    body('paymentMethod').optional({ nullable: true }).isIn(['account', 'advanced_payment']).withMessage('Payment method must be "account" or "advanced_payment"'),
    body('paymentAccount')
        .if((value, { req }) => req.body.paymentMethod === 'account')
        .notEmpty()
        .withMessage('A payment account is required when Payment Method is "account"')
        .isMongoId()
        .withMessage('Payment account ID must be a mongoID')
        .custom(async value => {
            const account = await ChartOfAccount.findById(value);
            if (!account) throw new Error('The selected payment account does not exist');
            if (account.type !== 'asset' || !['cash', 'cash-equivalent'].includes(account.state)) {
                throw new Error('The selected payment account must be a Cash or Cash Equivalent account');
            }
            return true;
        }),

    ...vatAndWithholdingTaxValidators,

    body('items').isArray().withMessage('Items must be an array'),

    body('items.*.productId').isMongoId().withMessage('Product ID must be a mongoID'),
    body('items.*.unitPrice').isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
    body('items.*.starterQuantity').isInt({ gt: 0 }).withMessage('Quantity must be a positive integer'),
    // Optional fast pre-check - the real backstop (every service item needs one when the PO has a
    // project, and it must be a `cogs`-type account) lives in purchaseOrder.js's pre('save') hook
    // and accountingEventService.js#postPurchaseOrderJournalEntries, since both require knowing each
    // item's Product.type (service vs. physical), which isn't known at validation time here.
    body('items.*.costAccount').optional({ nullable: true }).isMongoId().withMessage('Cost account ID must be a mongoID'),

    validatorMiddleware
];

module.exports = { createPurchaseOrderValidate };