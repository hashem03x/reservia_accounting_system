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
  createVendor,
  getAllVendors,
  getVendor,
  updateVendor,
  deleteVendor }
  = require('../../controller/user/vendorController');




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


module.exports = router;