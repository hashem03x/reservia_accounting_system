const express = require('express');

const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const {
  getAccountParentGroups,
  getSelectableAccountParentGroups,
  getAccountParentGroup,
  createAccountParentGroup,
  updateAccountParentGroup,
  setAccountParentGroupStatus,
  deleteAccountParentGroup,
} = require('../../controller/accounting/accountParentGroupController');
const {
  listAccountParentGroupsValidator,
  getAccountParentGroupValidator,
  createAccountParentGroupValidator,
  updateAccountParentGroupValidator,
  setAccountParentGroupStatusValidator,
  deleteAccountParentGroupValidator,
} = require('../../utils/validators/accountParentGroupValidators');

const router = express.Router();

router.use(authController.protect);

// Parent groups are part of the Chart of Accounts' own configuration, so they are governed by the
// existing `accounts` permission (read to see them, create/update/delete to manage them) - every
// role that can manage accounts can manage their classification, with no new permission to grant.
const can = action => checkUserPermissions({ resource: Resources.accounts, action });

router.route('/').get(can(Actions.read), listAccountParentGroupsValidator, getAccountParentGroups).post(can(Actions.create), createAccountParentGroupValidator, createAccountParentGroup);

// Registered before '/:id' so it is never matched as an id.
router.get('/selectable', can(Actions.read), getSelectableAccountParentGroups);

router.patch('/:id/status', can(Actions.update), setAccountParentGroupStatusValidator, setAccountParentGroupStatus);

router
  .route('/:id')
  .get(can(Actions.read), getAccountParentGroupValidator, getAccountParentGroup)
  .patch(can(Actions.update), updateAccountParentGroupValidator, updateAccountParentGroup)
  .delete(can(Actions.delete), deleteAccountParentGroupValidator, deleteAccountParentGroup);

module.exports = router;
