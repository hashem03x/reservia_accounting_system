const Category = require('../../../models/categoryModel');
const SubCategory = require('../../../models/subCategoryModel');
const Warehouse = require('../../../models/inventory/warehouseModel');
const ApiError = require('../../apiError');
const parseCsv = require('../../parseCsv');
const transformFileDataToProductData = require('../../transformFileDataToProductData');
const productModel = require('../../../models/inventory/productModel');

const validateProduct = async product => {
  const errors = [];
  // Validate title
  if (!product.title || typeof product.title !== 'object' || !product.title.en || !product.title.ar) {
    errors.push('Title must include both English and Arabic translations');
  }

  // Validate description
  if (!product.description || typeof product.description !== 'object' || !product.description.en || !product.description.ar) {
    errors.push('Description must include both English and Arabic translations');
  }

  // Clean and validate cost
  if (!product.cost && product.cost !== 0) {
    errors.push('Product cost is required');
  } else if (isNaN(product.cost) || product.cost < 0) {
    errors.push('Product cost must be a positive number');
  }

  // Clean and validate price
  if (!product.price && product.price !== 0) {
    errors.push('Product price is required');
  } else {
    // Clean the price value by removing commas and spaces
    const cleanedPrice = typeof product.price === 'string' ? parseFloat(product.price.replace(/,/g, '').trim()) : product.price;

    if (isNaN(cleanedPrice) || cleanedPrice < 0) {
      errors.push('Product price must be a positive number');
    } else if (cleanedPrice > 2500000) {
      errors.push('Price cannot exceed 2500000');
    } else {
      // Update the product price with the cleaned value
      product.price = cleanedPrice;
    }
  }

  // Clean and validate priceAfterDiscount
  if (product.priceAfterDiscount) {
    const cleanedDiscountPrice = typeof product.priceAfterDiscount === 'string' ? parseFloat(product.priceAfterDiscount.replace(/,/g, '').trim()) : product.priceAfterDiscount;

    if (isNaN(cleanedDiscountPrice)) {
      errors.push('Price after discount must be a number');
    } else if (cleanedDiscountPrice >= product.price) {
      errors.push('Price after discount must be less than regular price');
    } else {
      // Update the product priceAfterDiscount with the cleaned value
      product.priceAfterDiscount = cleanedDiscountPrice;
    }
  }

  // Validate category
  if (!product.category) {
    errors.push('Category is required');
  } else {
    const category = await Category.findById(product.category);
    if (!category) {
      errors.push('Invalid category ID');
    }
  }

  // Validate subcategory
  if (!product.subcategory) {
    errors.push('Subcategory is required');
  } else {
    const subcategory = await SubCategory.findById(product.subcategory);
    if (!subcategory) {
      errors.push('Invalid subcategory ID');
    }
  }

  // Validate capacity (optional)
  if (product.capacity && product.capacity.value !== undefined && isNaN(product.capacity.value)) {
    errors.push('Capacity value must be a number');
  }

  // Validate stock rows (each CSV row contributes a per-warehouse quantity)
  if (!product.rows || !Array.isArray(product.rows) || product.rows.length === 0) {
    errors.push('Product must have at least one stock row');
  } else {
    for (const row of product.rows) {
      if (row.quantity === undefined || row.quantity === null || isNaN(row.quantity) || row.quantity < 0) {
        errors.push('Each stock row must have a non-negative quantity');
      }
    }
  }

  return errors;
};

exports.importProductAndVariantValidator = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new ApiError('No file uploaded', 400));
    }

    // Parse the file data
    const fileData = await parseCsv(req.file.path);

    // Transform CSV data to required format
    const productGroups = transformFileDataToProductData(fileData);

    const errors = [];

    if (!productGroups || Object.keys(productGroups).length === 0) {
      errors.push('No products found in the file');
      return next(new ApiError('No products found in the file', 400));
    }

    // Validate each product
    for (const product of productGroups) {
      const productErrors = await validateProduct(product);
      if (productErrors.length > 0) {
        errors.push({ sku: product.sku || 'Unknown SKU', errors: productErrors });
      }
    }

    if (errors.length > 0) {
      console.log('Validation errors:', JSON.stringify(errors, null, 2));
      // Store validation errors in the request object for the controller to access
      req.validationErrors = errors;
      return next(new ApiError('Validation failed', 400, { validationErrors: errors }));
    }

    // Attach the validated products to the request object
    req.validatedProducts = productGroups;
    next();
  } catch (error) {
    console.error('Error in validator:', error);
    next(new ApiError(`Validation error: ${error.message}`, 400));
  }
};
