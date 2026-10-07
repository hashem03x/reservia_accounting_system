const express = require('express');
const { checkUserPermissions } = require('../middleware/hasPermission');
const { Resources, Actions } = require('../utils/appConstant');

const router = express.Router();

const authController = require('../controller/user/authController');
const { getTransaction, getTransactions } = require('../controller/transactionController');

router.use(authController.protect);

router.route('/:id').get(getTransaction);

router.route('/').get(checkUserPermissions({ resource: Resources.transactions, action: Actions.read }), getTransactions);

module.exports = router;
