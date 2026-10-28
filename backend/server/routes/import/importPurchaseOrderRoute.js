const { Router } = require('express');
const { formatGuideHandler } = require('../../utils/csvImport/formatGuide');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const { previewPurchaseOrders, commitPurchaseOrders, samplePurchaseOrders } = require('../../controller/import/poImportController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

router.use(authController.protect);

// Fixed from `Resources.purchaseOrders` (the previous version's permission resource - the
// resource for the OLD pre-rename concept, now labeled "Purchase Invoices") - this importer
// creates the NEW "Purchase Order" document (internally Requisition), gated by the same
// `Resources.purchaseRequisitions` permission the manual create endpoint uses
// (routes/vendor/requisitionRoute.js).
router.get('/sample', checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.read }), samplePurchaseOrders);
// Format guide of every column (utils/csvImport/formatGuide.js) - JSON, or ?format=csv to download.
router.get('/format-guide', checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.read }), formatGuideHandler(require('../../utils/validators/import/poImportSchema'), 'reservia-purchase-orders-format-guide.csv'));
router.post('/preview', checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.create }), uploadTempFile('file'), previewPurchaseOrders);
router.post('/commit', checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.create }), uploadTempFile('file'), commitPurchaseOrders);

module.exports = router;
