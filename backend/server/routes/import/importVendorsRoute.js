const { Router } = require('express');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const { previewVendors, commitVendors, sampleVendors } = require('../../controller/import/vendorImportController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

router.use(authController.protect);

router.get('/sample', checkUserPermissions({ resource: Resources.vendors, action: Actions.read }), sampleVendors);
router.post('/preview', checkUserPermissions({ resource: Resources.vendors, action: Actions.create }), uploadTempFile('file'), previewVendors);
router.post('/commit', checkUserPermissions({ resource: Resources.vendors, action: Actions.create }), uploadTempFile('file'), commitVendors);

module.exports = router;
