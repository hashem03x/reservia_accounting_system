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
} = require('../../controller/accounting/chartOfAccountController');
const { createChartOfAccountValidators, updateChartOfAccountValidators } = require('../../utils/validators/chartOfAccountValidators');

router.use(authController.protect);

router.get('/trial-balance', checkUserPermissions({ resource: Resources.accounts, action: Actions.read }), getTrialBalanceHandler);

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
