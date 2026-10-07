const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const { uploadSingleDocument } = require('../../middleware/documentUploadMiddleware');
const {
  createProject,
  getProjects,
  getProject,
  updateProject,
  deleteProject,
  uploadContract,
  getContract,
  deleteContract,
  getProjectJournalEntries,
} = require('../../controller/project/projectController');
const { createProjectValidators, updateProjectValidators } = require('../../utils/validators/projectValidators');

router.use(authController.protect);

router
  .route('/')
  .get(checkUserPermissions({ resource: Resources.projects, action: Actions.read }), getProjects)
  .post(checkUserPermissions({ resource: Resources.projects, action: Actions.create }), createProjectValidators, createProject);

router
  .route('/:id')
  .get(checkUserPermissions({ resource: Resources.projects, action: Actions.read }), getProject)
  .patch(checkUserPermissions({ resource: Resources.projects, action: Actions.update }), updateProjectValidators, updateProject)
  .delete(checkUserPermissions({ resource: Resources.projects, action: Actions.delete }), deleteProject);

router
  .route('/:id/contract')
  .post(checkUserPermissions({ resource: Resources.projects, action: Actions.update }), uploadSingleDocument('projects', 'contract'), uploadContract)
  .get(checkUserPermissions({ resource: Resources.projects, action: Actions.read }), getContract)
  .delete(checkUserPermissions({ resource: Resources.projects, action: Actions.update }), deleteContract);

router.get('/:id/journal-entries', checkUserPermissions({ resource: Resources.projects, action: Actions.read }), getProjectJournalEntries);

module.exports = router;
