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
} = require('../../controller/vendor/requisitionController');
const { createRequisitionValidators, updateRequisitionValidators } = require('../../utils/validators/requisitionValidators');

const router = Router();

router.use(authController.protect);

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

module.exports = router;
