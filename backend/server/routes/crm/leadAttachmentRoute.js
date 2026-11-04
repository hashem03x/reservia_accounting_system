const express = require('express');
const { check } = require('express-validator');
const authController = require('../../controller/user/authController');
const { requireCrmAccess, requireCrmRole } = require('../../middleware/crmAccess');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const controller = require('../../controller/crm/leadAttachmentController');

const leadIdParamValidator = [check('leadId').isMongoId().withMessage('Invalid lead id'), validatorMiddleware];

// Mounted at /crm/leads/:leadId/attachments (routes/crm/leadRoute.js) - any active CRM role can
// list/upload (a lead's attachments are visible wherever the lead itself is), only admin/MD can
// remove one, mirroring the archive action's own sensitivity level.
const router = express.Router({ mergeParams: true });
router.use(authController.protect, requireCrmAccess);
router.get('/', leadIdParamValidator, controller.listAttachments);
router.post('/', leadIdParamValidator, controller.receiveFiles, controller.uploadAttachments);

// A separate router for the by-attachment-id routes (download/delete), mounted directly under
// /crm/attachments so the id in the URL IS the attachment, not the lead.
const byIdRouter = express.Router();
byIdRouter.use(authController.protect, requireCrmAccess);
byIdRouter.get('/:id/download', controller.downloadAttachment);
byIdRouter.delete('/:id', requireCrmRole('admin', 'md'), controller.deleteAttachment);

module.exports = router;
module.exports.byId = byIdRouter;
