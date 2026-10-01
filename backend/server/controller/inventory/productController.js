const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('express-async-handler');
const { Readable } = require('stream');
const fs = require('fs');
const { Parser } = require('json2csv');
const ApiError = require('../../utils/apiError');
const { uploadMixOfFiles } = require('../../middleware/uploadImageMiddleware');
const Product = require('../../models/inventory/productModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const SalesOrder = require('../../models/sales/salesOrderModel');
const Transfer = require('../../models/inventory/transferModel');
const factory = require('../handlersFactory');
const apiResponse = require('../../utils/apiResponse');
const { default: mongoose } = require('mongoose');
// 0 = maximum compression, lowest quality, smallest file size
// 100 = minimum compression, highest quality, largest file size

const BASE_URL = process.env.NODE_ENV == 'production' ? `${process.env.PROD_URL}` : `${process.env.DEV_URL}`;
const IMAGE_QUALITY = +process.env.IMAGE_QUALITY || 60;

// Configure Sharp globally
sharp.cache(false); // Disable caching

const processImage = async (buffer, filename) => {
  // Keep original extension
  const filepath = path.join('uploads', 'products', filename);

  // Create write stream
  const writeStream = fs.createWriteStream(filepath);

  // Save original buffer directly without any processing
  await new Promise((resolve, reject) => {
    const stream = Readable.from(buffer);
    stream.pipe(writeStream).on('finish', resolve).on('error', reject);
  });

  return `${BASE_URL}/products/${filename}`;
};

// Helper function to delete image file
const deleteImage = async filename => {
  try {
    if (!filename) return;
    // const filepath = path.join(process.cwd(), 'uploads', 'products', filename);
    const filepath = path.join('uploads', 'products', filename);
    await fs.unlink(filepath);
  } catch (error) {
    console.error('Error deleting file:', error);
  }
};

exports.uploadProductImages = asyncHandler(async (req, res, next) => {
  const uploadFields = [{ name: 'imageCover', maxCount: 1 }];

  return uploadMixOfFiles(uploadFields)(req, res, next);
});

exports.handleProductImages = asyncHandler(async (req, res, next) => {
  if (!req.files) return next();

  try {
    // Process cover image if provided
    if (req.files.imageCover) {
      const coverFilename = `product-${uuidv4()}-${Date.now()}-cover.${req.files.imageCover[0].originalname.split('.').pop()}`;
      const coverUrl = await processImage(req.files.imageCover[0].buffer, coverFilename);
      req.body.imageCover = {
        url: coverUrl,
        filename: coverFilename,
      };
    }

    next();
  } catch (error) {
    next(new ApiError(`Error processing images: ${error.message}`, 500));
  }
});

exports.updateProductImages = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!req.files) return next();

  const product = await Product.findById(id);
  if (!product) return next(new ApiError('Product not found', 404));

  try {
    // Update cover image if provided
    if (req.files.imageCover) {
      const coverFilename = `product-${uuidv4()}-${Date.now()}-cover.${req.files.imageCover[0].originalname.split('.').pop()}`;
      const coverUrl = await processImage(req.files.imageCover[0].buffer, coverFilename);
      product.imageCover = {
        url: coverUrl,
        filename: coverFilename,
      };
      await product.save();
    }

    next();
  } catch (error) {
    next(new ApiError(`Error updating images: ${error.message}`, 500));
  }
});

// `stock` arrives as a JSON string over multipart/form-data (FormData can't carry nested arrays
// directly - see the product-handler's InventoryInformation component on the frontend). Parse it
// back into the array the schema expects before validation/persistence. Not gated behind
// `req.files` existing since a product save with no new image files must still get its stock
// parsed.
exports.parseProductStock = asyncHandler(async (req, res, next) => {
  if (typeof req.body.stock === 'string') {
    try {
      req.body.stock = JSON.parse(req.body.stock);
    } catch (error) {
      return next(new ApiError('Invalid stock data', 400));
    }
  }
  next();
});

