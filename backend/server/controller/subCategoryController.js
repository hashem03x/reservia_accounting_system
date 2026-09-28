const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('express-async-handler');
const SubCategory = require('../models/subCategoryModel');
const factory = require('./handlersFactory');

const { uploadSingleFile } = require('../middleware/uploadImageMiddleware');

// Upload single image
exports.uploadSubCategoryImage = uploadSingleFile('image');

// Image processing
exports.resizeImage = asyncHandler(async (req, res, next) => {
  if (req.file) {
    const extension = req.file.originalname.split('.').pop();
    const filename = `subcategory-${uuidv4()}-${Date.now()}.${extension}`;
    await sharp(req.file.buffer)
      // .resize(600, 600)
      .toFile(`uploads/subcategories/${filename}`);
    // Save image into db
    req.body.image = filename;
  }
  next();
});

// Nested route
// GET    /api/v1/categories/:categoryId/subcategories
exports.createFilterObject = (req, res, next) => {
  let filterObject = {};
  if (req.params.categoryId) filterObject = { mainCategory: req.params.categoryId };
  req.filterObject = filterObject;
  next();
};

/**
 *  @description    Get list of SubCategory
 *  @route          GET/api/v1/subCategory
 *  @access         Public
 */
exports.getSubCategories = factory.getAll(SubCategory);

/**
 *  @description    Get SubCategory
 *  @route          GET/api/v1/subCategory/:id
 *  @access         Public
 */
exports.getSubCategory = factory.getOne(SubCategory);

exports.setCategoryToBody = (req, res, next) => {
  // Nested route
  if (!req.body.mainCategory) req.body.mainCategory = req.params.categoryId;
  next();
};
/**
 *  @description Create SubCategory
 *  @route       POST /api/v1/subCategory
 *  @access      Private/Admin-Manager
 */
exports.createSubCategory = factory.createOne(SubCategory);

/**
 *  @description Update SubCategory
 *  @route       POST /api/v1/subCategory/:id
 *  @access      Private/Admin-Manager
 */
exports.updateSubCategory = factory.updateOne(SubCategory);

/**
 *  @description Delete SubCategory
 *  @route       POST /api/v1/subCategory/:id
 *  @access      Private/Admin
 */
exports.deleteSubCategory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  // make display = false instead of delelt it
  let subCategory = await SubCategory.findByIdAndUpdate(id, { display: false }, { new: true });
  if (!subCategory) {
    return next(new ApiError('No document found with that ID', 404));
  }
  res.status(200).json({ data: subCategory });
});
