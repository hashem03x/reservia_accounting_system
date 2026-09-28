const { Router } = require('express');
const router = Router({ mergeParams: true });
const authController = require('../../controller/user/authController');

const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');

const { getVariantByCode, getOrdersByVariantCode, getVariantsWithPopulatedProducts, getVariantHistoryByCode } = require('../../controller/inventory/varaintController');

router.route('/:code').get(getVariantByCode);
router.route('/history/:code').get(getVariantHistoryByCode);
router.route('/').get(getVariantsWithPopulatedProducts);

// transactions
router.use(authController.protect);
router.route('/transactions/:variantCode').get(checkUserPermissions({ resource: Resources.variants, action: Actions.read }), getOrdersByVariantCode);

module.exports = router;
