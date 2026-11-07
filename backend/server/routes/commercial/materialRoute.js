const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCommercialAccess } = require('../../middleware/commercialAccess');
const materialController = require('../../controller/commercial/materialController');

// Mounted at /api/v1/commercial/materials. Same SSO/session gate as every other Commercial route
// (see projectRoute.js's comment for the long version) - authController.protect loads the real
// user and systemMemberships from the DB; requireCommercialAccess then checks that server-side.
const router = express.Router();

router.use(authController.protect, requireCommercialAccess);

router.route('/').get(materialController.listMaterials).post(materialController.createMaterial);
router.route('/:id').get(materialController.getMaterial).patch(materialController.updateMaterial);
router.patch('/:id/archive', materialController.archiveMaterial);

module.exports = router;
