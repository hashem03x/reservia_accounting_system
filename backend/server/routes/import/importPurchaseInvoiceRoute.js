const { Router } = require('express');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const { previewPurchaseInvoices, commitPurchaseInvoices, samplePurchaseInvoices } = require('../../controller/import/poInvoiceImportController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

router.use(authController.protect);

// Same permission the real manual "Create Purchase Invoice" endpoint uses
// (routes/po/poRoute.js) - an import must require exactly the same permission as the equivalent
// manual action.
router.get('/sample', checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.read }), samplePurchaseInvoices);
router.post('/preview', checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.create }), uploadTempFile('file'), previewPurchaseInvoices);
router.post('/commit', checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.create }), uploadTempFile('file'), commitPurchaseInvoices);

module.exports = router;
