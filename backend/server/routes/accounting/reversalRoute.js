const express = require('express');
const { body, param, query } = require('express-validator');

const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { Resources, Actions } = require('../../utils/appConstant');
const { returnSalesOrder, returnPurchaseOrder, reversePayment, reverseSettlement, listReversals } = require('../../controller/accounting/reversalController');

const router = express.Router();
router.use(authController.protect);

// Each operation needs the permission of the document it changes; reversing a payment posts
// reversing journal entries, so it needs the journal entries update permission (as reversing the
// payment's entry from Journal Entries does).
const can = (resource, action) => checkUserPermissions({ resource, action });

const common = [
  param('id').isMongoId().withMessage('Invalid id'),
  body('reason').isString().withMessage('A reason is required').bail().trim().notEmpty().withMessage('A reason is required').isLength({ max: 1000 }),
  body('idempotencyKey').isString().withMessage('A request key is required').bail().trim().notEmpty().isLength({ max: 200 }),
  body('date').optional({ nullable: true }).isISO8601().withMessage('Invalid date'),
];
const returnRules = [
  ...common,
  body('items').isArray({ min: 1, max: 500 }).withMessage('Choose at least one item to return'),
  body('items.*.productId').isMongoId().withMessage('Invalid product id'),
  body('items.*.quantity').isFloat({ gt: 0 }).withMessage('Return quantities must be greater than zero'),
  body('warehouseId').optional({ nullable: true }).isMongoId().withMessage('Invalid warehouse id'),
  body('refund.paymentAccount').optional({ nullable: true }).isMongoId().withMessage('Invalid refund account'),
  validatorMiddleware,
];

router.post('/sales-orders/:id/returns', can(Resources.salesOrders, Actions.update), returnRules, returnSalesOrder);
router.post('/purchase-orders/:id/returns', can(Resources.purchaseOrders, Actions.update), returnRules, returnPurchaseOrder);
router.post('/payments/:id', can(Resources.journalEntries, Actions.update), [...common, validatorMiddleware], reversePayment);
router.post(
  '/advanced-payments/:id/settlements',
  can(Resources.advancedPayments, Actions.update),
  [...common, body(['salesOrderId', 'purchaseOrderId', 'paymentId']).optional({ nullable: true }).isMongoId().withMessage('Invalid id'), validatorMiddleware],
  reverseSettlement
);

// History: readable with the read permission of the document asked about.
const historyGuard = (req, res, next) => {
  const resource = req.query.salesOrder ? Resources.salesOrders : req.query.purchaseOrder ? Resources.purchaseOrders : req.query.advancedPayment ? Resources.advancedPayments : Resources.journalEntries;
  return checkUserPermissions({ resource, action: Actions.read })(req, res, next);
};
router.get('/', [query(['salesOrder', 'purchaseOrder', 'payment', 'advancedPayment']).optional().isMongoId().withMessage('Invalid id'), validatorMiddleware], historyGuard, listReversals);

module.exports = router;
