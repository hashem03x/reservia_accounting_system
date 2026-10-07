const express = require('express');

const subCategoryRoute = require('./subCategoryRoute');

const authController = require('../controller/user/authController');

const { getCategoryValidator, deleteCategoryValidator, createCategoryValidator, updateCategoryValidator } = require('../utils/validators/categoryValidator');

const { getCategories, getCategory, createCategory, updateCategory, deleteCategory, uploadCategoryImage, resizeImage } = require('../controller/categoryController');

const router = express.Router();

// Nested route
router.use('/:categoryId/subcategories', subCategoryRoute);
// router.use('/:categoryId/products', productRoute);

router
  .route('/')
  .get(getCategories)
  .post(authController.protect, authController.allowedTo('admin', 'manager'), uploadCategoryImage, resizeImage, createCategoryValidator, createCategory);
router
  .route('/:id')
  .get(getCategoryValidator, getCategory)
  .put(authController.protect, authController.allowedTo('admin', 'manager'), uploadCategoryImage, resizeImage, updateCategoryValidator, updateCategory)
  .delete(authController.protect, authController.allowedTo('admin'), deleteCategoryValidator, deleteCategory);

module.exports = router;
