const express = require('express');

const router = express.Router();
const {
  createFixedAsset,
  updateFixedAsset,
  getFixedAssets,
  getFixedAsset,
  getFixedAssetAccountOptions,
  runDepreciation,
  getFixedAssetPayments,
  recordFixedAssetPayment,
} = require('../controller/fixedAssetController');
const authController = require('../controller/user/authController');

const { checkUserPermissions } = require('../middleware/hasPermission');
const { Resources, Actions } = require('../utils/appConstant');
const { createFixedAssetValidators, updateFixedAssetValidators, runDepreciationValidators, recordFixedAssetPaymentValidators } = require('../utils/validators/fixedAssetValidators');

// All routes require authentication
router.use(authController.protect);

// Registered before '/:id' so these paths are never matched as an id.
router.get('/account-options', checkUserPermissions({ resource: Resources.expenses, action: Actions.read }), getFixedAssetAccountOptions);
router.post('/depreciation/run', checkUserPermissions({ resource: Resources.expenses, action: Actions.create }), runDepreciationValidators, runDepreciation);

router
  .route('/')
  .post(checkUserPermissions({ resource: Resources.expenses, action: Actions.create }), createFixedAssetValidators, createFixedAsset)
  .get(checkUserPermissions({ resource: Resources.expenses, action: Actions.read }), getFixedAssets);

router
  .route('/:id')
  .get(checkUserPermissions({ resource: Resources.expenses, action: Actions.read }), getFixedAsset)
  .patch(checkUserPermissions({ resource: Resources.expenses, action: Actions.create }), updateFixedAssetValidators, updateFixedAsset);

router
  .route('/:id/payments')
  .get(checkUserPermissions({ resource: Resources.expenses, action: Actions.read }), getFixedAssetPayments)
  .post(checkUserPermissions({ resource: Resources.expenses, action: Actions.create }), recordFixedAssetPaymentValidators, recordFixedAssetPayment);

module.exports = router;
