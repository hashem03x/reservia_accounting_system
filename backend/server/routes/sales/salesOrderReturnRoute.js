const { Router } = require('express');
const authController = require('../../controller/user/authController');
const { createReturnValidate, returnAllItemsValidate } = require('../../utils/validators/salesReturnValidator');
const { returnSalesOrderItem, getAllReturns, getReturn, returnAllSalesOrderItems } = require('../../controller/sales/salesOrderReturnController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

router.use(authController.protect);

router
  .route('/')
  .post(checkUserPermissions({ resource: Resources.salesOrders, action: Actions.update }), createReturnValidate, returnSalesOrderItem)
  .get(getAllReturns);

router.route('/return-all').post(checkUserPermissions({ resource: Resources.salesOrders, action: Actions.update }), returnAllItemsValidate, returnAllSalesOrderItems);

router.route('/:id').get(getReturn);

module.exports = router;
