const express = require('express');
// mergeParams:true - this router is mounted at /pages/:pageId/sections (pageRoute.js), and every
// controller here needs :pageId from the PARENT route, not just its own :id.
const router = express.Router({ mergeParams: true });

const { requireWebsiteCapability } = require('../../middleware/websiteAccess');
const { createSection, getSections, updateSection, reorderSections, duplicateSection, deleteSection } = require('../../controller/website/sectionController');
const { createSectionValidators, updateSectionValidators, reorderSectionsValidators } = require('../../utils/validators/website/sectionValidators');

// authController.protect + requireWebsiteAccess already ran on the parent pageRoute router before
// this one is ever reached - no need to repeat them here.

router
  .route('/')
  .get(requireWebsiteCapability('view'), getSections)
  .post(requireWebsiteCapability('edit'), createSectionValidators, createSection);

router.patch('/reorder', requireWebsiteCapability('edit'), reorderSectionsValidators, reorderSections);

router
  .route('/:id')
  .patch(requireWebsiteCapability('edit'), updateSectionValidators, updateSection)
  .delete(requireWebsiteCapability('edit'), deleteSection);

router.post('/:id/duplicate', requireWebsiteCapability('edit'), duplicateSection);

module.exports = router;
