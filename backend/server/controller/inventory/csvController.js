const fs = require('fs');

const asyncHandler = require('express-async-handler');

const ApiError = require('../../utils/apiError');
const Product = require('../../models/inventory/productModel');
const apiResponse = require('../../utils/apiResponse');
const { parseCsvFile, parseExcelFile } = require('../../utils/fileParsers');
const { validateProductData } = require('../../utils/validators/fileValidator');
const { exportLargeCsv, exportLargeExcel } = require('../../utils/exportFile');
const factory = require('../handlersFactory');
const fileProcessor = require('./fileProcessor');
const { createProduct } = require('./productController');

const csvController = {};

// route POST /api/v1/inventory/csv/uploadProductFile
csvController.uploadProudctFile = asyncHandler(async (req, res, next) => {});

// route POST /api/v1/inventory/csv/uploadVariantFile
csvController.uploadVariantFile = asyncHandler(async (req, res, next) => {});

const storeData = async (product, req, res, next) => {
  // store data in db
  try {
    let { variants, ...productData } = product;

    productData.colors = JSON.parse(productData.colors);

    productData = await validateProductData(productData);

    // Products no longer have separate Variants (see docs/entities/products.md) - a product is
    // itself the stock-tracked item now. The upload format used to carry sku/barcode on each
    // variant row; fold the first one's identifying fields directly onto the product (a product
    // has a single sku/barcode today, so multiple variant rows per product can no longer map 1:1 -
    // an accepted trade-off of the architecture change).
    const [primaryVariant] = variants ? JSON.parse(variants) : [];
    if (primaryVariant) {
      if (primaryVariant.sku) productData.sku = primaryVariant.sku;
      if (primaryVariant.variantCode) productData.barcode = primaryVariant.variantCode;
    }

    const newProduct = new Product(productData);
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
