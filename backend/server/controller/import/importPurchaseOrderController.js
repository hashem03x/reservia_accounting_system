const mongoose = require('mongoose');
const fs = require('fs').promises;
const csv = require('csv-parse');
const xlsx = require('xlsx');
const Warehouse = require('../../models/inventory/warehouseModel');
const Vendor = require('../../models/vendor/vendor');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const Product = require('../../models/inventory/productModel');
const ApiError = require('../../utils/apiError');
const catchAsync = require('express-async-handler');
const { applyPurchaseToProducts } = require('../PO/purchaseOrderController');

/**
 * Parse CSV file
 * @param {string} filePath - Path to the CSV file
 * @returns {Promise<Array>} - Parsed CSV data
 */
exports.parseCsv = async filePath => {
  const fileContent = await fs.readFile(filePath, 'utf-8');
  return new Promise((resolve, reject) => {
    csv.parse(fileContent, { columns: true }, (err, data) => {
      if (err) reject(err);
      resolve(data);
    });
  });
};

/**
 * Parse Excel file
 * @param {string} filePath - Path to the Excel file
 * @returns {Array} - Parsed Excel data
 */
const parseExcel = filePath => {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(worksheet);
};

/**
 * Parse file data based on file extension
 * @param {Object} file - The uploaded file
 * @returns {Promise<Array>} - Parsed file data
 */
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

/**
 * Import purchase orders from CSV/Excel file
 */
