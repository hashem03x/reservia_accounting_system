const { Router } = require('express');
const { uploadTempFile } = require('../../middleware/uploadImageMiddleware');
const { importProductAndVariant } = require('../../controller/import/importProductController');
const { importProductAndVariantValidator } = require('../../utils/validators/import/importProductAndVariantValidator');
const { parseCsv } = require('../../controller/import/importProductController');
const mongoose = require('mongoose');
const Product = require('../../models/inventory/productModel');
const Variant = require('../../models/inventory/variantModel');
const Warehouse = require('../../models/inventory/warehouseModel');
const fs = require('fs').promises;
const ApiError = require('../../utils/apiError');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const authController = require('../../controller/user/authController');
const { Resources, Actions } = require('../../utils/appConstant');

const router = Router();

router.post(
  '/',
  authController.protect,
  checkUserPermissions({ resource: Resources.products, action: Actions.create }),
  uploadTempFile('file'),
  importProductAndVariantValidator,
  importProductAndVariant
);

module.exports = router;
