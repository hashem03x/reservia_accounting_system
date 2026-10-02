const { body } = require('express-validator');

const validatorMiddleware = require('../../middleware/validatorMiddleware');
const Warehouse = require('../../models/inventory/warehouseModel');
const userModel = require('../../models/userModel');
const Project = require('../../models/project/projectModel');
const { SalesOrderPaymentMethods } = require('../../utils/appConstant');

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

	// Optional - existing callers that never send this are completely unaffected (see
	// salesOrderModel.js's `paymentMethod` field comment).
	body('paymentMethod').optional({ nullable: true }).isIn(SalesOrderPaymentMethods).withMessage(`Payment method must be one of: ${SalesOrderPaymentMethods.join(', ')}`),

	// Required only when paymentMethod is 'advanced_payment' (docs section "Advanced Payment must
	// only appear when appropriate") - this is a fast pre-check only; the actual
	// project-belongs-to-customer verification against the live Advanced Payment balance happens
	// server-side in salesOrderCreation.service.js, which is the real backstop.
	body('project')
		.if((value, { req }) => req.body.paymentMethod === 'advanced_payment')
		.notEmpty()
		.withMessage('A project must be selected to use Advanced Payment')
		.isMongoId()
		.withMessage('Project ID must be a mongoID')
		.custom(async (value, { req }) => {
			const project = await Project.findById(value);
			if (!project) throw new Error('Project not found');
			// Project.findById() runs Project's own populate hook, turning `.customer` into
			// `{_id, name, ...}` - see advancedPaymentModel.js's identical comment.
			const projectCustomerId = project.customer?._id || project.customer;
			if (!projectCustomerId || projectCustomerId.toString() !== String(req.body.customer)) {
				throw new Error('This project does not belong to the selected customer');
			}
			return true;
		}),
	body('project').if((value, { req }) => req.body.paymentMethod !== 'advanced_payment' && value).isMongoId().withMessage('Project ID must be a mongoID'),

	validatorMiddleware
];

module.exports = { createCashierSalesOrderValidator };