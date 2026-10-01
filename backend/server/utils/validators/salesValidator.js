const { body } = require('express-validator');

const validatorMiddleware = require('../../middleware/validatorMiddleware');
const Warehouse = require('../../models/inventory/warehouseModel');
const userModel = require('../../models/userModel');

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

	validatorMiddleware
];

module.exports = { createCashierSalesOrderValidator };