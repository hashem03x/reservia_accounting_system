const { check } = require('express-validator');

const validatorMiddleware = require('../../middleware/validatorMiddleware');
const Category = require('../../models/categoryModel');
const Product = require('../../models/inventory/productModel')
const SubCategory = require('../../models/subCategoryModel');
const { validateProductTypeFields } = require('../productTypeValidation');

// A product's `type` decides which fields below are actually required - validateProductTypeFields
// (see utils/productTypeValidation.js) is the single source of truth for that branching, shared by
// create and update so the rules can't drift between the two (see docs/entities/products.md).
function validateTypeSpecificFields(value, { req }) {
  const error = validateProductTypeFields({
    type: req.body.type || 'product',
    cost: req.body.cost,
    category: req.body.category,
    subcategory: req.body.subcategory,
    durationValue: req.body.durationValue,
    durationUnit: req.body.durationUnit,
  });
  if (error) throw new Error(error);
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
  check('type').optional().isIn(['product', 'service']).withMessage('type must be either "product" or "service"'),
  check('type').custom(validateTypeSpecificFields),
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
  check('capacity.value').optional({ nullable: true }).isNumeric().withMessage('Capacity value must be a number'),
  check('capacity.unit').optional({ nullable: true }).isString().withMessage('Capacity unit must be a string'),
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
  // `updateProduct` uses a raw findByIdAndUpdate (see productController.js), which does NOT run
  // document middleware - so the model-level "a service can't have inventory stock" guard
  // (productModel.js's pre('save') hook) never fires here. This is the only place that invariant
  // is enforced for updates, so it must stay even though the frontend already makes `type`
  // read-only after creation once a product exists.
  check('type')
    .optional()
    .isIn(['product', 'service'])
    .withMessage('type must be either "product" or "service"')
    .custom(async (value, { req }) => {
      if (value !== 'service') return true;
      const product = await Product.findById(req.params.id);
      if (product && Array.isArray(product.stock) && product.stock.length > 0) {
        throw new Error('Cannot convert a product with existing stock into a service.');
      }
      return true;
    }),
  check('durationValue').optional().isFloat({ gt: 0 }).withMessage('durationValue must be a positive number'),
  check('durationUnit').optional().isIn(['month']).withMessage('durationUnit must be "month"'),
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
  check('capacity.value').optional({ nullable: true }).isNumeric().withMessage('Capacity value must be a number'),
  check('capacity.unit').optional({ nullable: true }).isString().withMessage('Capacity unit must be a string'),
  validatorMiddleware,
];

exports.deleteProductValidator = [check('id').isMongoId().withMessage('Invalid product id formate'), validatorMiddleware];
