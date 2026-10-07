const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('express-async-handler');
const factory = require('./handlersFactory');

const { uploadSingleFile } = require('../middleware/uploadImageMiddleware');
const Category = require('../models/categoryModel');

// Upload single image
exports.uploadCategoryImage = uploadSingleFile('image');

// Image processing
exports.resizeImage = asyncHandler(async (req, res, next) => {
  if (req.file) {
    const extension = req.file.originalname.split('.').pop();
    const filename = `category-${uuidv4()}-${Date.now()}.${extension}`;
    await sharp(req.file.buffer)
      // .resize(600, 600)
      .toFile(`uploads/categories/${filename}`);
    // Save image into db
    req.body.image = filename;
  }
  next();
});

/**
 *  @description Get list of categories
 *  @route       GET /api/v1/catetgories
 *  @access      Public
 */
exports.getCategories = factory.getAll(Category);

/**
 *  @description Get category
 *  @route       GET /api/categories/:id
 *  @access      Public
 */
exports.getCategory = factory.getOne(Category);

/**
 *  @description Create category
 *  @route       POST /api/v1/categories
 *  @access      Private/Admin-Manager
 */
exports.createCategory = factory.createOne(Category);

/**
 *  @description Update category
 *  @route       PUT /api/category/:id
 *  @access      Private/Admin-Manager
 */
exports.updateCategory = factory.updateOne(Category);

/**
 *  @description Delete category
 *  @route       DELETE /api/categories/:id
 *  @access      Private/Admin
 */
exports.deleteCategory = asyncHandler(async (req, res, next) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    return next(new ErrorResponse(`Category not found with id of ${req.params.id}`, 404));
  }

  const hasSubCategories = await Category.findOne({ mainCategory: req.params.id });
  if (hasSubCategories) {
    return next(new ErrorResponse(`Category has subcategories. Please delete them first`, 400));
  }

  category.isDeleted = true;
  await category.save();
  res.status(200).json({ success: true, data: category });
});
