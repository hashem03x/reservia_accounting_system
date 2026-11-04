const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCrmAccess } = require('../../middleware/crmAccess');
const teamController = require('../../controller/crm/teamController');

const router = express.Router();

router.use(authController.protect, requireCrmAccess);
router.get('/', teamController.listTeam);

module.exports = router;
