const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCrmAccess, requireCrmRole } = require('../../middleware/crmAccess');
const leadController = require('../../controller/crm/leadController');
const {
  createLeadValidator,
  leadIdValidator,
  archiveLeadValidator,
  changeStageValidator,
  reassignLeadValidator,
  recordActivityValidator,
} = require('../../utils/validators/crm/leadValidators');
const leadAttachmentRoute = require('./leadAttachmentRoute');

const router = express.Router();

// GET /crm/leads/export-cron - the weekly Marketing Dashboard export (Developer Brief), for an
// external scheduler (Vercel Cron) rather than a logged-in user - same CRON_SECRET bearer-token
// pattern as backup.controller.js#cronBackup. Registered BEFORE the protect/requireCrmAccess gate
// below so it is never subject to it; it has its own, equally strict check.
router.get('/export-cron', leadController.exportLeadsCron);

// Central Business Portal SSO (docs section "Central Business Portal"): the SAME JWT session as
// the rest of the app - authController.protect loads the real user and its systemMemberships from
// the database on every request; requireCrmAccess then checks THAT, never anything the client
// sent. "Hiding a menu item is not authorization" - this is the actual server-side gate the
// frontend's SystemGuard/RoleGuard merely reflects in the UI.
router.use(authController.protect, requireCrmAccess);

// Registered before '/:id' so it is never matched as an id.
router.get('/pipeline', leadController.getPipelineSummary);
router.get('/export', leadController.exportLeads);

router.route('/').get(leadController.getLeads).post(createLeadValidator, leadController.createLead);

router.get('/:id', leadIdValidator, leadController.getLeadById);
router.patch('/:id/stage', changeStageValidator, leadController.changeStage);
// Reassigning ownership is the brief's "admin officer" action - sales/technical cannot move a
// lead off their own desk (or anyone else's) onto another rep.
router.patch('/:id/owner', requireCrmRole('admin', 'md'), reassignLeadValidator, leadController.reassignLead);
router.post('/:id/activities', recordActivityValidator, leadController.recordActivity);
// File upload (acceptance report section 7) - a lead's attached documents (e.g. an electricity
// bill), stored the same private-GridFS way every other attachment in this ERP already is.
router.use('/:leadId/attachments', leadAttachmentRoute);
// Acceptance report finding 7 + Change Request 1, Feature 6: "Add a delete or archive action for
// the MD only" / "require a reason".
router.patch('/:id/archive', requireCrmRole('md'), archiveLeadValidator, leadController.archiveLead);
router.patch('/:id/restore', requireCrmRole('md'), leadIdValidator, leadController.restoreLead);

module.exports = router;