// `capacity` (e.g. { value: 100, unit: 'kW' }) arrives as a JSON string over multipart/form-data
// for the same reason `stock` does - FormData can't carry nested objects directly. Not gated
// behind `req.files` existing, same reasoning as parseProductStock above.
exports.parseProductCapacity = asyncHandler(async (req, res, next) => {
  if (typeof req.body.capacity === 'string') {
    try {
      req.body.capacity = req.body.capacity ? JSON.parse(req.body.capacity) : undefined;
    } catch (error) {
      return next(new ApiError('Invalid capacity data', 400));
    }
  }
  next();
});

exports.updateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  if (updateData.priceAfterDiscount == null || updateData.priceAfterDiscount == 0) {
    updateData.priceAfterDiscount = null;
    // console.log('updateData.priceAfterDiscount', updateData.priceAfterDiscount);
  }

  const updatedProduct = await Product.findByIdAndUpdate(
    id,
    { $set: updateData },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updatedProduct) {
    throw new ApiError('No product found with that ID', 404);
  }

  res.status(200).json({
    status: 'success',
    data: updatedProduct,
  });
});

// create product
exports.createProduct = factory.createOne(Product);

exports.createFilterObject = asyncHandler(async (req, res, next) => {
  let filterObject = {};

  const { mainCategoryId, subCategories, sizes, isDeleted, isAvailable } = req.query;

  const categoryFilter = mainCategoryId ? { category: mainCategoryId } : {};

  if (mainCategoryId) delete req.query.mainCategoryId;

  const subCategoryFilter = subCategories
    ? {
        subcategory: {
          $in: subCategories
            .split(',')
            .map(subcategory => subcategory.trim())
            .filter(subcategory => subcategory !== ''),
        },
      }
    : {};

  if (subCategories) delete req.query.subCategories;

  const sizeFilter = sizes
    ? {
        'stock.sizes.size': {
          $in: sizes
            .split(',')
            .map(size => size.trim())
            .filter(size => size !== ''),
        },
      }
    : {};

  if (sizes) delete req.query.sizes;

  const isDeletedFilter = isDeleted ? { isDeleted: isDeleted === 'true' } : {};
  const isAvailableFilter = isAvailable ? { isAvailable: isAvailable === 'true' } : {};

  if (isDeleted) delete req.query.isDeleted;
  if (isAvailable) delete req.query.isAvailable;

  filterObject = {
    ...categoryFilter,
    ...subCategoryFilter,
    ...sizeFilter,
    ...isDeletedFilter,
    ...isAvailableFilter,
  };

  req.filterObject = filterObject;
  next();
});

exports.getProducts = factory.getAll(Product, 'Products', ' ', false);