exports.importPurchaseOrder = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new ApiError('Please upload a file', 400));
  }

  console.log('Starting purchase order import process');

  // Log only the count of purchase orders, not the entire data
  if (req.validatedPurchaseOrders) {
    console.log(`Processing ${req.validatedPurchaseOrders.length} purchase order groups`);
    req.validatedPurchaseOrders.forEach((group, index) => {
      console.log(`Group ${index + 1}: Vendor ${group.vendorPhoneNum}, Warehouse ${group.warehouseId}, Items: ${group.items.length}`);
    });
  }

  // Check if there are any purchase orders to process
  if (!req.validatedPurchaseOrders || req.validatedPurchaseOrders.length === 0) {
    return next(new ApiError('No valid purchase orders found in the file', 400));
  }

  // First, validate all data before starting the import
  const preValidationErrors = [];

  // Only validate the first group fully to avoid too many DB queries
  const firstGroup = req.validatedPurchaseOrders[0];

  // Check vendor
  const vendor = await Vendor.findOne({ 'contact.phone': firstGroup.vendorPhoneNum });
  if (!vendor) {
    preValidationErrors.push({
      type: 'vendor',
      value: firstGroup.vendorPhoneNum,
      message: `Vendor with phone number ${firstGroup.vendorPhoneNum} not found`,
    });
  }

  // Check warehouse
  const warehouse = await Warehouse.findById(firstGroup.warehouseId);
  if (!warehouse) {
    preValidationErrors.push({
      type: 'warehouse',
      value: firstGroup.warehouseId,
      message: `Warehouse with ID ${firstGroup.warehouseId} not found`,
    });
  }

  // Check a sample of products (looked up by their barcode - the CSV's "variantCode" column is
  // now a product barcode, since a product is the stock-tracked item and there's no separate
  // Variant to resolve first).
  const sampleSize = Math.min(5, firstGroup.items.length);
  const sampleItems = firstGroup.items.slice(0, sampleSize);

  for (const item of sampleItems) {
    const product = await Product.findOne({ barcode: item.variantCode });
    if (!product) {
      preValidationErrors.push({
        type: 'product',
        value: item.variantCode,
        message: `Product with barcode ${item.variantCode} not found`,
      });
    }
  }

  // If there are pre-validation errors, return them
  if (preValidationErrors.length > 0) {
    console.error('Pre-validation errors:', JSON.stringify(preValidationErrors, null, 2));
    return next(new ApiError('Data validation failed. Please check that all vendors, warehouses, and products exist in the system.', 400, { errors: preValidationErrors }));
  }

  const createdPurchaseOrders = [];
  const errors = [];
  const createdIds = { purchaseOrders: [] }; // Track created IDs for potential rollback

  // Process each order group without using transactions
  for (const orderGroup of req.validatedPurchaseOrders) {
    try {
      // Find vendor by phone number
      const vendor = await Vendor.findOne({ 'contact.phone': orderGroup.vendorPhoneNum });
      if (!vendor) {
        console.error(`Vendor with phone number ${orderGroup.vendorPhoneNum} not found`);
        throw new Error(`Vendor with phone number ${orderGroup.vendorPhoneNum} not found`);
      }

      // Find warehouse
      const warehouse = await Warehouse.findById(orderGroup.warehouseId);
      if (!warehouse) {
        console.error(`Warehouse with ID ${orderGroup.warehouseId} not found`);
        throw new Error(`Warehouse with ID ${orderGroup.warehouseId} not found`);
      }

      // Process items in smaller batches
      const BATCH_SIZE = 50; // Process 50 items at a time
      const purchaseOrderItems = [];
      const invalidItems = [];

      // Process all items first to validate them
      for (let i = 0; i < orderGroup.items.length; i += BATCH_SIZE) {
        const itemBatch = orderGroup.items.slice(i, i + BATCH_SIZE);

        // Process each item in the batch
        for (const item of itemBatch) {
          try {
            // Find the product by barcode (the CSV's "variantCode" column)
            const product = await Product.findOne({ barcode: item.variantCode });
            if (!product) {
              console.error(`Product with barcode ${item.variantCode} not found`);
              invalidItems.push({
                variantCode: item.variantCode,
                error: `Product with barcode ${item.variantCode} not found`,
              });
              continue; // Skip this item but continue with others
            }

            const unitPrice = product.cost || product.price;

            // Create purchase order item
            purchaseOrderItems.push({
              productId: product._id,
              unitPrice: unitPrice,
              itemDiscount: {
                type: 'percentage',
                value: item.discount || 0,
              },
              starterQuantity: parseInt(item.quantity),
            });
          } catch (itemError) {
            console.error(`Error processing item ${item.variantCode}:`, itemError);
            invalidItems.push({
              variantCode: item.variantCode,
              error: itemError.message,
            });
          }
        }
      }

      // If no valid items, skip this order group
      if (purchaseOrderItems.length === 0) {
        console.error(`No valid items found for vendor ${orderGroup.vendorPhoneNum} and warehouse ${orderGroup.warehouseId}`);
        errors.push({
          vendorPhone: orderGroup.vendorPhoneNum,
          warehouseId: orderGroup.warehouseId,
          error: 'No valid items found',
          invalidItems,
        });
        continue; // Skip to next order group
      }

      // Check if req.user exists
      if (!req.user || !req.user._id) {
        console.error('User information is missing in the request');
        throw new Error('User information is missing. Authentication required.');
      }

      // Create purchase order without transaction
      const purchaseOrder = await PurchaseOrder.create({
        vendorId: vendor._id,
        warehouseId: warehouse._id,
        items: purchaseOrderItems,
        createdBy: req.user._id,
        notes: `Imported from CSV on ${new Date().toISOString()}`,
      });
      createdIds.purchaseOrders.push(purchaseOrder._id);

      // Recompute moving-average cost and increment stock for every product this PO touches -
      // same shared logic the regular PO-creation endpoint uses (controller/PO/purchaseOrderController.js),
      // now that items reference a product directly and there's no variant stock to update instead.
      try {
        await applyPurchaseToProducts(purchaseOrder, warehouse._id.toString(), undefined);
      } catch (stockError) {
        console.error(`Error applying purchase to products for order group:`, stockError);
        // We don't throw here to allow the purchase order to be created even if the stock/cost
        // update fails for some items - matches the previous behavior for moving-average failures.
      }

      createdPurchaseOrders.push(purchaseOrder);
    } catch (error) {
      // Log error and continue with next group
      console.error(`Error processing order group:`, error);
      errors.push({
        vendorPhone: orderGroup.vendorPhoneNum,
        warehouseId: orderGroup.warehouseId,
        error: error.message,
        stack: error.stack,
      });
    }
  }

  // If no purchase orders were created, return error
  if (createdPurchaseOrders.length === 0) {
    console.error('No purchase orders were created successfully.');
    console.error('Errors:', JSON.stringify(errors, null, 2));

    // Attempt to clean up any created purchase orders
    if (createdIds.purchaseOrders.length > 0) {
      try {
        await PurchaseOrder.deleteMany({ _id: { $in: createdIds.purchaseOrders } });
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }
    }

    // Clean up uploaded file
    try {
      await fs.unlink(req.file.path);
    } catch (error) {
      console.error('Error deleting uploaded file:', error);
    }

    return next(new ApiError('Failed to import any purchase orders: ' + JSON.stringify(errors), 400));
  }

  // Clean up uploaded file
  try {
    await fs.unlink(req.file.path);
    console.log('Uploaded file deleted');
  } catch (error) {
    console.error('Error deleting uploaded file:', error);
  }

  // Send appropriate response
  if (errors.length > 0) {
    // Partial success
    res.status(207).json({
      status: 'partial_success',
      results: createdPurchaseOrders.length,
      data: {
        purchaseOrders: createdPurchaseOrders,
        errors,
      },
    });
  } else {
    // Complete success
    res.status(201).json({
      status: 'success',
      results: createdPurchaseOrders.length,
      data: {
        purchaseOrders: createdPurchaseOrders,
      },
    });
  }
});
