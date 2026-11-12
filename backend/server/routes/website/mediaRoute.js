const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { requireWebsiteAccess, requireWebsiteCapability } = require('../../middleware/websiteAccess');
const { uploadMultipleMedia, uploadSingleMedia } = require('../../middleware/websiteMediaUploadMiddleware');
const { uploadImages, getMedia, getFolders, getStats, getOneMedia, getMediaUsage, updateMedia, replaceMedia, deleteMedia, purgeMedia } = require('../../controller/website/mediaController');
const { uploadMediaValidators, updateMediaValidators } = require('../../utils/validators/website/mediaValidators');

router.use(authController.protect, requireWebsiteAccess);

router
  .route('/')
  .get(requireWebsiteCapability('view'), getMedia)
  .post(requireWebsiteCapability('media.manage'), uploadMultipleMedia('files'), uploadMediaValidators, uploadImages);

router.get('/folders', requireWebsiteCapability('view'), getFolders);
router.get('/stats', requireWebsiteCapability('view'), getStats);

router
  .route('/:id')
  .get(requireWebsiteCapability('view'), getOneMedia)
  .patch(requireWebsiteCapability('media.manage'), updateMediaValidators, updateMedia)
  .delete(requireWebsiteCapability('media.manage'), deleteMedia);

router.get('/:id/usage', requireWebsiteCapability('view'), getMediaUsage);
router.post('/:id/replace', requireWebsiteCapability('media.manage'), uploadSingleMedia('file'), replaceMedia);
router.delete('/:id/purge', requireWebsiteCapability('media.manage'), purgeMedia);

module.exports = router;