exports.getFilteredProducts = asyncHandler(async (req, res, next) => {
  const { format } = req.query; // Check if CSV format is requested
  const allProducts = await Product.find().sort({ createdAt: -1 });

  // A Product no longer has per-color variants to check stock against - a product now carries its
  // own stock directly, so "has it got anything sellable" is just "does it have stock anywhere".
  const filteredProducts = allProducts.map(product => product.toObject()).filter(product => product.type === 'service' || (product.stock || []).some(s => s.quantity > 0));

  // If CSV format is requested
  if (format === 'csv') {
    try {
      // Prepare data for CSV with only required fields
      const csvData = filteredProducts.map(product => {
        const imageUrl = product.imageCover?.url || '';

        return {
          id: product._id,
          // No public storefront in the Reversia accounting app - product detail pages don't exist.
          url: '',
          title_en: product.title?.en || '',
          title_ar: product.title?.ar || '',
          description_en: product.description?.en || '',
          description_ar: product.description?.ar || '',
          price: product.price || 0,
          priceAfterDiscount: product.priceAfterDiscount || product.price || 0,
          image: imageUrl,
          availability: product.isAvailable && !product.isDeleted ? 'In Stock' : 'Out of Stock',
          condition: 'New',
        };
      });

      // Define CSV fields
      const fields = [
        { label: 'id', value: 'id' },
        { label: 'link', value: 'url' },
        { label: 'title', value: 'title_en' },
        // { label: 'title', value: 'title_ar' },
        { label: 'description', value: 'description_en' },
        // { label: 'description', value: 'description_ar' },
        { label: 'price', value: 'price' },
        { label: 'price_after_discount', value: 'priceAfterDiscount' },
        { label: 'image_link', value: 'image' },
        { label: 'availability', value: 'availability' },
        { label: 'condition', value: 'condition' },
      ];

      // Create CSV parser
      const json2csvParser = new Parser({ fields });
      const csv = json2csvParser.parse(csvData);

      // Set headers for CSV download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="products-${Date.now()}.csv"`);

      return res.status(200).send(csv);
    } catch (error) {
      return next(new ApiError(`Error generating CSV: ${error.message}`, 500));
    }
  }

  // Default JSON response
  res.json({
    length: filteredProducts.length,
    data: filteredProducts,
  });
});

exports.getProduct = factory.getOne(Product);

exports.getProductsByIds = asyncHandler(async (req, res, next) => {
  let { ids, page = 1, limit = 10 } = req.query;
  if (!ids) return res.status(400).json({ status: 'fail', message: 'ids parameter is required' });

  try {
    if (typeof ids === 'string') {
      if (ids.startsWith('[')) {
        ids = JSON.parse(ids);
      } else {
        ids = ids.split(',');
      }
    }

    if (!Array.isArray(ids)) {
      return res.status(400).json({ status: 'fail', message: 'ids must be an array' });
    }

    // ✅ فلترة + تحويل
    ids = ids.filter(id => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));

    if (ids.length === 0) {
      return res.status(400).json({ status: 'fail', message: 'No valid ObjectIds provided' });
    }

    page = parseInt(page);
    limit = parseInt(limit);
    const skip = (page - 1) * limit;

    const query = { _id: { $in: ids } };
    const total = await Product.countDocuments(query);
    const products = await Product.find(query).skip(skip).limit(limit);
    const numberOfPages = Math.ceil(total / limit);

    res.status(200).json({
      data: products,
      results: products.length,
      paginationResult: {
        numberOfPages,
        currentPage: page,
        limit: limit,
      },
    });
  } catch (error) {
    console.log(error);
    return next(new ApiError('Invalid ids parameter', 400));
  }
});

exports.updateProduct2 = factory.updateOne(Product);

exports.deleteProduct = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const product = await Product.findById(id);

  if (!product) {
    return next(new ApiError('No product found with that ID', 404));
  }

  // Zero out stock everywhere instead of deleting it - a deleted product keeps its stock history
  // (mirrors the old "mark variant deleted + zero its stock" behavior, now done directly on the
  // product since there's no separate variant to carry that state).
  product.stock.forEach(s => {
    s.quantity = 0;
  });

  product.isDeleted = true;
  product.imageCover = {};
  await product.save();

  res.status(200).json({
    status: 'success',
    message: 'Product deleted successfully',
    data: { product },
  });
});

exports.deleteProductImage = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { image } = req.body;

  const imageName = image.startsWith('http') ? image.split('/').pop() : image;

  const product = await Product.findByIdAndUpdate(id, { $pull: { 'stock.$[].image': imageName } }, { new: true });

  if (!product) {
    return next(new ApiError('No document found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Image deleted successfully',
    data: product,
  });
});

exports.applyDiscount = asyncHandler(async (req, res, next) => {
  const { discount } = req.body;

  if (discount > 100 || discount < 0) {
    return res.status(400).json({
      status: 'fail',
      message: 'Invalid discount value',
    });
  }

  const products = await Product.find({}).select('price priceAfterDiscount');

  for (const product of products) {
    const discountedPrice = parseFloat((product.price * (1 - discount / 100)).toFixed(2));
    product.priceAfterDiscount = discountedPrice;
    await product.save();
  }

  res.status(200).json({
    status: 'success',
    message: 'All products price updated successfully',
  });
});

