const {Router} = require('express');

const router = Router();

const {
     uploadProductFile,
     uploadVariantFile,
     uploadFile,
     exportController
    } = require('../../controller/inventory/csvController');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');

// Was mounted with no auth at all - /upload bulk-creates Product documents straight from an
// uploaded CSV/XLSX with no login required. Same protect() + checkUserPermissions(Resources.
// products) pattern productRoute.js already uses for every other product-mutating route.
router.use(authController.protect);

// router.post('/uploadProductFile', uploadProductFile);


// router.post('/uploadVariantFile', uploadVariantFile);

router.post('/upload', checkUserPermissions({ resource: Resources.products, action: Actions.create }), uploadTempFile('file'), uploadFile);
router.get('/export', checkUserPermissions({ resource: Resources.products, action: Actions.read }), exportController)


module.exports = router;