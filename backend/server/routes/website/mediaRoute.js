const express = require('express');
const router = express.Router();

const authController = require('../../controller/user/authController');
const { requireWebsiteAccess, requireWebsiteCapability } = require('../../middleware/websiteAccess');
const { uploadMultipleImages } = require('../../middleware/websiteMediaUploadMiddleware');
const { uploadImages, getMedia, getOneMedia, updateMedia, deleteMedia, purgeMedia } = require('../../controller/website/mediaController');
const { uploadMediaValidators, updateMediaValidators } = require('../../utils/validators/website/mediaValidators');

router.use(authController.protect, requireWebsiteAccess);

router
  .route('/')
  .get(requireWebsiteCapability('view'), getMedia)
  .post(requireWebsiteCapability('media.manage'), uploadMultipleImages('files'), uploadMediaValidators, uploadImages);

router
  .route('/:id')
  .get(requireWebsiteCapability('view'), getOneMedia)
  .patch(requireWebsiteCapability('media.manage'), updateMediaValidators, updateMedia)
  .delete(requireWebsiteCapability('media.manage'), deleteMedia);

router.delete('/:id/purge', requireWebsiteCapability('media.manage'), purgeMedia);

module.exports = router;
