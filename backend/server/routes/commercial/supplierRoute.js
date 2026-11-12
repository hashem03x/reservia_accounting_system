const express = require('express');
const multer = require('multer');
const authController = require('../../controller/user/authController');
const { requireCommercialAccess } = require('../../middleware/commercialAccess');
const controller = require('../../controller/commercial/supplierController');

// Deal Engine C18-C24. Every Deal Engine user can read the supplier list (the BOQ shows supplier codes);
// writes are role-checked in the services (Procurement / Commercial Director / MD; MD approves).
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.use(authController.protect, requireCommercialAccess);

router.route('/').get(controller.listSuppliers).post(controller.createSupplier);
router.get('/price-lists/:uploadId', controller.getPriceList);
router.post('/price-lists/:uploadId/confirm', controller.confirmPriceList);
router.post('/price-lists/:uploadId/rollback', controller.rollbackPriceList);
router.route('/:id').get(controller.getSupplier).patch(controller.updateSupplier);
router.patch('/:id/status', controller.setStatus);
router.post('/:id/notes', controller.addNote);
router.patch('/:id/scorecard', controller.setScorecard);
router.post('/:id/documents', controller.upsertDocument);
router.get('/:id/price-lists', controller.listPriceLists);
router.post('/:id/price-lists/preview', upload.single('file'), controller.previewPriceList);

module.exports = router;
