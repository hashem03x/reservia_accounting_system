const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCommercialAccess, requireCommercialRole } = require('../../middleware/commercialAccess');
const projectController = require('../../controller/commercial/projectController');
const handoffController = require('../../controller/commercial/handoffController');
const projectAttachmentRoute = require('./projectAttachmentRoute');

// Mounted at /api/v1/commercial/projects. Central Business Portal SSO (same JWT session as the
// rest of the app): authController.protect loads the real user and its systemMemberships from the
// database on every request; requireCommercialAccess then checks THAT, never anything the client
// sent - "hiding a menu item is not authorization" (the project's own rule, same one CRM follows).
const router = express.Router();

router.use(authController.protect, requireCommercialAccess);

router.get('/form-options', projectController.getFormOptions);
router.get('/customers', projectController.searchCustomers);
router.post('/customers', projectController.createCustomer);

router.route('/').get(projectController.listProjects).post(projectController.createProject);
router.route('/:id').get(projectController.getProject).patch(projectController.updateProject);
router.patch('/:id/archive', projectController.archiveProject);
router.post('/:id/duplicate', projectController.duplicateProject);
router.get('/:id/revisions', projectController.listRevisions);
// Link the REAL ERP project once the ERP has created it (never fabricated) - MD / Commercial Director.
router.patch('/:id/erp-project', requireCommercialRole('md', 'commercial_director'), handoffController.linkErpProject);
router.use('/:projectId/attachments', projectAttachmentRoute);

module.exports = router;
