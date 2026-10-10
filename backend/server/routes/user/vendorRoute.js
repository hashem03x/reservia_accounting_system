const { Router } = require('express');



// check permisson it should be in the middleware

const authController = require('../../controller/user/authController');

const {
  createVendorValidators,
  updateVendorValidators,
  deleteVendorValidators,
  readVendorValidators
} = require('../../utils/validators/vendorValidators')


const {
  getVendorExpenses,
  getVendorFixedAssetAcquisitions,
  createVendor,
  getAllVendors,
  getVendor,
  updateVendor,
  deleteVendor,
  uploadVendorDocument,
  deleteVendorDocument }
  = require('../../controller/user/vendorController');

const { uploadSingleDocument } = require('../../middleware/documentUploadMiddleware');

const { checkUserPermissions } = require('../../middleware/hasPermission');

const router = Router();

// check permisson it should be in the middleware
// router.use(checkUserPermissions({resource:'vendors', action:'create'}));

router.use(authController.protect)

router.route('/')
  .get(
    checkUserPermissions({ resource: 'vendors', action: 'read' }),
    getAllVendors)
  .post(
    checkUserPermissions({ resource: 'vendors', action: 'create' }),
    createVendorValidators,
    createVendor);


// Fixed assets acquired from this vendor, with paid / outstanding amounts from the ledger.
router.get(
  '/:id/fixed-asset-acquisitions',
  checkUserPermissions({ resource: 'vendors', action: 'read' }),
  readVendorValidators,
  getVendorFixedAssetAcquisitions
);

// The vendor's expenses (read with the expenses permission - they are expense records).
router.get(
  '/:id/expenses',
  checkUserPermissions({ resource: 'expenses', action: 'read' }),
  readVendorValidators,
  getVendorExpenses
);

router.route('/:id')
  .get(
    checkUserPermissions({ resource: 'vendors', action: 'read' }),
    readVendorValidators,
    getVendor)
  .put(
    checkUserPermissions({ resource: 'vendors', action: 'update' }),
    updateVendorValidators,
    updateVendor)
  .delete(
    checkUserPermissions({ resource: 'vendors', action: 'delete' }),
    deleteVendorValidators,
    deleteVendor);

// Optional PDF business documents (commercial registration, tax card, etc.)
router.route('/:id/documents')
  .post(
    checkUserPermissions({ resource: 'vendors', action: 'update' }),
    uploadSingleDocument('vendors', 'document'),
    uploadVendorDocument);

router.route('/:id/documents/:documentType')
  .delete(
    checkUserPermissions({ resource: 'vendors', action: 'update' }),
    deleteVendorDocument);

module.exports = router;