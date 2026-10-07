const express = require('express');

const router = express.Router();

const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');
const { checkUserPermissions } = require('../../middleware/hasPermission');

const { createPurchasePaymentValidator, createSalesPaymentValidator } = require('../../utils/validators/paymentValidator');
const { createPurchasePayment, createSalesPayment, getAllPayments, getPayment, exportPayments } = require('../../controller/PO/PaymentController');

router.use(authController.protect);

router.route('/purchase').post(checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.update }), createPurchasePaymentValidator, createPurchasePayment);

router.route('/sales').post(checkUserPermissions({ resource: Resources.salesOrders, action: Actions.update }), createSalesPaymentValidator, createSalesPayment);

router.route('/').get(getAllPayments);
router.route('/export').get(exportPayments);

router.route('/:id').get(getPayment);

module.exports = router;
