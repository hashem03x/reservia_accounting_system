const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { createTransfer, getTransfers, transferMoney } = require('../../controller/inventory/transferController');
const { validateTransferStock, validateMoneyTransfer } = require('../../utils/validators/transferValidatro');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');

router.use(authController.protect);

router.post('/', checkUserPermissions({ resource: Resources.transfers, action: Actions.create }), validateTransferStock, createTransfer);

router.get('/', checkUserPermissions({ resource: Resources.transfers, action: Actions.read }), getTransfers);

router.post('/money', checkUserPermissions({ resource: Resources.cash, action: Actions.read }), validateMoneyTransfer, transferMoney);

module.exports = router;
