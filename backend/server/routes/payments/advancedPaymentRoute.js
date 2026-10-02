const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const {
  createAdvancedPayment,
  getAdvancedPayments,
  getAdvancedPayment,
  getAvailableAdvancedPayment,
  cancelAdvancedPayment,
} = require('../../controller/payments/advancedPaymentController');
const { createAdvancedPaymentValidators } = require('../../utils/validators/advancedPaymentValidators');

router.use(authController.protect);

// Registered before '/:id' so "available" is never matched as an :id param.
router.get('/available', checkUserPermissions({ resource: Resources.advancedPayments, action: Actions.read }), getAvailableAdvancedPayment);

router
  .route('/')
  .get(checkUserPermissions({ resource: Resources.advancedPayments, action: Actions.read }), getAdvancedPayments)
  .post(checkUserPermissions({ resource: Resources.advancedPayments, action: Actions.create }), createAdvancedPaymentValidators, createAdvancedPayment);

router.get('/:id', checkUserPermissions({ resource: Resources.advancedPayments, action: Actions.read }), getAdvancedPayment);

router.patch('/:id/cancel', checkUserPermissions({ resource: Resources.advancedPayments, action: Actions.update }), cancelAdvancedPayment);

module.exports = router;
