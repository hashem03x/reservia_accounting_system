const { body } = require('express-validator');
const mongoose = require('mongoose');
const Product = require('../../models/inventory/productModel');

const validatorMiddleware = require('../../middleware/validatorMiddleware');
const Vendor = require('../../models/vendor/vendor');
const Warehouse = require('../../models/inventory/warehouseModel');
const Project = require('../../models/project/projectModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { vatAndWithholdingTaxValidators } = require('./taxValidators');
const { isPaymentAccountEligible } = require('../../utils/accountingConstants');

const createPurchaseOrderValidate = [
    body('vendorId').isMongoId().withMessage('Vendor ID must be a mongoID').custom(value => {
        return Vendor.exists({ _id: value });
    }).withMessage('Vendor does not exist'),


    body('warehouseId').isMongoId().withMessage('Warehouse ID must be a mongoID').custom(value => {
        return Warehouse.exists({ _id: value });
    }).withMessage('Warehouse does not exist1'),

    // Project is mandatory for every new Purchase Order (docs section "Purchase Orders - Project is
    // Required") - fast pre-check; the model's own pre('save') hook (purchaseOrder.js), scoped to
    // `isNew`, is the real backstop. Scoped to creation only - there is no Purchase Order update
    // endpoint, so this never applies to a historical order being re-saved for an unrelated reason.
    body('project').notEmpty().withMessage('A project is required to create a Purchase Order').isMongoId().withMessage('Project ID must be a mongoID').custom(async value => {
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
            if (!isPaymentAccountEligible(account)) {
                throw new Error('The selected payment account must be a Cash or Cash Equivalent account');
            }
            return true;
        }),

    ...vatAndWithholdingTaxValidators,

    body('items').isArray().withMessage('Items must be an array'),

    body('items.*.productId').isMongoId().withMessage('Product ID must be a mongoID'),
    body('items.*.unitPrice').isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
    body('items.*.starterQuantity').isInt({ gt: 0 }).withMessage('Quantity must be a positive integer'),
    // Legacy field - no longer used for accounting (a service line always posts to the Service's own
    // PUC account). Still format-checked so a stray value can't be junk.
    body('items.*.costAccount').optional({ nullable: true }).isMongoId().withMessage('Cost account ID must be a mongoID'),
    // Fast pre-check: every SERVICE being purchased must have its PUC account configured (see
    // productModel.js#pucAccount). The real backstop - which also re-checks the account is still
    // eligible - is accountingEventService.js#postPurchaseOrderJournalEntries, inside the PO's own
    // transaction; this only gives the user a clear error before anything is touched.
    body('items').custom(async items => {
        const ids = (items || []).map(i => i?.productId).filter(id => mongoose.Types.ObjectId.isValid(id));
        if (!ids.length) return true;
        const services = await Product.find({ _id: { $in: ids }, type: 'service' }).select('title pucAccount').lean();
        const missing = services.filter(s => !s.pucAccount);
        if (missing.length) {
            const names = missing.map(s => s.title?.en || s.title?.ar || s._id).join(', ');
            throw new Error(`The following service(s) have no PUC account configured: ${names}. Set a PUC account on each service before purchasing it.`);
        }
        return true;
    }),

    validatorMiddleware
];

module.exports = { createPurchaseOrderValidate };