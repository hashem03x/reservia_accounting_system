const mongoose = require('mongoose');
const fs = require('fs').promises;
const xlsx = require('xlsx');
const Product = require('../../models/inventory/productModel');
const Warehouse = require('../../models/inventory/warehouseModel');
const ApiError = require('../../utils/apiError');
const catchAsync = require('express-async-handler');
const transformFileDataToProductData = require('../../utils/transformFileDataToProductData');
// Reuses the SAME parser the validator middleware uses (importProductAndVariantValidator.js) -
// this used to be a second, independently-maintained copy with different csv-parse options
// (no BOM stripping, no skip_records_with_error, no comment-line support), so the validator and
// this controller could parse the identical uploaded file into two different row sets. A single
// shared implementation means "what the validator approved" and "what actually gets imported" can
// never drift apart again.
exports.parseCsv = require('../../utils/parseCsv');

const parseExcel = filePath => {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(worksheet);
};

const parseFileData = async file => {
  const fileExtension = file.originalname.split('.').pop().toLowerCase();

  if (fileExtension === 'xlsx' || fileExtension === 'xls') {
    return parseExcel(file.path);
  } else if (fileExtension === 'csv') {
    return exports.parseCsv(file.path);
  } else {
    throw new ApiError('Unsupported file format. Please upload CSV or Excel file.', 400);
  }
};

exports.importProductAndVariant = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new ApiError('Please upload a file', 400));
  }

  try {
    console.log(`Reading file: ${req.file.path}`);
    const stats = await fs.stat(req.file.path);
    console.log(`File size: ${stats.size} bytes`);

    // Get default warehouse
    const defaultWarehouse = await Warehouse.findOne({ isDefault: true });
    if (!defaultWarehouse) {
      return next(new ApiError('No default warehouse found. Please set a default warehouse first.', 400));
    }

    // Parse file data
    const fileData = await parseFileData(req.file);
    console.log(`CSV Headers: ${JSON.stringify(Object.keys(fileData[0] || {}), null, 2)}`);
    console.log(`Parsed ${fileData.length} records from CSV`);

    // Check if we have validation errors from the validator middleware
    if (req.validationErrors) {
      console.log('Validation errors:', JSON.stringify(req.validationErrors, null, 2));
      return next(new ApiError('Validation failed', 400, { validationErrors: req.validationErrors }));
    }

    // Transform data - SKUs will be auto-generated for stock rows if not provided
    const transformedData = transformFileDataToProductData(fileData);

    const productsToImport = transformedData;
    const importErrors = [];

    // If no valid products to import, return error
    if (productsToImport.length === 0) {
      return next(new ApiError('No valid products found to import', 400));
    }

    // Import products one by one without using transactions
    const importedProducts = [];
    const createdIds = { products: [] }; // Track created IDs for potential rollback

    // Import each validated product
    for (const productData of productsToImport) {
      try {
        // A product carries its own per-warehouse stock directly. Each transformed CSV row
        // contributes a quantity to a warehouse; rows sharing a warehouse are summed into that
        // warehouse's single stock entry. Honor the CSV's own warehouse column when it resolves to
        // a real warehouse, falling back to the tenant's default warehouse when it's blank or
        // doesn't match anything.
        const { rows, ...productCreateData } = productData;
        const stockByWarehouse = new Map();
        let barcodeFromCsv;

        for (const row of rows) {
          let targetWarehouse = defaultWarehouse;
          if (row.warehouse) {
            const resolved = mongoose.Types.ObjectId.isValid(row.warehouse) ? await Warehouse.findById(row.warehouse) : null;
            if (resolved) {
              targetWarehouse = resolved;
            } else {
              console.warn(`[importProductAndVariant] row warehouse "${row.warehouse}" not found - using default warehouse`, {
                sku: row.sku,
              });
            }
          }

          const warehouseId = targetWarehouse._id.toString();
          stockByWarehouse.set(warehouseId, (stockByWarehouse.get(warehouseId) || 0) + (row.quantity || 0));

          // A product has a single barcode now - keep the first one explicitly supplied by the CSV
          // (if any); otherwise the product falls back to its own auto-generated default.
          if (!barcodeFromCsv && row.barcode) barcodeFromCsv = row.barcode;
        }

        const stock = Array.from(stockByWarehouse, ([warehouse, quantity]) => ({ warehouse, quantity }));

        // Create the product with its aggregated stock
        const product = await Product.create({
          ...productCreateData,
          stock,
          ...(barcodeFromCsv ? { barcode: barcodeFromCsv } : {}),
        });

        createdIds.products.push(product._id);

        console.log(`[importProductAndVariant] created product`, {
          productId: String(product._id),
          sku: product.sku,
          title: productData.title?.en,
          stockEntries: stock.length,
        });

        importedProducts.push(product);
      } catch (error) {
        // If there's an error with a specific product, log it and continue with others - but
        // always log it server-side first (previously this was silently absorbed into a response
        // field with zero console output, so a partial-success import left no server-side trail
        // of what actually failed and why).
        console.error(`[importProductAndVariant] failed to import product`, {
          sku: productData?.sku,
          title: productData?.title?.en,
          operation: 'create',
          reason: error.message,
          stack: error.stack,
        });
        importErrors.push({
          sku: productData.sku,
          error: error.message,
          details: error.errors || {},
        });
      }
    }

    // If no products were imported successfully, roll back any partial imports and return error
    if (importedProducts.length === 0 && createdIds.products.length > 0) {
      // Attempt to clean up any created products
      try {
        if (createdIds.products.length > 0) {
          await Product.deleteMany({ _id: { $in: createdIds.products } });
        }
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }

      return next(new ApiError('Failed to import any products', 400, { errors: importErrors }));
    }

    // Send appropriate response
    if (importErrors.length > 0) {
      // Partial success
      res.status(207).json({
        status: 'partial_success',
        results: importedProducts.length,
        data: {
          products: importedProducts,
          errors: importErrors,
        },
      });
    } else {
      // Complete success
      res.status(201).json({
        status: 'success',
        results: importedProducts.length,
        data: {
          products: importedProducts,
        },
      });
    }
  } catch (error) {
    // Pass the original error to the error handler
    return next(new ApiError(error.message, 400, { errors: error.errors || {} }));
  } finally {
    // Clean up uploaded file
    try {
      await fs.unlink(req.file.path);
    } catch (error) {
      // Silently handle file deletion errors
    }
  }
});
