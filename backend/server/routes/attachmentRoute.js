const express = require('express');
const { param } = require('express-validator');

const authController = require('../controller/user/authController');
const validatorMiddleware = require('../middleware/validatorMiddleware');
const { Actions } = require('../utils/appConstant');
const c = require('../controller/attachmentController');

// PDF attachments of purchase orders, sales orders and journal entries. Signed-in users only;
// every route checks the permission of the record the file belongs to.
//   GET    /:ownerKey/:ownerId          list      (ownerKey: purchase-orders | sales-orders | journal-entries)
//   POST   /:ownerKey/:ownerId          attach    (multipart, PDFs in the "files" field)
//   GET    /:id/download[?inline=1]     download / preview
//   DELETE /:id                         remove
const router = express.Router();
router.use(authController.protect);

const ownerRules = [
  param('ownerKey').isIn(['purchase-orders', 'sales-orders', 'journal-entries']).withMessage('Unsupported record type'),
  param('ownerId').isMongoId().withMessage('Invalid record id'),
  validatorMiddleware,
];
const idRules = [param('id').isMongoId().withMessage('Invalid attachment id'), validatorMiddleware];

router.get('/:id/download', idRules, c.downloadAttachment);
router.delete('/:id', idRules, c.deleteAttachment);
router
  .route('/:ownerKey/:ownerId')
  .get(ownerRules, c.guardOwner(Actions.read), c.listAttachments)
  .post(ownerRules, c.guardOwner(Actions.update), c.receiveFiles, c.uploadAttachments);

module.exports = router;
