const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCrmAccess, requireCrmRole } = require('../../middleware/crmAccess');
const targetController = require('../../controller/crm/targetController');
const { setTargetValidator, listTargetsValidator } = require('../../utils/validators/crm/targetValidators');

const router = express.Router();

router.use(authController.protect, requireCrmAccess);

// Reading targets is needed by every role's own Dashboard view; only the MD sets them.
router.get('/', listTargetsValidator, targetController.listTargets);
router.put('/', requireCrmRole('md'), setTargetValidator, targetController.setTarget);

module.exports = router;
