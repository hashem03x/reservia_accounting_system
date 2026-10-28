const { Router } = require('express');
const { formatGuideHandler } = require('../../utils/csvImport/formatGuide');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const { previewProducts, commitProducts, sampleProducts } = require('../../controller/import/productImportController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

router.use(authController.protect);

// Same permission the real manual "Create Product" endpoint uses (routes/inventory/productRoute.js)
// - an import must require exactly the same permission as the equivalent manual action.
router.get('/sample', checkUserPermissions({ resource: Resources.products, action: Actions.read }), sampleProducts);
// Format guide of every column (utils/csvImport/formatGuide.js) - JSON, or ?format=csv to download.
router.get('/format-guide', checkUserPermissions({ resource: Resources.products, action: Actions.read }), formatGuideHandler(require('../../utils/validators/import/productImportSchema'), 'reservia-products-format-guide.csv'));
router.post('/preview', checkUserPermissions({ resource: Resources.products, action: Actions.create }), uploadTempFile('file'), previewProducts);
router.post('/commit', checkUserPermissions({ resource: Resources.products, action: Actions.create }), uploadTempFile('file'), commitProducts);

module.exports = router;
