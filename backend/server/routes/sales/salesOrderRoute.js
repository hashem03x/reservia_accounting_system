const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');
const { checkUserPermissions } = require('../../middleware/hasPermission');

const {
  createCashierSalesOrder,
  getAllSalesOrders,
  getSalesOrder,
  payShippingCost,
  getSalesOrderByCode,
  updateOrderToDelivered,
  returnSalesOrderItemAdmin,
  cancelOrder,
  confirmCodOrder,
} = require('../../controller/sales/salesOrderController');

const { createCashierSalesOrderValidator } = require('../../utils/validators/salesValidator');

router.use(authController.protect);

router.use('/returns', require('./salesOrderReturnRoute'));

// ERP CHG-03: "available in project stock" for the sales form lines - before /:id so it is never read as an id.
router.get(
  '/project-stock',
  checkUserPermissions({ resource: Resources.salesOrders, action: Actions.read }),
  require('express-async-handler')(async (req, res) => {
    const { projectStockForForm } = require('../../services/inventory/projectStockService'); // eslint-disable-line global-require
    const products = String(req.query.products || '').split(',').filter(Boolean).slice(0, 200);
    res.status(200).json(require('../../utils/apiResponse')('Project stock', true, await projectStockForForm(req.query.project, products)));
  })
);

// Create sales order
router.post('/', checkUserPermissions({ resource: Resources.salesOrders, action: Actions.create }), createCashierSalesOrderValidator, createCashierSalesOrder);

// Get all sales orders
router.get('/', checkUserPermissions({ resource: Resources.salesOrders, action: Actions.read }), getAllSalesOrders);

// Get single sales order
router.get('/:id', getSalesOrder);

// Get order by code
router.get('/code/:code', checkUserPermissions({ resource: Resources.salesOrders, action: Actions.read }), getSalesOrderByCode);

// Update shipping cost payment
router.patch('/:id/pay-shipping-cost', checkUserPermissions({ resource: Resources.salesOrders, action: Actions.update }), payShippingCost);

// Update order to delivered
router.put('/:id/deliver', checkUserPermissions({ resource: Resources.salesOrders, action: Actions.update }), updateOrderToDelivered);

// Process returned items on a sales order (restock + refund payment)
router.put('/:salesOrderId/cancel-items-admin', checkUserPermissions({ resource: Resources.salesOrders, action: Actions.update }), returnSalesOrderItemAdmin);

// Cancel a sales order
router.put('/:id/cancel', cancelOrder);

// Confirm a COD (cash on delivery) order
router.put('/:id/confirm-cod', confirmCodOrder);

module.exports = router;
