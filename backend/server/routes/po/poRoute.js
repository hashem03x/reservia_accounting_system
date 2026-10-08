const { Router } = require('express');

const authController = require('../../controller/user/authController');
const { createPurchaseOrderValidate } = require('../../utils/validators/poValidator');
const { createPO, getAllPO, updatePO, getPO, deletePO, getPOByCode } = require('../../controller/PO/purchaseOrderController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const { uploadSingleDocument } = require('../../middleware/documentUploadMiddleware');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const { uploadOrderDocument, deleteOrderDocument } = require('../../controller/orderDocumentController').createOrderDocumentHandlers(PurchaseOrder, 'Purchase order');

const router = Router();

router.use(authController.protect);

router.use('/returns', require('./poReturnRoute'));

router
  .route('/')
  .post(checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.create }), createPurchaseOrderValidate, createPO)
  .get(checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.read }), getAllPO);

router.route('/:id').get(checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.read }), getPO);

// Get purchase order by code
router.route('/code/:code').get(checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.read }), getPOByCode);

// PDF documents attached after the order was created (same upload pipeline/rules as Customer and
// Vendor documents). Managing them needs the same permission as editing the order.
const canUpdatePurchaseOrders = checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.update });
router.post('/:id/documents', canUpdatePurchaseOrders, uploadSingleDocument('purchase-orders', 'document'), uploadOrderDocument);
router.delete('/:id/documents/:documentId', canUpdatePurchaseOrders, deleteOrderDocument);

module.exports = router;
