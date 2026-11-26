const express = require('express');
const multer = require('multer');
const authController = require('../../controller/user/authController');
const { requireCommercialAccess } = require('../../middleware/commercialAccess');
const materialController = require('../../controller/commercial/materialController');

// Mounted at /api/v1/commercial/materials. Same SSO/session gate as every other Commercial route
// (see projectRoute.js's comment for the long version) - authController.protect loads the real
// user and systemMemberships from the DB; requireCommercialAccess then checks that server-side.
const router = express.Router();

router.use(authController.protect, requireCommercialAccess);

router.get('/spec-fields', materialController.getSpecFields);
// The client's estimating workbooks (On_Grid.xlsx, Solar_Pumping_Agriculture_R07.xlsx...): preview,
// then the same file again to import. Parsed in memory - the file is never stored.
const workbook = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } }).single('file');
router.post('/workbook-import/preview', workbook, materialController.previewWorkbookImport);
router.post('/workbook-import/apply', workbook, materialController.applyWorkbookImport);
router.get('/erp-products/status', materialController.erpProductsStatus);
router.post('/erp-products', materialController.createErpProducts);
router.route('/').get(materialController.listMaterials).post(materialController.createMaterial);
router.route('/:id').get(materialController.getMaterial).patch(materialController.updateMaterial);
router.patch('/:id/archive', materialController.archiveMaterial);

module.exports = router;
