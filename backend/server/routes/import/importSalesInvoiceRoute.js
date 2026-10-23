const { Router } = require('express');
const { formatGuideHandler } = require('../../utils/csvImport/formatGuide');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const { previewSalesInvoices, commitSalesInvoices, sampleSalesInvoices } = require('../../controller/import/salesInvoiceImportController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

router.use(authController.protect);

// Same permission the real manual "Create Sales Invoice" endpoint uses
// (routes/sales/salesOrderRoute.js) - an import must require exactly the same permission as the
// equivalent manual action.
router.get('/sample', checkUserPermissions({ resource: Resources.salesOrders, action: Actions.read }), sampleSalesInvoices);
// Format guide of every column (utils/csvImport/formatGuide.js) - JSON, or ?format=csv to download.
router.get('/format-guide', checkUserPermissions({ resource: Resources.salesOrders, action: Actions.read }), formatGuideHandler(require('../../utils/validators/import/salesInvoiceImportSchema'), 'reservia-sales-invoices-format-guide.csv'));
router.post('/preview', checkUserPermissions({ resource: Resources.salesOrders, action: Actions.create }), uploadTempFile('file'), previewSalesInvoices);
router.post('/commit', checkUserPermissions({ resource: Resources.salesOrders, action: Actions.create }), uploadTempFile('file'), commitSalesInvoices);

module.exports = router;
