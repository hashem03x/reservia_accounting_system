const express = require('express');

const router = express.Router();

const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const {
  getShareholders,
  getShareholder,
  createShareholder,
  updateShareholder,
  addContribution,
  getEquityAccountOptions,
  getCompanyCapital,
  setIssuedCapital,
  setupCapitalStructure,
} = require('../../controller/equity/shareholderController');
const {
  createShareholderValidators,
  updateShareholderValidators,
  addContributionValidators,
  setIssuedCapitalValidators,
  setupCapitalStructureValidators,
} = require('../../utils/validators/shareholderValidators');

router.use(authController.protect);

// Registered before '/:id' so they are never matched as an id.
router.get('/equity-accounts', checkUserPermissions({ resource: Resources.shareholders, action: Actions.read }), getEquityAccountOptions);
router
  .route('/company-capital')
  .get(checkUserPermissions({ resource: Resources.shareholders, action: Actions.read }), getCompanyCapital)
  .patch(checkUserPermissions({ resource: Resources.shareholders, action: Actions.update }), setIssuedCapitalValidators, setIssuedCapital);
router.post('/capital-structure', checkUserPermissions({ resource: Resources.shareholders, action: Actions.create }), setupCapitalStructureValidators, setupCapitalStructure);

router
  .route('/')
  .get(checkUserPermissions({ resource: Resources.shareholders, action: Actions.read }), getShareholders)
  .post(checkUserPermissions({ resource: Resources.shareholders, action: Actions.create }), createShareholderValidators, createShareholder);

router
  .route('/:id')
  .get(checkUserPermissions({ resource: Resources.shareholders, action: Actions.read }), getShareholder)
  .patch(checkUserPermissions({ resource: Resources.shareholders, action: Actions.update }), updateShareholderValidators, updateShareholder);

router.post('/:id/contributions', checkUserPermissions({ resource: Resources.shareholders, action: Actions.create }), addContributionValidators, addContribution);

module.exports = router;