exports.applyDiscountToProduct = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { discount } = req.body;

  if (discount > 100 || discount < 0) {
    return res.status(400).json({
      status: 'fail',
      message: 'Invalid discount value',
    });
  }

  const product = await Product.findById(id).select('price priceAfterDiscount');

  if (!product) {
    return res.status(404).json({
      status: 'fail',
      message: 'Product not found',
    });
  }

  const discountedPrice = parseFloat((product.price * (1 - discount / 100)).toFixed(2));

  product.priceAfterDiscount = discountedPrice;
  await product.save();

  res.status(200).json({
    status: 'success',
    message: 'Product price updated successfully',
    data: product,
  });
});

/**
 * @description Get a single product by its barcode - powers the PO/SO "scan or search an item"
 * flow (replaces the removed Variant module's getVariantByCode).
 * @route GET /api/v1/products/code/:code
 * @access Private
 */
exports.getProductByCode = asyncHandler(async (req, res, next) => {
  const { code } = req.params;

  const product = await Product.findOne({ barcode: code }).lean();
  if (!product) {
    return next(new ApiError('Product not found with this code', 404));
  }

  res.status(200).json(apiResponse('Product found', true, product));
});

/**
 * @description Get all purchase and sales orders containing a specific product (by barcode)
 * @route GET /api/v1/products/orders/:code
 * @access Private
 * Ported from the removed Variant module's getOrdersByVariantCode - same capability, now keyed by
 * Product.barcode (replaces Variant.variantCode) and queried directly against Product, with no
 * variant-resolution step in between.
 */
exports.getOrdersByProductCode = asyncHandler(async (req, res, next) => {
  const { code } = req.params;

  const product = await Product.findOne({ barcode: code }).select('title cost price priceAfterDiscount barcode sku');
  if (!product) {
    return next(new ApiError('Product not found with this code', 404));
  }

  const purchaseOrders = await PurchaseOrder.find({ 'items.productId': product._id }).select('code items.productId items.starterQuantity items.returnedQuantity createdAt');

  const salesOrders = await SalesOrder.find({ 'items.product': product._id }).select('code items.product items.starterQuantity items.returnedQuantity createdAt');

  res.status(200).json({
    status: 'success',
    data: {
      product,
      purchaseOrders,
      salesOrders,
    },
  });
});

/**
 * @description Get comprehensive purchase/sale/transfer history of a product by its barcode
 * @route GET /api/v1/products/history/:code
 * @access Private
 * Ported from the removed Variant module's getVariantHistoryByCode. Same response shape and
 * balance calculation, now built directly from Product (and PO/SO/Transfer, which reference
 * Product directly) instead of resolving a Variant first.
 */
