const { Router } = require('express');

const router = Router({ mergeParams: true });

const autheController = require('../../controller/user/authController');

const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const { saveArrayFiles } = require('../../middleware/saveFileMiddleware');
const { uploadFilesOnCloudinary, uploadSingleFileONCloudinary } = require('../../middleware/fileUploadMiddleware');

const {
  updateVariantValidate,
  deleteVariantValidators,
  readVariantValidators,
  getVariantsSpecificProduct,

  createVariantValidate,
} = require('../../utils/validators/variantValidate');

// variant bussines logic
const {
  createVariant,
  getVariants,
  getVariant,
  getVariantByCode,
  getOrdersByVariantCode,
  updateVariant,
  deleteVariant,
  createVariantFilter,
  updateVariantImage,
} = require('../../controller/inventory/varaintController');
const { uploadSingleFile } = require('../../middleware/uploadImageMiddleware');

// @route products/productId/variants
// route2 variants/createVariantFilter
//{ resource: 'products', action: 'create' }
// app/products/productId/variants
// app/products/productId/variants/:id
router.use(autheController.protect);
router
  .route('/')
  .post(checkUserPermissions({ resource: Resources.products, action: Actions.create }), createVariantValidate, createVariant)
  /**
   * @ route/productId/varaints
   */
  .get(checkUserPermissions({ resource: Resources.products, action: Actions.read }), getVariantsSpecificProduct, createVariantFilter, getVariants);

/**
 * @route productId/variants/:id
 */

router
  .route('/:id')
  .get(checkUserPermissions({ resource: Resources.products, action: Actions.read }), readVariantValidators, getVariant)
  .put(checkUserPermissions({ resource: Resources.products, action: Actions.update }), updateVariantValidate, updateVariant)
  .delete(checkUserPermissions({ resource: Resources.products, action: Actions.delete }), deleteVariantValidators, deleteVariant);

module.exports = router;
