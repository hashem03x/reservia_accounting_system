const fs = require('fs');

const asyncHandler = require('express-async-handler');

const ApiError = require('../../utils/apiError');
const Variant = require('../../models/inventory/variantModel');
const Product = require('../../models/inventory/productModel');
const apiResponse = require('../../utils/apiResponse');
const { parseCsvFile, parseExcelFile } = require('../../utils/fileParsers');
const { validateProductData, validateVariantData } = require('../../utils/validators/fileValidator');
const { exportLargeCsv, exportLargeExcel } = require('../../utils/exportFile');
const factory = require('../handlersFactory');
const fileProcessor = require('./fileProcessor');
const { createProduct } = require('./productController');
const { createVariant } = require('./varaintController');

const csvController = {};

// route POST /api/v1/inventory/csv/uploadProductFile
csvController.uploadProudctFile = asyncHandler(async (req, res, next) => {});

// route POST /api/v1/inventory/csv/uploadVariantFile
csvController.uploadVariantFile = asyncHandler(async (req, res, next) => {});

const storeData = async (product, req, res, next) => {
  // store data in db
  try {
    let { variants, ...productData } = product;

    variants = JSON.parse(variants);
    productData.colors = JSON.parse(productData.colors);

    // check data if validated
    // validateProductData(productData); if true store data in db
    productData = await validateProductData(productData);
    // Store product data
    const newProduct = new Product(productData);

    // checks variant is true or not in list then
    const validatedVariants = await Promise.all(variants.map(variant => validateVariantData(variant)));
    // store variants
    const variantIds = await Promise.all(
      validatedVariants.map(async variant => {
        const newVariant = await Variant.create({ ...variant, productId: newProduct._id });
        return newVariant._id;
      })
    );

    // Store variants in the product
    newProduct.variants.push(...variantIds);

    // Save the product
    await newProduct.save();
    return newProduct;
  } catch (error) {
    return new ApiError(error.message, 500);
  }
};

exports.uploadFile = asyncHandler(async (req, res, next) => {
  try {
    const file = req.file;

    const fileExtension = file.originalname.split('.').pop().toLowerCase();

    if (!file) return next(new ApiError('Please upload a file.', 400));

    if (['csv', 'xls', 'xlsx'].indexOf(fileExtension) === -1) {
      return next(new ApiError('Please upload a valid file type.', 400));
    }

    // const result = await fileProcessor.processFile(file.path, fileType);

    let data;
    if (fileExtension === 'csv') {
      data = await parseCsvFile(file.path);
    } else {
      data = parseExcelFile(file.path);
    }

    // store data in db
    const result = data.map(async product => {
      await storeData(product);
    });
    // await storeData(data);
    // Clean up uploaded file
    fs.unlinkSync(file.path);

    res.json(new apiResponse('File uploaded successfully', true, result));
  } catch (error) {
    next(new ApiError(error.message, 400));
  }
});

exports.exportController = async (req, res, next) => {
  try {
    const format = req.query.format || 'csv'; // Default to CSV

    if (format === 'csv') {
      await exportLargeCsv(res, next);
    } else if (format === 'excel') {
      await exportLargeExcel(res);
    } else {
      next(new ApiError('Invalid format', 400));
    }
  } catch (error) {
    next(new ApiError(error.message, 500));
  }
};
