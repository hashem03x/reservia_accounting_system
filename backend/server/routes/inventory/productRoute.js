// Get products by a list of IDs
const express = require('express');

const router = express.Router();
// const { createFilterObject } = require('../inventory/inventoryMiddleware');
const authController = require('../../controller/user/authController');

const {
  createProduct,
  deleteProduct,
  getProduct,
  getProducts,
  uploadProductImages,
  handleProductImages,
  updateProductImages,
  updateProduct,
  parseProductStock,
  parseProductCapacity,
  deleteProductImage,
  resizeProductImages,
  createFilterObject,
  applyDiscount,
  applyDiscountToProduct,
  getProductsByIds,
  getOrdersByProductCode,
  getProductHistoryByCode,
  getProductByCode,
} = require('../../controller/inventory/productController');

const { createProductValidator, deleteProductValidator, getProductValidator, updateProductValidator } = require('../../utils/validators/productValidator');

const { checkUserPermissions } = require('../../middleware/hasPermission');
const { Resources, Actions } = require('../../utils/appConstant');
const { uploadSingleFileONCloudinary } = require('../../middleware/fileUploadMiddleware');
const { saveSingleFileMiddleware } = require('../../middleware/saveFileMiddleware');

router
  .route('/')
  .get(createFilterObject, getProducts) // get all products and make is global
  .post(
    authController.protect,
    // authController.allowedTo('admin', 'manager', 'moderator'),
    // allowed to create product(admin , any user has this permssions)
    checkUserPermissions({ resource: Resources.products, action: Actions.create }),
    uploadProductImages,
    handleProductImages,
    parseProductStock,
    parseProductCapacity,
    createProductValidator,
    createProduct
  );

router.get('/by-ids', getProductsByIds);

// Barcode lookups - replace the removed Variant module's code-based endpoints, now resolving
// against Product.barcode.
router.get('/code/:code', getProductByCode);
router.get('/orders/:code', getOrdersByProductCode);
router.get('/history/:code', authController.protect, checkUserPermissions({ resource: Resources.products, action: Actions.read }), getProductHistoryByCode);

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
    parseProductStock,
    parseProductCapacity,
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
