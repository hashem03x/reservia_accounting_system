const express = require('express');
const asyncHandler = require('express-async-handler');
const authController = require('../../controller/user/authController');
const apiResponse = require('../../utils/apiResponse');
const { getCompanySettingsWithHistory, updateCompanySettings } = require('../../services/config/companySettingsService');
const { zeroVatInvoices } = require('../../services/config/zeroVatReportService');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');

// ERP company-level controls (VAT default, price variance warning, negative project stock).
// Every signed-in user can read them (the invoice and PO forms need them); only an administrator
// changes them, and each change is recorded with who made it.
const router = express.Router();
router.use(authController.protect);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.status(200).json(apiResponse('Company settings retrieved successfully', true, await getCompanySettingsWithHistory()));
  })
);

router.patch(
  '/',
  authController.allowedTo('admin'),
  asyncHandler(async (req, res) => {
    res.status(200).json(apiResponse('Company settings updated successfully', true, await updateCompanySettings(req.body, req.user)));
  })
);

// ERP CHG-06: every 0% VAT sales and purchase invoice, with its reason, for review.
router.get(
  '/zero-vat-invoices',
  checkUserPermissions({ resource: Resources.journalEntries, action: Actions.read }),
  asyncHandler(async (req, res) => {
    res.status(200).json(apiResponse('0% VAT invoices', true, await zeroVatInvoices({ from: req.query.from, to: req.query.to })));
  })
);

module.exports = router;
