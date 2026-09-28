const { Router } = require('express');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const { importVendors } = require('../../controller/import/importVendorsController');
const { importVendorsValidator } = require('../../utils/validators/import/importVendorsValidator');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');
const userModel = require('../../models/userModel');

const router = Router();

router.post(
  '/',
  authController.protect,
  checkUserPermissions({ resource: Resources.vendors, action: Actions.create }),
  uploadTempFile('file'),
  importVendorsValidator,
  importVendors
);

module.exports = router;
