const express = require('express');

const router = express.Router();

const { createCoupon, deleteCoupon, getCoupon, getCoupons, updateCoupon } = require('../controller/couponController');

const authController = require('../controller/user/authController');
const { checkUserPermissions } = require('../middleware/hasPermission');
const { Resources, Actions } = require('../utils/appConstant');

router.use(
    authController.protect,
    //  authController.allowedTo('admin', 'manager')
    );

router.route('/')
.get(
    checkUserPermissions({resource: Resources.coupons, action:Actions.read}),
    getCoupons)
.post(
    checkUserPermissions({resource: Resources.coupons, action:Actions.create}),
    createCoupon);
router.route('/:id')
.get(
    checkUserPermissions({resource: Resources.coupons, action:Actions.read} ),
    getCoupon
)
.put(
    checkUserPermissions({resource: Resources.coupons, action:Actions.update}),
    updateCoupon)
.delete(
    checkUserPermissions({resource: Resources.coupons, action: Actions.delete}),
    deleteCoupon);

module.exports = router;
