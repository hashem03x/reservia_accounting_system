const { Router } = require('express');

const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const { getConsolidated, getProject } = require('../../controller/cashflow/cashFlowForecastController');

const router = Router();

router.use(authController.protect);

router.get('/', checkUserPermissions({ resource: Resources.cashFlowForecast, action: Actions.read }), getConsolidated);
router.get('/projects/:projectId', checkUserPermissions({ resource: Resources.cashFlowForecast, action: Actions.read }), getProject);

module.exports = router;
