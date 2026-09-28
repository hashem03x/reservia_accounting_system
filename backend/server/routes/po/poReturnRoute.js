const { Router } = require('express');
const authController = require('../../controller/user/authController');
const { createReturnValidate } = require('../../utils/validators/poReturnValidator');
const { returnPurchaseOrderItem, getAllReturns, getReturn } = require('../../controller/PO/purchaseOrderReturnController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

router.use(authController.protect);

router
  .route('/')
  .post(checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.update }), createReturnValidate, returnPurchaseOrderItem)
  .get(checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.read }), getAllReturns);

router.route('/:id').get(checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.read }), getReturn);

module.exports = router;
