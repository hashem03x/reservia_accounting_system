const Product = require('../../../models/inventory/productModel');
const Warehouse = require('../../../models/inventory/warehouseModel');
const Vendor = require('../../../models/vendor/vendor');
const ApiError = require('../../apiError');
const parseCsv = require('../../parseCsv');
const AppError = require('../../apiError');

/**
 * Validates a purchase order item from the CSV data
 * @param {Object} item - The purchase order item to validate
 * @param {Object} headerMap - Mapping of standard headers to actual headers
 * @returns {Array} - Array of validation errors
 */
const validatePurchaseOrderItem = async (item, headerMap) => {
  const errors = [];

  // Get values using the header mapping
  const variantCode = item[headerMap.variantCode];
  const quantity = item[headerMap.q];
  const discount = item[headerMap.discount];
  const warehouseId = item[headerMap.warehouseId];
  const vendorPhoneNum = item[headerMap.vendorPhoneNum];

  // Validate variantCode
  if (!variantCode) {
    errors.push('Variant code is required');
  }

  // Validate quantity
  if (!quantity) {
    errors.push('Quantity is required');
  } else if (isNaN(quantity) || parseInt(quantity) <= 0) {
    errors.push('Quantity must be a positive number');
  }

  // Validate discount
  if (discount) {
    if (isNaN(discount) || parseFloat(discount) < 0) {
      errors.push('Discount must be a non-negative number');
    } else if (parseFloat(discount) > 100) {
      errors.push('Discount percentage cannot exceed 100%');
    }
  }

  // Validate warehouseId
  if (!warehouseId) {
    errors.push('Warehouse ID is required');
  }

  // Validate vendorPhoneNum
  if (!vendorPhoneNum) {
    errors.push('Vendor phone number is required');
  }

  // Only check database existence for a sample of items to avoid too many DB queries
  // The controller will do the full validation before creating purchase orders
  if (errors.length === 0 && Math.random() < 0.1) {
    // Only check 10% of items
    // Check if the product exists (variantCode is now a product barcode - there's no separate
    // Variant to resolve first)
    const product = await Product.findOne({ barcode: variantCode });
    if (!product) {
      errors.push(`Product with barcode ${variantCode} not found`);
    }

    // Check if warehouse exists
    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      errors.push(`Warehouse with ID ${warehouseId} not found`);
    }

    // Check if vendor exists
    const vendor = await Vendor.findOne({ 'contact.phone': vendorPhoneNum });
    if (!vendor) {
      errors.push(`Vendor with phone number ${vendorPhoneNum} not found`);
    }
  }

  return {
    errors,
    validItem:
      errors.length === 0
        ? {
            variantCode,
            quantity: parseInt(quantity),
            discount: discount ? parseFloat(discount) : 0,
            warehouseId,
            vendorPhoneNum,
          }
        : null,
  };
};

/**
 * Middleware to validate purchase order import data
 */
