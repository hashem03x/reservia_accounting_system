const express = require('express');
const { check } = require('express-validator');
const authController = require('../../controller/user/authController');
const { requireCommercialAccess, requireCommercialRole } = require('../../middleware/commercialAccess');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const controller = require('../../controller/commercial/projectAttachmentController');

const projectIdParamValidator = [check('projectId').isMongoId().withMessage('Invalid project id'), validatorMiddleware];

// Mounted at /commercial/projects/:projectId/attachments (routes/commercial/projectRoute.js) -
// mirrors routes/crm/leadAttachmentRoute.js exactly. Any active Commercial role can list/upload;
// only md/commercial_director can remove one.
const router = express.Router({ mergeParams: true });
router.use(authController.protect, requireCommercialAccess);
router.get('/', projectIdParamValidator, controller.listAttachments);
router.post('/', projectIdParamValidator, controller.receiveFiles, controller.uploadAttachments);

const byIdRouter = express.Router();
byIdRouter.use(authController.protect, requireCommercialAccess);
byIdRouter.get('/:id/download', controller.downloadAttachment);
byIdRouter.delete('/:id', requireCommercialRole('md', 'commercial_director'), controller.deleteAttachment);

module.exports = router;
module.exports.byId = byIdRouter;
