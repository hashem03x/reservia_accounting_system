const express = require('express');

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

module.exports = router;
