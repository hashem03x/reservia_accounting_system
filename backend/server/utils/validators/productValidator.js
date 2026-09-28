const { check } = require('express-validator');

const validatorMiddleware = require('../../middleware/validatorMiddleware');
const Category = require('../../models/categoryModel');
const Product = require('../../models/inventory/productModel')
const SubCategory = require('../../models/subCategoryModel');
const { normalizeTags } = require('../helper');

// Shared by create/update: accepts either a real array (JSON body) or a JSON-stringified array
// (multipart form field, same convention `req.body.colors` already uses - see
// productController.js's uploadProductImages/updateProductImages), validates every entry is a
// string, then normalizes in place so the controller's unfiltered `$set: req.body` persists the
// already-normalized array (trimmed, deduped, empty values dropped - see helper.js normalizeTags).
function validateAndNormalizeTags(value, { req }) {
  let tags = value;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch (err) {
      throw new Error('tags must be an array of strings');
    }
  }
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) {
    throw new Error('tags must be an array of strings');
  }
  req.body.tags = normalizeTags(tags);
  return true;
}

exports.createProductValidator = [
  check('title').custom((value, { req }) => {
    req.body.createdBy = req.user._id;
    if (!value.en || !value.ar) throw new Error('invalid_input');
    return true;
  }),
  check('description').custom(value => {
    if (!value.en || !value.ar) throw new Error('description arabic or english not valid');
    return true;
  }),
  // check('quantity').notEmpty().withMessage('product quantity is is required').isNumeric().withMessage('Product quantity must be number'),
  check('sold').optional().isNumeric().withMessage('product sales must be number'),
  check('price').notEmpty().withMessage('Product price is required ').isNumeric().withMessage('Product price must be number').isLength({ max: 20 }).withMessage('Too long price'),
  check('priceAfterDiscount')
    .optional()
    .isFloat()
    .isNumeric()
    .withMessage('priceAfterDiscount must be a number')
    .custom((value, { req }) => {
      if (req.body.price <= value) {
        throw new Error('priceAfterDiscount must be lower than price');
      }
      return true;
    }),
  // check('colors').optional().isArray().withMessage('colors shoude be array of string'),
  // check('sizes').notEmpty().withMessage('sizes is required').isArray().withMessage('sizes should be array of string'),
  check('imageCover').optional(),
  // check('images').optional().isArray().withMessage('images should be array of string'),
  check('category')
    .optional()
    .isMongoId()
    .withMessage('Invalid category id formate')
    .custom(async categoryId => {
      await Category.findById(categoryId).then(category => {
        if (!category) return Promise.reject(new Error(`No category for this id ${categoryId}`));
      });
    }),
  check('subcategory')
    .optional()
    // .withMessage('subcategories is required')
    .isMongoId()
    .withMessage('Invalid subcategory id formate')
    // Check if subcategories ids exists in db
    .custom(async subcategoryId => {
      await SubCategory.findById(subcategoryId).then(category => {
        if (!category) return Promise.reject(new Error(`No subcategory for this id ${subcategoryId}`));
      });
    }),

  check('brand').optional().isMongoId().withMessage('Invalid brand id formate'),
  check('tags').optional().custom(validateAndNormalizeTags),
  check('ratingAverage')
    .optional()
    .isNumeric()
    .withMessage('ratingAvarage must be a number')
    .isLength({ min: 1 })
    .withMessage('Rating must be above of equal to 1.0')
    .isLength({ max: 5 })
    .withMessage('Rating must be below of equal to 5.0'),
  check('retingQuantity').optional().isNumeric().withMessage('ratingQuantity must be a number'),
  validatorMiddleware,
];

exports.getProductValidator = [check('id').isMongoId().withMessage('Invalid product id formate'), validatorMiddleware];

exports.updateProductValidator = [
  check('id').isMongoId().withMessage('Invalid product id formate'),
  check('title')
    .optional()
    .custom(value => {
      console.log('value', value);
      if (!value.en || !value.ar) throw new Error('invalid_input');
      return true;
    }),
    check('priceAfterDiscount')
    .optional()
    .custom(async (value, { req }) => {
         if(!value|| value == null){
          // const product = await Product.findById(req.params.id);
            req.body.priceAfterDiscount = null;
            // await product.save();
          }
          return true;
    }),
  check('tags').optional().custom(validateAndNormalizeTags),
  validatorMiddleware,
];

exports.deleteProductValidator = [check('id').isMongoId().withMessage('Invalid product id formate'), validatorMiddleware];
