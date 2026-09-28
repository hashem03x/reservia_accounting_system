const express = require('express');

const authController = require('../controller/user/authController');

const {
  getSubCategory,
  getSubCategories,
  createSubCategory,
  updateSubCategory,
  deleteSubCategory,
  uploadSubCategoryImage,
  resizeImage,
  createFilterObject,
} = require('../controller/subCategoryController');

const { getSubCategoryValidator, createSubCategoryValidator, updateSubCategoryValidator, deleteSubCategoryValidator } = require('../utils/validators/subCategoryValidator');

const router = express.Router({ mergeParams: true });

router
  .route('/')
  .get(createFilterObject, getSubCategories)
  .post(authController.protect, authController.allowedTo('admin', 'manager'), uploadSubCategoryImage, resizeImage, createSubCategoryValidator, createSubCategory);

router
  .route('/:id')
  .get(getSubCategoryValidator, getSubCategory)
  .put(authController.protect, authController.allowedTo('admin', 'manager'), uploadSubCategoryImage, resizeImage, updateSubCategoryValidator, updateSubCategory)
  .delete(authController.protect, authController.allowedTo('admin'), deleteSubCategoryValidator, deleteSubCategory);
module.exports = router;
