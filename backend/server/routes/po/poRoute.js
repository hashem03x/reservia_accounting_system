const { Router } = require('express');

const authController = require('../../controller/user/authController');
const { createPurchaseOrderValidate } = require('../../utils/validators/poValidator');
const { createPO, getAllPO, updatePO, getPO, deletePO, getPOByCode } = require('../../controller/PO/purchaseOrderController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');

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

module.exports = router;
