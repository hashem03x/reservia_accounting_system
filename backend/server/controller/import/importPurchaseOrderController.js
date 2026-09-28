const mongoose = require('mongoose');
const fs = require('fs').promises;
const csv = require('csv-parse');
const xlsx = require('xlsx');
const Variant = require('../../models/inventory/variantModel');
const Warehouse = require('../../models/inventory/warehouseModel');
const Vendor = require('../../models/vendor/vendor');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const Product = require('../../models/inventory/productModel');
const ApiError = require('../../utils/apiError');
const catchAsync = require('express-async-handler');

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
 * Calculate moving average cost for products in a purchase order
 * @param {Object} purchaseOrder - The purchase order
 */
const calculateMovingAverage = async purchaseOrder => {
  try {
    console.log('Starting moving average calculation for purchase order:', purchaseOrder._id);

    // Group items by their product ID to handle multiple variants of the same product
    const variantsByProduct = new Map();

    // First, get all variants and group them by product
    const BATCH_SIZE = 50; // Process 50 items at a time
    for (let i = 0; i < purchaseOrder.items.length; i += BATCH_SIZE) {
      const itemBatch = purchaseOrder.items.slice(i, i + BATCH_SIZE);

      // Process items in parallel
      const itemPromises = itemBatch.map(async item => {
        try {
          const variant = await Variant.findById(item.variantId).populate('productId');

          if (!variant || !variant.productId) {
            return null;
          }

          // Get productId
          const productId = variant.productId._id.toString();

          return {
            productId,
            product: variant.productId,
            variant,
            quantity: item.starterQuantity,
            priceAfterDiscount: item.unitPriceAfterDiscount,
          };
        } catch (error) {
          console.error(`Error processing item ${item._id} for moving average:`, error);
          return null;
        }
      });

      const results = await Promise.all(itemPromises);

      // Add valid results to the map
      for (const result of results) {
        if (result) {
          if (!variantsByProduct.has(result.productId)) {
            variantsByProduct.set(result.productId, {
              product: result.product,
              items: [],
            });
          }

          variantsByProduct.get(result.productId).items.push({
            variant: result.variant,
            quantity: result.quantity,
            priceAfterDiscount: result.priceAfterDiscount,
          });
        }
      }
    }

    // Calculate and update the moving average for each product
    const productIds = Array.from(variantsByProduct.keys());
    console.log(`Calculating moving average for ${productIds.length} products`);

    // Process products in batches
    const PRODUCT_BATCH_SIZE = 10;
    for (let i = 0; i < productIds.length; i += PRODUCT_BATCH_SIZE) {
      const batchProductIds = productIds.slice(i, i + PRODUCT_BATCH_SIZE);
      console.log(`Processing product batch ${Math.floor(i / PRODUCT_BATCH_SIZE) + 1}/${Math.ceil(productIds.length / PRODUCT_BATCH_SIZE)}`);

      // Process products in parallel
      const productPromises = batchProductIds.map(async productId => {
        try {
          const { product, items } = variantsByProduct.get(productId);

          // Calculate q_available (total quantity in stock before purchase)
          const variants = await Variant.find({ productId: product._id });

          const q_available = variants.reduce((total, variant) => {
            return total + variant.stock.reduce((sum, stock) => sum + stock.quantity, 0);
          }, 0);

          // Calculate q_purchased (total quantity purchased in this PO)
          const q_purchased = items.reduce((total, item) => total + item.quantity, 0);

          // Calculate t_available (total cost of available stock)
          const t_available = q_available * (product.cost || 0);

          // Calculate t_purchased (total cost of purchased items)
          const t_purchased = items.reduce((total, item) => {
            return total + item.quantity * (item.priceAfterDiscount || 0);
          }, 0);

          // Calculate new average cost for the product after purchase
          let newCost = 0;
          if (q_available + q_purchased > 0) {
            newCost = (t_available + t_purchased) / (q_available + q_purchased);
          }

          // Update product cost
          await Product.findByIdAndUpdate(productId, { cost: newCost });

          return {
            productId,
            success: true,
            newCost,
            q_available,
            q_purchased,
            t_available,
            t_purchased,
          };
        } catch (error) {
          console.error(`Error calculating moving average for product ${productId}:`, error);
          return { productId, success: false, error: error.message };
        }
      });

      const results = await Promise.all(productPromises);
      const successCount = results.filter(r => r.success).length;
      console.log(`Updated moving average for ${successCount}/${batchProductIds.length} products`);
    }

    console.log('Moving average calculation completed successfully');
  } catch (error) {
    console.error('Error in calculateMovingAverage function:', error);
    throw error; // Re-throw to be caught by the caller
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

  // Check a sample of variants
  const sampleSize = Math.min(5, firstGroup.items.length);
  const sampleItems = firstGroup.items.slice(0, sampleSize);

  for (const item of sampleItems) {
    const variant = await Variant.findOne({ variantCode: item.variantCode });
    if (!variant) {
      preValidationErrors.push({
        type: 'variant',
        value: item.variantCode,
        message: `Variant with code ${item.variantCode} not found`,
      });
    }
  }

  // If there are pre-validation errors, return them
  if (preValidationErrors.length > 0) {
    console.error('Pre-validation errors:', JSON.stringify(preValidationErrors, null, 2));
    return next(new ApiError('Data validation failed. Please check that all vendors, warehouses, and variants exist in the system.', 400, { errors: preValidationErrors }));
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
      const validatedItems = [];
      const invalidItems = [];

      // Process all items first to validate them
      for (let i = 0; i < orderGroup.items.length; i += BATCH_SIZE) {
        const itemBatch = orderGroup.items.slice(i, i + BATCH_SIZE);

        // Process each item in the batch
        for (const item of itemBatch) {
          try {
            // Find variant
            const variant = await Variant.findOne({ variantCode: item.variantCode });
            if (!variant) {
              console.error(`Variant with code ${item.variantCode} not found`);
              invalidItems.push({
                variantCode: item.variantCode,
                error: `Variant with code ${item.variantCode} not found`,
              });
              continue; // Skip this item but continue with others
            }

            // Get product details to determine unit price
            const product = await variant.populate('productId');
            if (!product || !product.productId) {
              console.error(`Product not found for variant ${variant._id}`);
              invalidItems.push({
                variantCode: item.variantCode,
                error: `Product not found for variant ${variant._id}`,
              });
              continue; // Skip this item but continue with others
            }

            const unitPrice = product.productId.cost || product.productId.price;

            // Add to validated items
            validatedItems.push({
              variant,
              unitPrice,
              quantity: parseInt(item.quantity),
              discount: parseFloat(item.discount || 0),
            });

            // Create purchase order item
            purchaseOrderItems.push({
              variantId: variant._id,
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

      // Update variant stock in batches
      for (let i = 0; i < validatedItems.length; i += BATCH_SIZE) {
        const itemBatch = validatedItems.slice(i, i + BATCH_SIZE);

        // Use Promise.all to update stock in parallel
        const updatePromises = itemBatch.map(async validItem => {
          try {
            // Find if warehouse already exists in stock
            const warehouseStockIndex = validItem.variant.stock.findIndex(stock => stock.warehouse.toString() === orderGroup.warehouseId);

            if (warehouseStockIndex >= 0) {
              // Update existing warehouse stock
              validItem.variant.stock[warehouseStockIndex].quantity += validItem.quantity;
            } else {
              // Add new warehouse stock
              validItem.variant.stock.push({
                warehouse: orderGroup.warehouseId,
                quantity: validItem.quantity,
                starterQuantity: validItem.quantity,
              });
            }

            await validItem.variant.save();
            return { success: true, variantCode: validItem.variant.variantCode };
          } catch (stockError) {
            console.error(`Error updating stock for variant ${validItem.variant.variantCode}:`, stockError);
            return { success: false, variantCode: validItem.variant.variantCode, error: stockError.message };
          }
        });

        const results = await Promise.all(updatePromises);
        const successCount = results.filter(r => r.success).length;
      }

      // Calculate moving average cost for the purchase order
      try {
        await calculateMovingAverage(purchaseOrder);
      } catch (avgError) {
        console.error(`Error calculating moving average:`, avgError);
        // We don't throw here to allow the purchase order to be created even if moving average calculation fails
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
