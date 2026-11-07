const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCommercialAccess } = require('../../middleware/commercialAccess');
const revisionController = require('../../controller/commercial/revisionController');

// Mounted at /api/v1/commercial/revisions.
const router = express.Router();

router.use(authController.protect, requireCommercialAccess);

router.get('/:id', revisionController.getRevision);
router.patch('/:id', revisionController.recomputeRevision);
router.post('/project/:projectId', revisionController.createRevisionForProject);

module.exports = router;
