const { Router } = require('express');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const { previewCustomers, commitCustomers, sampleCustomers } = require('../../controller/import/customerImportController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

router.use(authController.protect);

// Fixed from `Resources.users` (the previous version's permission resource, inconsistent with the
// real manual "create customer" endpoint - routes/user/customerRoute.js - which has always used
// `Resources.customers`) - an import must require exactly the same permission as the equivalent
// manual action.
router.get('/sample', checkUserPermissions({ resource: Resources.customers, action: Actions.read }), sampleCustomers);
router.post('/preview', checkUserPermissions({ resource: Resources.customers, action: Actions.create }), uploadTempFile('file'), previewCustomers);
router.post('/commit', checkUserPermissions({ resource: Resources.customers, action: Actions.create }), uploadTempFile('file'), commitCustomers);

module.exports = router;
