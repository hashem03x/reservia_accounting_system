const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const {
  createAccount,
  getAccounts,
  getAccount,
  updateAccount,
  deactivateAccount,
  getAccountBalanceHandler,
  getTrialBalanceHandler,
  getCogsEligibleAccounts,
  getCashEquivalentAccounts,
<<<<<<< HEAD
  getPucEligibleAccounts,
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
} = require('../../controller/accounting/chartOfAccountController');
const { createChartOfAccountValidators, updateChartOfAccountValidators } = require('../../utils/validators/chartOfAccountValidators');

router.use(authController.protect);

router.get('/trial-balance', checkUserPermissions({ resource: Resources.accounts, action: Actions.read }), getTrialBalanceHandler);
// Registered before the generic '/:id' GET so these are never matched as an :id param.
router.get('/cogs-eligible', checkUserPermissions({ resource: Resources.accounts, action: Actions.read }), getCogsEligibleAccounts);
router.get('/cash-equivalent-eligible', checkUserPermissions({ resource: Resources.accounts, action: Actions.read }), getCashEquivalentAccounts);
<<<<<<< HEAD
router.get('/puc-eligible', checkUserPermissions({ resource: Resources.accounts, action: Actions.read }), getPucEligibleAccounts);
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

router
  .route('/')
  .get(checkUserPermissions({ resource: Resources.accounts, action: Actions.read }), getAccounts)
  .post(checkUserPermissions({ resource: Resources.accounts, action: Actions.create }), createChartOfAccountValidators, createAccount);

router
  .route('/:id')
  .get(checkUserPermissions({ resource: Resources.accounts, action: Actions.read }), getAccount)
  .patch(checkUserPermissions({ resource: Resources.accounts, action: Actions.update }), updateChartOfAccountValidators, updateAccount)
  .delete(checkUserPermissions({ resource: Resources.accounts, action: Actions.delete }), deactivateAccount);

router.get('/:id/balance', checkUserPermissions({ resource: Resources.accounts, action: Actions.read }), getAccountBalanceHandler);

module.exports = router;
