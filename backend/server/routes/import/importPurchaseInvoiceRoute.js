const { Router } = require('express');
const { formatGuideHandler } = require('../../utils/csvImport/formatGuide');
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
// Format guide of every column (utils/csvImport/formatGuide.js) - JSON, or ?format=csv to download.
router.get('/format-guide', checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.read }), formatGuideHandler(require('../../utils/validators/import/poInvoiceImportSchema'), 'reservia-purchase-invoices-format-guide.csv'));
router.post('/preview', checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.create }), uploadTempFile('file'), previewPurchaseInvoices);
router.post('/commit', checkUserPermissions({ resource: Resources.purchaseOrders, action: Actions.create }), uploadTempFile('file'), commitPurchaseInvoices);

module.exports = router;
