const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCrmAccess, requireCrmRole } = require('../../middleware/crmAccess');
const adSpendController = require('../../controller/crm/adSpendController');
const { setAdSpendValidator, listAdSpendValidator } = require('../../utils/validators/crm/adSpendValidators');

const router = express.Router();

router.use(authController.protect, requireCrmAccess);

router.get('/', listAdSpendValidator, adSpendController.listAdSpend);
router.put('/', requireCrmRole('md'), setAdSpendValidator, adSpendController.setAdSpend);

module.exports = router;
