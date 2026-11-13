const { Router } = require('express');

const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const {
  createRequisition,
  getAllRequisitions,
  getRequisition,
  updateRequisition,
  openRequisition,
  cancelRequisition,
  getRequisitionInvoices,
  getRequisitionRemainingQuantities,
} = require('../../controller/vendor/requisitionController');
const { createRequisitionValidators, updateRequisitionValidators } = require('../../utils/validators/requisitionValidators');

const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const { checkPriceVariance } = require('../../services/vendor/priceVarianceService');

const router = Router();

router.use(authController.protect);

// ERP CHG-07: how a unit price compares with the product's last and average PO price (a warning only).
// Declared before /:id so "price-check" is never read as a PO id.
router.get(
  '/price-check',
  checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.read }),
  asyncHandler(async (req, res) => {
    res.status(200).json(apiResponse('Price check', true, await checkPriceVariance({ productId: req.query.product, unitPrice: req.query.unitPrice, excludeId: req.query.exclude })));
  })
);

router
  .route('/')
  .get(checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.read }), getAllRequisitions)
  .post(checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.create }), createRequisitionValidators, createRequisition);

router
  .route('/:id')
  .get(checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.read }), getRequisition)
  .patch(checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.update }), updateRequisitionValidators, updateRequisition);

router.post('/:id/open', checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.update }), openRequisition);
router.post('/:id/cancel', checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.update }), cancelRequisition);
router.get('/:id/invoices', checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.read }), getRequisitionInvoices);
router.get('/:id/remaining-quantities', checkUserPermissions({ resource: Resources.purchaseRequisitions, action: Actions.read }), getRequisitionRemainingQuantities);

module.exports = router;
