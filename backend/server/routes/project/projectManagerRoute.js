const express = require('express');

const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const {
  getProjectManagers,
  getProjectManager,
  createProjectManager,
  updateProjectManager,
  deleteProjectManager,
  getLegacyProjectManagers,
  importLegacyProjectManagers,
} = require('../../controller/project/projectManagerController');
const { getProjectManagerValidator, createProjectManagerValidator, updateProjectManagerValidator, deleteProjectManagerValidator } = require('../../utils/validators/projectManagerValidators');

const router = express.Router();

router.use(authController.protect);

// Reading project managers is part of working with Projects (the Project form's options), so it uses
// the Projects read permission. Managing them is admin-only, like Sectors (sectorRoute.js).
const canReadProjects = checkUserPermissions({ resource: Resources.projects, action: Actions.read });
const adminOnly = authController.allowedTo('admin');

router.route('/').get(canReadProjects, getProjectManagers).post(adminOnly, createProjectManagerValidator, createProjectManager);

// Registered before '/:id' so 'legacy' is never read as an id.
router.get('/legacy', adminOnly, getLegacyProjectManagers);
router.post('/legacy/import', adminOnly, importLegacyProjectManagers);

router
  .route('/:id')
  .get(canReadProjects, getProjectManagerValidator, getProjectManager)
  .patch(adminOnly, updateProjectManagerValidator, updateProjectManager)
  .delete(adminOnly, deleteProjectManagerValidator, deleteProjectManager);

module.exports = router;
