const { Router } = require('express');
const { formatGuideHandler } = require('../../utils/csvImport/formatGuide');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const { previewVendors, commitVendors, sampleVendors } = require('../../controller/import/vendorImportController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

router.use(authController.protect);

router.get('/sample', checkUserPermissions({ resource: Resources.vendors, action: Actions.read }), sampleVendors);
// Format guide of every column (utils/csvImport/formatGuide.js) - JSON, or ?format=csv to download.
router.get('/format-guide', checkUserPermissions({ resource: Resources.vendors, action: Actions.read }), formatGuideHandler(require('../../utils/validators/import/vendorImportSchema'), 'reservia-vendors-format-guide.csv'));
router.post('/preview', checkUserPermissions({ resource: Resources.vendors, action: Actions.create }), uploadTempFile('file'), previewVendors);
router.post('/commit', checkUserPermissions({ resource: Resources.vendors, action: Actions.create }), uploadTempFile('file'), commitVendors);

module.exports = router;
