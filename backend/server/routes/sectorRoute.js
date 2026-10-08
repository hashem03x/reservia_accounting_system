const express = require('express');

const authController = require('../controller/user/authController');
const { checkUserPermissions } = require('../middleware/hasPermission');
const { Resources, Actions } = require('../utils/appConstant');
const { getSectors, getSector, createSector, updateSector, deleteSector } = require('../controller/sectorController');
const { getSectorValidator, createSectorValidator, updateSectorValidator, deleteSectorValidator } = require('../utils/validators/sectorValidators');

const router = express.Router();

router.use(authController.protect);

// Reading sectors is part of working with Projects (the Project form's Sector options), so it uses
// the Projects read permission. Managing them is admin-only, like the other admin lookup lists
// (e.g. governorateRoute.js).
const canReadProjects = checkUserPermissions({ resource: Resources.projects, action: Actions.read });
const adminOnly = authController.allowedTo('admin');

router.route('/').get(canReadProjects, getSectors).post(adminOnly, createSectorValidator, createSector);

router
  .route('/:id')
  .get(canReadProjects, getSectorValidator, getSector)
  .patch(adminOnly, updateSectorValidator, updateSector)
  .delete(adminOnly, deleteSectorValidator, deleteSector);

module.exports = router;
