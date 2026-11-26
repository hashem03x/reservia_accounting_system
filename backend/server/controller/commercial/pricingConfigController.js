const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const pricingConfigService = require('../../services/commercial/pricingConfigService');
const ratesMatrix = require('../../services/commercial/ratesMatrix');
const { canSeePricing, commercialRolesOf } = require('../../utils/commercial/dealEnginePermissions');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { ACCOUNT_CODE_SORT, ACCOUNT_CODE_COLLATION } = require('../../utils/accountCodeSort');

// QA finding B3 - the Finance-managed pricing configuration. Read: any Commercial user (the Pricing
// tab shows the defaults) or a configuration manager. Write: configuration managers only
// (pricingConfigService.canManagePricingConfig - Commercial MD / Commercial Director / ERP admin),
// checked here server-side from the DB-loaded memberships.

// Pricing confidentiality (26 Nov 2026): the configuration (pricing levers incl. the Sales Bonus /
// commission %, exchange rates, the cost Rates Matrix) is READ by pricing roles only - the MD, the
// Sales and Commercial Director and Sales - and managed by the MD / S&C Director. Every other
// Deal Engine role, and Finance / HR / ERP admins without one of those roles, gets a 403.
exports.requireReadAccess = (req, res, next) => {
  if (canSeePricing(commercialRolesOf(req.user)) || pricingConfigService.canManagePricingConfig(req.user)) return next();
  return next(new ApiError('You do not have access to the Deal Engine pricing configuration.', 403));
};

exports.requireManageAccess = (req, res, next) => {
  if (pricingConfigService.canManagePricingConfig(req.user)) return next();
  return next(new ApiError('Only the Sales and Commercial Director or the MD can change the pricing configuration.', 403));
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

// Rates Matrix (installation / transport rates by region and size band) - read by every Deal Engine
// member, versioned changes by the Pricing Config managers only.
exports.getRatesMatrix = asyncHandler(async (req, res) => {
  const view = await ratesMatrix.getMatrixView(req.query.country || 'Egypt');
  res.status(200).json(apiResponse('Rates Matrix', true, { ...view, canManage: pricingConfigService.canManagePricingConfig(req.user) }));
});
exports.saveRatesMatrix = asyncHandler(async (req, res) => {
  const version = await ratesMatrix.saveVersion(req.body?.country || 'Egypt', req.body || {}, req.user);
  res.status(201).json(apiResponse('Rates Matrix saved as a new version', true, version));
});
exports.loadReferenceRatesMatrix = asyncHandler(async (req, res) => {
  const version = await ratesMatrix.loadReference(req.body?.country || 'Egypt', req.user);
  res.status(201).json(apiResponse('Reference Rates Matrix loaded', true, version));
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
