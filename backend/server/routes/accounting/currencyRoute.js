const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const { createCurrency, getCurrencies, getCurrency, updateCurrency, deactivateCurrency, activateCurrency, getCurrencyUsage } = require('../../controller/accounting/currencyController');
const { createCurrencyValidators, updateCurrencyValidators } = require('../../utils/validators/currencyValidators');

// Permission resource is `currencyManagement` - deliberately NOT the pre-existing `currencies`
// resource (declared in utils/appConstant.js's frontend counterpart, resources.ts, but never wired
// to any backend permission or route - it is only consumed, unguarded beyond role, by the existing
// unrelated warehouse petty-cash page at /admin/currencies, pages/admin/currencies/index.tsx).
// Reusing that name here would retroactively start enforcing a real permission check on that
// existing page for non-admin roles, changing its current behavior - exactly what this task's
// "do not bypass existing authentication/authorization" rule (read the other way: do not
// *introduce* a new one by accident) warns against.
router.use(authController.protect);

router
  .route('/')
  .get(checkUserPermissions({ resource: Resources.currencyManagement, action: Actions.read }), getCurrencies)
  .post(checkUserPermissions({ resource: Resources.currencyManagement, action: Actions.create }), createCurrencyValidators, createCurrency);

router
  .route('/:id')
  .get(checkUserPermissions({ resource: Resources.currencyManagement, action: Actions.read }), getCurrency)
  .patch(checkUserPermissions({ resource: Resources.currencyManagement, action: Actions.update }), updateCurrencyValidators, updateCurrency)
  .delete(checkUserPermissions({ resource: Resources.currencyManagement, action: Actions.delete }), deactivateCurrency);

router.patch('/:id/activate', checkUserPermissions({ resource: Resources.currencyManagement, action: Actions.update }), activateCurrency);
router.get('/:id/usage', checkUserPermissions({ resource: Resources.currencyManagement, action: Actions.read }), getCurrencyUsage);

module.exports = router;
