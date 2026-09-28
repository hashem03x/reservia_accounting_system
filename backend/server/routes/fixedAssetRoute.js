const express = require('express');
const router = express.Router();
const { createFixedAsset, updateFixedAsset, sellFixedAsset, getFixedAssets } = require('../controller/fixedAssetController');
const authController = require('../controller/user/authController');

const { checkUserPermissions } = require('../middleware/hasPermission');
const { Resources, Actions } = require('../utils/appConstant');

// All routes require authentication
router.use(authController.protect);

// Create new fixed asset
router.post('/', checkUserPermissions({ resource: Resources.expenses, action: Actions.create }), createFixedAsset);

// Get all fixed assets
router.get('/', checkUserPermissions({ resource: Resources.expenses, action: Actions.read }), getFixedAssets);

// Update fixed asset
router.patch('/:id', checkUserPermissions({ resource: Resources.expenses, action: Actions.create }), updateFixedAsset);

// Sell fixed asset
router.delete('/sell/:id', checkUserPermissions({ resource: Resources.expenses, action: Actions.create }), sellFixedAsset);

module.exports = router;

/**
 * creata a new asset :
   endpoint : /fixed-assets
   body :
   {
    name : String,
    bookValue : Number,
    fairValue : Number,
    warehouseId : String
   }

   update an asset :
   endpoint : /fixed-assets/:id
   body :
   {
    name : String,
    fairValue : Number,
   }
   
   sell an asset :
   endpoint : /fixed-assets/sell/:id
   body :
   {
   }
 */
