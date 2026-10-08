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
const { uploadSingleDocument } = require('../../middleware/documentUploadMiddleware');
const SalesOrder = require('../../models/sales/salesOrderModel');
const { uploadOrderDocument, deleteOrderDocument } = require('../../controller/orderDocumentController').createOrderDocumentHandlers(SalesOrder, 'Sales order');

router.use(authController.protect);

router.use('/returns', require('./salesOrderReturnRoute'));

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

// PDF documents attached after the order was created (same upload pipeline/rules as Customer and
// Vendor documents). Managing them needs the same permission as editing the order.
const canUpdateSalesOrders = checkUserPermissions({ resource: Resources.salesOrders, action: Actions.update });
router.post('/:id/documents', canUpdateSalesOrders, uploadSingleDocument('sales-orders', 'document'), uploadOrderDocument);
router.delete('/:id/documents/:documentId', canUpdateSalesOrders, deleteOrderDocument);

module.exports = router;