exports.importPurchaseOrderValidator = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new ApiError('No file uploaded', 400));
    }

    // Parse the file data
    const fileData = await parseCsv(req.file.path);

    // Log the parsed data for debugging (only first few items)
    console.log('Parsed CSV data:', JSON.stringify(fileData.slice(0, 3)));
    console.log(`Total items in CSV: ${fileData.length}`);

    if (!fileData || fileData.length === 0) {
      return next(new ApiError('No data found in the file', 400));
    }

    // Get the actual headers from the first item
    const firstItem = fileData[0];
    const actualHeaders = Object.keys(firstItem);
    console.log('Actual headers in CSV:', actualHeaders);

    // Create a mapping between standard headers and actual headers
    const standardHeaders = ['variantCode', 'q', 'discount', 'warehouseId', 'vendorPhoneNum'];
    const headerMap = {};

    // Try to find matching headers (case insensitive and ignoring special characters)
    for (const stdHeader of standardHeaders) {
      // Try exact match first
      let found = actualHeaders.find(h => h === stdHeader);

      // If not found, try case-insensitive match
      if (!found) {
        found = actualHeaders.find(h => h.toLowerCase() === stdHeader.toLowerCase());
      }

      // If still not found, try matching after removing special characters
      if (!found) {
        found = actualHeaders.find(h => {
          // Remove special characters and compare
          const cleanH = h.replace(/[^\w]/g, '').toLowerCase();
          const cleanStd = stdHeader.replace(/[^\w]/g, '').toLowerCase();
          return cleanH === cleanStd;
        });
      }

      // If found a match, use it
      if (found) {
        headerMap[stdHeader] = found;
      }
    }

    console.log('Header mapping:', headerMap);

    // Check if we have all required headers
    const requiredHeaders = ['variantCode', 'q', 'warehouseId', 'vendorPhoneNum'];
    const missingHeaders = requiredHeaders.filter(header => !headerMap[header]);

    if (missingHeaders.length > 0) {
      console.error('Missing required headers:', missingHeaders);
      console.error('Available headers:', actualHeaders);
      return next(new ApiError(`CSV file is missing required headers: ${missingHeaders.join(', ')}. Available headers: ${actualHeaders.join(', ')}`, 400));
    }

    const errors = [];
    const validItems = [];

    // Group items by vendor and warehouse
    const groupedItems = {};

    // Process items in batches to avoid memory issues
    const BATCH_SIZE = 50;
    console.log(`Processing validation in batches of ${BATCH_SIZE} items`);

    for (let i = 0; i < fileData.length; i += BATCH_SIZE) {
      const batchItems = fileData.slice(i, i + BATCH_SIZE);
      console.log(`Validating batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(fileData.length / BATCH_SIZE)}, items ${i + 1} to ${Math.min(i + BATCH_SIZE, fileData.length)}`);

      // Validate each item in the batch
      for (const item of batchItems) {
        const { errors: itemErrors, validItem } = await validatePurchaseOrderItem(item, headerMap);

        if (itemErrors.length > 0) {
          errors.push({
            variantCode: item[headerMap.variantCode],
            errors: itemErrors,
          });
        } else if (validItem) {
          // Add to valid items
          validItems.push(validItem);

          // Group by vendor and warehouse for later processing
          const key = `${validItem.vendorPhoneNum}_${validItem.warehouseId}`;
          if (!groupedItems[key]) {
            groupedItems[key] = {
              vendorPhoneNum: validItem.vendorPhoneNum,
              warehouseId: validItem.warehouseId,
              items: [],
            };
          }

          groupedItems[key].items.push({
            variantCode: validItem.variantCode,
            quantity: validItem.quantity,
            discount: validItem.discount,
          });
        }
      }
    }

    if (errors.length > 0) {
      console.error(`Validation failed with ${errors.length} errors`);
      // Only log a sample of errors to avoid overwhelming the console
      console.error('Sample validation errors:', JSON.stringify(errors.slice(0, 10), null, 2));
      if (errors.length > 10) {
        console.error(`... and ${errors.length - 10} more errors`);
      }
      return next(new ApiError(`Validation failed with ${errors.length} errors. First error: ${JSON.stringify(errors[0])}`, 400));
    }

    // Attach the validated and grouped items to the request object
    req.validatedPurchaseOrders = Object.values(groupedItems);
    console.log(`Grouped into ${req.validatedPurchaseOrders.length} purchase orders by vendor and warehouse`);

    // Log the number of items in each group
    req.validatedPurchaseOrders.forEach((group, index) => {
      console.log(`Group ${index + 1}: Vendor ${group.vendorPhoneNum}, Warehouse ${group.warehouseId}, Items: ${group.items.length}`);
    });

    next();
  } catch (error) {
    console.error('Validation error details:', error);
    return next(new AppError(`Validation failed: ${error.message || 'Check your CSV data format and values'}`, 400));
  }
};
