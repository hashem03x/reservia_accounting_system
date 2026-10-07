const { body } = require('express-validator');

const validatorMiddleware = require('../../middleware/validatorMiddleware');
const Warehouse = require('../../models/inventory/warehouseModel');
const userModel = require('../../models/userModel');
const Project = require('../../models/project/projectModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { SalesOrderPaymentMethods } = require('../../utils/appConstant');
const { isPaymentAccountEligible } = require('../../utils/accountingConstants');
const { vatAndWithholdingTaxValidators } = require('./taxValidators');

const createCashierSalesOrderValidator = [
	body('customer').isMongoId().withMessage('Customer ID must be a mongoID').custom(async value => {
		const exists = await userModel.exists({ _id: value });
		if (!exists) throw new Error('Customer does not exist');
		return true;
	}),

	body('warehouse')
		.isMongoId().withMessage('Warehouse ID must be a mongoID').custom(async value => {
			const exists = await Warehouse.exists({ _id: value });
			if (!exists) throw new Error('Warehouse does not exist');
			return true;
		}),

	body('isPrepaid').notEmpty().withMessage('isPrepaid is required').isBoolean().withMessage('isPrepaid must be a boolean'),

	// Optional, defaults to the schema's `false`/`0` (salesOrderModel.js) when omitted - existing
	// callers (real cashiers) never send either field and are unaffected.
	body('isCodOrder').optional().isBoolean().withMessage('isCodOrder must be a boolean'),
	body('paidAmount').optional().isFloat({ min: 0 }).withMessage('paidAmount must be a non-negative number'),

	body('items').isArray().withMessage('Items must be an array'),

	body('items.*.product').isMongoId().withMessage('Product ID must be a mongoID'),
	body('items.*.unitPrice').isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
	body('items.*.starterQuantity').isInt({ gt: 0 }).withMessage('Quantity must be a positive integer'),

	body('shippingCost').optional().isFloat({ gt: 0 }).withMessage('Shipping cost must be a positive number'),

	...vatAndWithholdingTaxValidators,

	// Optional - existing callers that never send this are completely unaffected (see
	// salesOrderModel.js's `paymentMethod` field comment). A discriminator ('account' or
	// 'advanced_payment'), not a concrete method - see appConstant.js#SalesOrderPaymentMethods.
	body('paymentMethod').optional({ nullable: true }).isIn(SalesOrderPaymentMethods).withMessage(`Payment method must be one of: ${SalesOrderPaymentMethods.join(', ')}`),

	// Required only when paymentMethod === 'account' (docs section "Payment Methods Must Come From
	// Chart of Accounts") - fast pre-check; the model's own pre('save') hook
	// (salesOrderModel.js) re-verifies this against the live account no matter which code path
	// writes to the document, and is the real backstop.
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

	// Project is mandatory for every new Sales Order (docs section "Sales Orders - Project is
	// Required") - this is the fast pre-check; the model's own pre('validate') hook
	// (salesOrderModel.js), scoped to `isNew`, is the real backstop so a direct API call can never
	// bypass it. Scoped to creation only - there is no Sales Order update endpoint, so this never
	// applies to a historical order being re-saved for an unrelated reason (cancel/deliver/return).
	body('project')
		.notEmpty()
		.withMessage('A project is required to create a Sales Order')
		.isMongoId()
		.withMessage('Project ID must be a mongoID')
		.custom(async (value, { req }) => {
			const project = await Project.findById(value);
			if (!project) throw new Error('Project not found');
			// When paying via Advanced Payment, the project must also belong to the selected
			// customer (docs section "Advanced Payment must only appear when appropriate") - the
			// actual live-balance verification happens server-side in
			// salesOrderCreation.service.js, which is the real backstop for that part.
			if (req.body.paymentMethod === 'advanced_payment') {
				// Project.findById() runs Project's own populate hook, turning `.customer` into
				// `{_id, name, ...}` - see advancedPaymentModel.js's identical comment.
				const projectCustomerId = project.customer?._id || project.customer;
				if (!projectCustomerId || projectCustomerId.toString() !== String(req.body.customer)) {
					throw new Error('This project does not belong to the selected customer');
				}
			}
			return true;
		}),

	validatorMiddleware
];

module.exports = { createCashierSalesOrderValidator };