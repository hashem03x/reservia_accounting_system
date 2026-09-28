// Get products by a list of IDs
const express = require('express');

const router = express.Router();
// const { createFilterObject } = require('../inventory/inventoryMiddleware');
const authController = require('../../controller/user/authController');
const variantRoute = require('./variantRoute');

const {
  createProduct,
  deleteProduct,
  getProduct,
  getProducts,
  uploadProductImages,
  handleProductImages,
  updateProductImages,
  updateProduct,
  deleteProductImage,
  resizeProductImages,
  createFilterObject,
  getProductsColorsSizes,
  applyDiscount,
  applyDiscountToProduct,
  handleColorsImage,
  addImagesToProduct,
  updateColorOfImages,
  getFilteredProducts,
  getProductsByIds,
  getDistinctTags,
} = require('../../controller/inventory/productController');

const { createProductValidator, deleteProductValidator, getProductValidator, updateProductValidator } = require('../../utils/validators/productValidator');

const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const { uploadSingleFileONCloudinary } = require('../../middleware/fileUploadMiddleware');
const { saveSingleFileMiddleware } = require('../../middleware/saveFileMiddleware');

// variants route
router.use('/:productId/variants', variantRoute);

// get all products sizes and colors that is available in the store
// router.get('/filter', getProductsColorsSizes);

router
  .route('/')
  // product info => [variants]
  .get(createFilterObject, getProducts) // get all products and make is global
  .post(
    authController.protect,
    // authController.allowedTo('admin', 'manager', 'moderator'),
    // allowed to create product(admin , any user has this permssions)
    checkUserPermissions({ resource: Resources.products, action: Actions.create }),
    uploadProductImages,
    handleProductImages,
    createProductValidator,
    createProduct
  );

router.get('/filtered', getFilteredProducts);

router.get('/by-ids', getProductsByIds);

router.get('/tags/distinct', getDistinctTags);

router.put('/discount', authController.protect, checkUserPermissions({ resource: Resources.products, action: Actions.update }), applyDiscount);

router
  .route('/:id')
  .get(getProductValidator, getProduct)
  // .get('/variants', createFilterObject)
  // authController.allowedTo('admin', 'manager', 'moderator'),
  // uploadProductImages,
  // resizeProductImages,
  .put(
    authController.protect,
    checkUserPermissions({ resource: Resources.products, action: Actions.update }),
    uploadProductImages,
    updateProductImages,
    updateProductValidator,
    updateProduct
  )
  //  authController.allowedTo('admin', 'manager', 'moderator'),
  .delete(authController.protect, checkUserPermissions({ resource: Resources.products, action: Actions.delete }), deleteProductValidator, deleteProduct);

// router.delete('/:id/image',
//           authController.protect,
//           checkUserPermissions({resource:Resources.products, action:Actions.update}),
//           deleteProductImage);

router.put('/:id/discount', authController.protect, checkUserPermissions({ resource: Resources.products, action: Actions.update }), applyDiscountToProduct);

module.exports = router;

/**
 * @swagger
 * tags:
 *  name: Product
 * description: Product management
 *
 * components:
 * schemas:
 *  Product:
 *   type: object
 *  required:
 *  - name
 * - price
 * - category
 * - brand
 * - subcategory
 * - stock
 * - description
 * - images
 * - createdBy
 * - ratingsAverage
 */

/**
 * @swagger
 * /api/v1/products:
 * get:
 * summary: Get all products
 * tags: [Product]
 * responses:
 * 200:
 * description: Success
 * 400:
 * description: Bad Request
 * 401:
 * description: Unauthorized
 * 403:
 * description: Forbidden
 * 404:
 * description: Not Found
 * 500:
 * description: Internal Server Error
 */

/**
 * @swagger
 * /api/v1/products/filter:
 * get:
 * summary: Get all products sizes and colors that is available in the store
 * tags: [Product]
 * responses:
 * 200:
 * description: Success
 * 400:
 * description: Bad Request
 * 401:
 * description: Unauthorized
 * 403:
 * description: Forbidden
 * 404:
 * description: Not Found
 * 500:
 * description: Internal Server Error
 */
