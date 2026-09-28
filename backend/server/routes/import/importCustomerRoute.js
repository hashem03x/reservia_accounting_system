const { Router } = require('express');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const { importCustomers } = require('../../controller/import/importCustomerController');
const { importCustomerValidator } = require('../../utils/validators/import/importCustomerValidator');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

router.post(
  '/',
  authController.protect,
  checkUserPermissions({ resource: Resources.users, action: Actions.create }),
  uploadTempFile('file'),
  importCustomerValidator,
  importCustomers
);

module.exports = router;
