const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const pricingConfigService = require('../../services/commercial/pricingConfigService');
const { hasActiveCommercialMembership } = require('../../middleware/commercialAccess');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { ACCOUNT_CODE_SORT, ACCOUNT_CODE_COLLATION } = require('../../utils/accountCodeSort');

// QA finding B3 - the Finance-managed pricing configuration. Read: any Commercial user (the Pricing
// tab shows the defaults) or a configuration manager. Write: configuration managers only
// (pricingConfigService.canManagePricingConfig - Commercial MD / Commercial Director / ERP admin),
// checked here server-side from the DB-loaded memberships.

exports.requireReadAccess = (req, res, next) => {
  if (hasActiveCommercialMembership(req.user) || pricingConfigService.canManagePricingConfig(req.user)) return next();
  return next(new ApiError('You do not have access to the Deal Engine pricing configuration.', 403));
};

exports.requireManageAccess = (req, res, next) => {
  if (pricingConfigService.canManagePricingConfig(req.user)) return next();
  return next(new ApiError('Only Finance (ERP admin), the Commercial Director or the MD can change the pricing configuration.', 403));
};

exports.getConfig = asyncHandler(async (req, res) => {
  const config = await pricingConfigService.getActiveConfig();
  res.status(200).json(apiResponse('Pricing configuration', true, { ...config, canManage: pricingConfigService.canManagePricingConfig(req.user), limits: pricingConfigService.LEVER_MAX }));
});

// R8: requireManageAccess above is the base "may open the page" gate; a SAVE additionally needs
// assertCanSavePolicyChange, which reads the config's OWN requireMdApprovalForPolicyChange setting
// (so it has to run here, after the config is loaded, not as a route-level middleware).
exports.updateConfig = asyncHandler(async (req, res) => {
  const current = await pricingConfigService.getActiveConfig();
  pricingConfigService.assertCanSavePolicyChange(req.user, current);
  const config = await pricingConfigService.updateConfig(req.body || {}, { userId: req.user._id, userName: req.user.name || null });
  console.info(`[Commercial] pricing configuration v${config.version} saved by user ${req.user._id}`);
  res.status(200).json(apiResponse('Pricing configuration saved. New revisions use it; existing revisions keep the rates they were priced with.', true, config));
});

exports.getHistory = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Pricing configuration history', true, await pricingConfigService.getHistory(Number(req.query.limit) || 50)));
});

// The erpCostAccountCodes picker needs the real, active COGS accounts to choose from - same query
// as accounting/chartOfAccountController.js#getCogsEligibleAccounts, but reachable by whoever can
// actually set this field (Commercial MD/Director or ERP admin - requireManageAccess above), not
// gated behind ERP system membership + the accounts:read RBAC permission the way the ERP-side
// /accounts/cogs-eligible route is. A Commercial MD with no ERP membership at all must still be
// able to see and pick a COGS account here.
exports.getCogsAccounts = asyncHandler(async (req, res) => {
  const accounts = await ChartOfAccount.find({ type: 'cogs', isActive: true })
    .select('code name nameAr')
    .sort(ACCOUNT_CODE_SORT)
    .collation(ACCOUNT_CODE_COLLATION);
  res.status(200).json(apiResponse('Eligible COGS accounts retrieved successfully', true, accounts));
});
