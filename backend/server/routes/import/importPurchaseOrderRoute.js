const { Router } = require('express');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const { importPurchaseOrderValidator } = require('../../utils/validators/import/importPurchaseOrderValidator');
const { importPurchaseOrder } = require('../../controller/import/importPurchaseOrderController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

/**
 * @route POST /api/v1/import/purchase-orders
 * @desc Import purchase orders from CSV/Excel file
 * @access Private (Admin/Manager)
 */
router.post(
  '/',
  authController.protect,
  checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.create }),
  uploadTempFile('file'),
  importPurchaseOrderValidator,
  importPurchaseOrder
);

module.exports = router;
