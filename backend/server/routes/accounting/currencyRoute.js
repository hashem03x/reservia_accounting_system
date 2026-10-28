const express = require('express');
<<<<<<< HEAD
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
=======

const authController = require('../../controller/user/authController');
const { checkUserPermissions, checkAnyUserPermission } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const { getCurrencies, getCurrency, getCurrencyRate, createCurrency, updateCurrency, deleteCurrency } = require('../../controller/accounting/currencyController');
const {
  getCurrencyValidator,
  getCurrencyRateValidator,
  createCurrencyValidator,
  updateCurrencyValidator,
  deleteCurrencyValidator,
} = require('../../utils/validators/currencyValidators');

const router = express.Router();

router.use(authController.protect);

// Reading currencies and rates is part of working with Journal Entries (the entry form's currency
// selector), so journalEntries:read is accepted as well as currencies:read. Managing them needs
// the currencies permission itself.
const canRead = checkAnyUserPermission([
  { resource: Resources.currencies, action: Actions.read },
  { resource: Resources.journalEntries, action: Actions.read },
]);
const can = action => checkUserPermissions({ resource: Resources.currencies, action });

router.route('/').get(canRead, getCurrencies).post(can(Actions.create), createCurrencyValidator, createCurrency);

router.get('/:id/rate', canRead, getCurrencyRateValidator, getCurrencyRate);

router
  .route('/:id')
  .get(canRead, getCurrencyValidator, getCurrency)
  .patch(can(Actions.update), updateCurrencyValidator, updateCurrency)
  .delete(can(Actions.delete), deleteCurrencyValidator, deleteCurrency);
>>>>>>> origin/main

module.exports = router;