exports.getProductHistoryByCode = asyncHandler(async (req, res, next) => {
  const { code } = req.params;

  const product = await Product.findOne({ barcode: code }).select('title sku barcode cost price priceAfterDiscount stock');
  if (!product) {
    return next(new ApiError('Product not found with this code', 404));
  }

  const starterQuantity = product.stock.reduce((total, stockItem) => total + (stockItem.starterQuantity || 0), 0);

  // Purchase order history for this product
  const purchaseOrders = await PurchaseOrder.find({ 'items.productId': product._id }).sort({ createdAt: 1 });

  const purchaseOrdersHistory = [];
  purchaseOrders.forEach(po => {
    po.items.forEach(item => {
      if (item.productId && item.productId._id.equals(product._id)) {
        purchaseOrdersHistory.push({
          orderId: po._id,
          code: po.code,
          type: 'purchase',
          vendor: po.vendorId?.name || 'Unknown',
          warehouse: po.warehouseId || 'Unknown',
          quantityPurchased: item.starterQuantity || 0,
          quantityReturned: item.returnedQuantity || 0,
          netQuantity: (item.starterQuantity || 0) - (item.returnedQuantity || 0),
          unitPrice: item.unitPrice || 0,
          unitPriceAfterDiscount: item.unitPriceAfterDiscount || 0,
          starterSubtotal: item.starterSubtotal || 0,
          finalSubtotal: item.subtotal || 0,
          date: po.createdAt,
        });
      }
    });
  });

  // Sales order history for this product
  const salesOrders = await SalesOrder.find({ 'items.product': product._id }).sort({ createdAt: 1 });

  const salesOrdersHistory = [];
  salesOrders.forEach(so => {
    so.items.forEach(item => {
      if (item.product && item.product._id.equals(product._id)) {
        salesOrdersHistory.push({
          orderId: so._id,
          code: so.code,
          type: 'sale',
          customer: so.customer?.name || so.customer?.email || 'Unknown',
          warehouse: so.warehouse || 'Unknown',
          orderSource: so.orderSource || 'unknown',
          quantitySold: item.starterQuantity || 0,
          quantityReturned: item.returnedQuantity || 0,
          netQuantity: (item.starterQuantity || 0) - (item.returnedQuantity || 0),
          unitPrice: item.unitPrice || 0,
          unitPriceAfterDiscount: item.unitPriceAfterDiscount || 0,
          starterSubtotal: item.starterSubtotal || 0,
          finalSubtotal: item.subtotal || 0,
          date: so.createdAt,
        });
      }
    });
  });

  // Transfer history for this product
  const transfers = await Transfer.find({ 'details.product': product._id }).sort({ transferredAt: 1 });

  const transfersHistory = [];
  transfers.forEach(transfer => {
    transfer.details.forEach(detail => {
      if (detail.product && detail.product._id.equals(product._id)) {
        transfersHistory.push({
          transferId: transfer._id,
          type: 'transfer',
          quantityTransferred: detail.quantity || 0,
          sourceWarehouse: transfer.sourceWarehouse,
          targetWarehouse: transfer.targetWarehouse,
          status: transfer.status,
          transferredBy: transfer.transferredBy?.name || transfer.transferredBy?.email || 'Unknown',
          date: transfer.transferredAt || transfer.createdAt,
        });
      }
    });
  });

  const totalPurchased = purchaseOrdersHistory.reduce((sum, po) => sum + po.quantityPurchased, 0);
  const totalPurchaseReturned = purchaseOrdersHistory.reduce((sum, po) => sum + po.quantityReturned, 0);
  const totalSold = salesOrdersHistory.reduce((sum, so) => sum + so.quantitySold, 0);
  const totalSalesReturned = salesOrdersHistory.reduce((sum, so) => sum + so.quantityReturned, 0);
  const totalTransferred = transfersHistory.reduce((sum, t) => sum + t.quantityTransferred, 0);

  const currentStock = product.stock.reduce((total, stockItem) => total + (stockItem.quantity || 0), 0);

  res.status(200).json({
    status: 'success',
    data: {
      product: {
        _id: product._id,
        title: product.title,
        sku: product.sku,
        barcode: product.barcode,
        cost: product.cost,
        price: product.price,
        priceAfterDiscount: product.priceAfterDiscount,
        stock: product.stock,
        currentStock,
      },
      summary: {
        starterQuantity,
        totalPurchased,
        totalPurchaseReturned,
        totalSold,
        totalSalesReturned,
        totalTransferred,
        currentStock,
        calculatedBalance: starterQuantity + totalPurchased - totalPurchaseReturned - totalSold + totalSalesReturned,
      },
      purchaseOrders: purchaseOrdersHistory,
      salesOrders: salesOrdersHistory,
      transfers: transfersHistory,
    },
  });
});
