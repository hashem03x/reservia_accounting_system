const asyncHandler = require('express-async-handler');

const factory = require('../handlersFactory');
const Product = require('../../models/inventory/productModel');
const Variant = require('../../models/inventory/variantModel');
const Size = require('../../models/inventory/sizeModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const SalesOrder = require('../../models/sales/salesOrderModel');
const Transfer = require('../../models/inventory/transferModel');
const apiResponse = require('../../utils/apiResponse');
const AppError = require('../../utils/apiError');

const { v4: uui4 } = require('uuid');

const generateBarCode = (productId, variantId) => {
  return `${productId}-${variantId}`;
};

const checkVarinatExist = async (variants, productId) => {
  const variantSkus = await Variant.find({ productId }).select('sku');
  // const dataVariantsSkus = dataVariants.map(variant => variant.sku.toString());

  const dataVariants = variants.map(variant => {});
};

/**
 *  @description create variant
 *  @route       POST /api/variants
 *  @access      Private
 * @route      POST /api/products/:productId/variants
 */

const addVarinatToProduct = async (productId, variantIds) => {
  const product = await Product.findById(productId);
  product.variants.push(...variantIds);
  await product.save();
};

exports.createVariant = asyncHandler(async (req, res, next) => {
  const { productId } = req.params;
  let variants = req.body;

  // Check if the product exists
  const product = await Product.findById(productId);
  if (!product) return next(new AppError('Product not found', 404));

  // Ensure variants is an array
  variants = Array.isArray(variants) ? variants : [variants];

  // Create all variants and store their IDs
  const variantIds = [];
  const createdVariants = await Promise.all(
    variants.map(async variant => {
      try {
        req.body = { productId, ...variant };

        const newVariant = await factory.createOne(Variant, (key = true))(req, res, next);

        variantIds.push(newVariant._id);

        return newVariant;
      } catch (error) {
        return next(new AppError('Failed to create variant', 500));
      }
    })
  );

  // Update the product with the new variant IDs
  addVarinatToProduct(productId, variantIds);
  // product.variants.push(...variantIds);
  // await product.save();

  // Send response with created variants
  res.status(201).json(apiResponse(true, 'Variants created successfully', createdVariants));
});

/**
 *  @description get variant
 *  @route       GEt /api/variants
 *  @access      Private
 */
exports.createVariantFilter = (req, res, next) => {
  const { productId } = req.params;
  if (productId) req.filterObject = { productId };

  next();
};

exports.getVariants = factory.getAll(Variant);

exports.getVariantsWithPopulatedProducts = asyncHandler(async (req, res, next) => {
  // base filter (may be set by `createVariantFilter` middleware)
  const filter = req.filterObject || {};

  // allow filtering by variant code via `keyword` query param (case-insensitive)
  const { keyword } = req.query || {};
  if (keyword) {
    // match substring in variantCode
    filter.variantCode = { $regex: keyword, $options: 'i' };
  }

  // pagination params like factory.getAll
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 25);
  const skip = (page - 1) * limit;

  // total documents matching filter
  const totalDocs = await Variant.countDocuments(filter);

  const numberOfPages = Math.ceil(totalDocs / limit) || 1;

  // fetch paginated variants and populate product fields
  const variants = await Variant.find(filter).populate('productId', '_id title cost price priceAfterDiscount').skip(skip).limit(limit).sort({ createdAt: -1 }).lean();

  const mapped = variants.map(v => {
    const productIdPopulated = v.productId;
    return {
      ...v,
      productId: productIdPopulated ? productIdPopulated._id : null,
      product: productIdPopulated
        ? {
            _id: productIdPopulated._id,
            title: productIdPopulated.title,
            cost: productIdPopulated.cost,
            price: productIdPopulated.price,
            priceAfterDiscount: productIdPopulated.priceAfterDiscount,
          }
        : null,
    };
  });

  const paginationResult = {
    currentPage: page,
    limit,
    numberOfPages,
    next: page < numberOfPages ? page + 1 : undefined,
    prev: page > 1 ? page - 1 : undefined,
  };

  res.status(200).json({
    results: mapped.length,
    paginationResult,
    data: mapped,
  });
});

/**
 *  @description get variants by product
 *  @route       GEt /api/productId/:variants
 *  @access      Private
 */

// exports.getVariantsByProduct = ()

// exports.getVariants = factory.getAll(Variant);

/**
 *  @description get variant
 *  @route       get /api/variants/:id
 *  @access      Private
 */
exports.getVariant = factory.getOne(Variant);

// Get variant by variantCode
exports.getVariantByCode = asyncHandler(async (req, res, next) => {
  const { code: variantCode } = req.params;
  const variant = await Variant.findOne({ variantCode }).populate('productId', '_id title cost price priceAfterDiscount').lean();

  if (!variant) return next(new AppError('Variant not found', 404));

  // To rename productId to product in the response
  const { productId, ...rest } = variant;

  const response = {
    ...rest,
    product: {
      _id: productId._id,
      title: productId.title,
      cost: productId.cost,
      price: productId.price,
      priceAfterDiscount: productId.priceAfterDiscount,
    }, // to exclude variants
  };

  res.status(200).json(apiResponse(true, 'Variant found', response));
});

/**
 *
 * @description handle update image in variant
 * @route       PUT /api/variants/:id
 * @access      Private
 */

/**
 *  @description update variant
 *  @route       PUT /api/variants/:id
 *  @access      Private
 * @route   PUT /app/products/:productId/variants/:id => update variant
 * {
 *   basic info
 *    size:{
 *     size: "XL",
 *   stock:{
 *     quantity: 20,
 *     warehouse: "warehouseId"
 * }
 * }
 * }
 * // images and image cover will be updated in another route
 * // PUT /app/products/:productId/variants/:id/images
 */
exports.updateVariant = asyncHandler(async (req, res, next) => {
  const { id, productId } = req.params;
  let variants = req.body;

  // Check if the product exists
  const product = await Product.findById(productId);
  if (!product) return next(new AppError('Product not found', 404));

  // Ensure variants is an array
  variants = Array.isArray(variants) ? variants : [variants];

  // Update all variants
  const updatedVariants = await Promise.all(
    variants.map(async variant => {
      try {
        // Determine the variant ID to update
        const variantId = variant.id || id;

        // Check if the variant exists for the given product
        const variantExist = await Variant.findOne({ productId, _id: variantId });
        if (!variantExist) return next(new AppError('Variant not found', 404));

        // Update the variant using factory function
        req.body = { productId, ...variant };
        const updatedVariant = await factory.updateOne(Variant, (key = true))(req, res, next);

        return updatedVariant;
      } catch (error) {
        throw new AppError('Failed to update variant', 500);
      }
    })
  );

  // Send response with updated variants
  res.status(200).json(apiResponse(true, 'Variants updated successfully', updatedVariants));
});

// exports.updateVariant =asyncHandler(async (req,res, next) => {
//     const {id , productId} = req.params;
//      const {sizes, ...variantData} = req.body;
//     // find variant

//     // update variant
//     const variant = await factory.updateOne(Variant, key=true)(req,res,next);

//     // update size if array loop of them and update
//     for(let i = 0; i< sizes.length; i++) {
//         const size = sizes[i];
//         const sizeId = size._id;
//         req.body = size;
//         req.params.id = sizeId;
//         const sizeDoc = await factory.updateOne(Size, key=true)(req,res,next);
//     }

//     res.status(200).json(apiResponse('success', 'Variant updated successfully', variant));

// });

/**
 *  @description delete variant
 *  @route       DELETE /api/variants/:id
 *  @access      Private
 */

exports.deleteVariant = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Update the variant in the database
  const result = await Variant.findByIdAndUpdate(
    id,
    {
      isDeleted: true, // Mark as deleted
      'stock.$[].quantity': 0, // Reset all stock quantities to 0
    },
    { new: true } // Return the updated document
  );

  if (!result) return next(new AppError('Variant not found', 404));

  res.status(204).json({ message: 'Variant deleted successfully', sucess: true, variant: result });
  // Send response
});
// handle delete variant
exports.deleteVariantByAdmin = factory.deleteOne(Variant);

/**
 * @description Get all purchase and sales orders containing a specific variant code
 * @route GET /api/variants/orders/:variantCode
 * @access Private
 */
exports.getOrdersByVariantCode = asyncHandler(async (req, res, next) => {
  const { variantCode } = req.params;

  // First find the variant by code
  // populate the product and select only the title and _id
  const variant = await Variant.findOne({ variantCode }).populate('productId', 'title.en');
  if (!variant) {
    return next(new AppError('Variant not found with this code', 404));
  }

  // Find purchase orders containing this variant
  const purchaseOrders = await PurchaseOrder.find({
    'items.variantId': variant._id,
  }).select('items.variantId items.starterQuantity items.returnedQuantity createdAt');

  // Find sales orders containing this variant
  const salesOrders = await SalesOrder.find({
    'items.variant': variant._id,
  }).select('items.variant items.starterQuantity items.returnedQuantity createdAt');

  res.status(200).json({
    status: 'success',
    data: {
      variant,
      purchaseOrders,
      salesOrders,
    },
  });
});

/**
 * @description Get comprehensive history of a variant by variant code
 * @route GET /api/variants/history/:code
 * @access Private
 */
exports.getVariantHistoryByCode = asyncHandler(async (req, res, next) => {
  const { code: variantCode } = req.params;

  // Find the variant by code and populate product details (don't use .lean() here to preserve ObjectId methods)
  const variant = await Variant.findOne({ variantCode }).populate('productId', 'title cost price priceAfterDiscount');

  if (!variant) {
    return next(new AppError('Variant not found with this code', 404));
  }

  // Calculate starter quantity from stock
  const starterQuantity = variant.stock.reduce((total, stockItem) => {
    return total + (stockItem.starterQuantity || 0);
  }, 0);

  // Find all purchase orders containing this variant
  const purchaseOrders = await PurchaseOrder.find({
    'items.variantId': variant._id,
  })
    .populate('vendorId', 'name')
    .sort({ createdAt: 1 });

  // Extract purchase order details for this specific variant
  const purchaseOrdersHistory = [];
  purchaseOrders.forEach(po => {
    po.items.forEach(item => {
      // Compare using .equals() method for ObjectId comparison
      if (item.variantId && item.variantId.equals(variant._id)) {
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

  // Find all sales orders containing this variant
  const salesOrders = await SalesOrder.find({
    'items.variant': variant._id,
  })
    .populate('customer', 'name email')
    .sort({ createdAt: 1 });

  // Extract sales order details for this specific variant
  const salesOrdersHistory = [];
  salesOrders.forEach(so => {
    so.items.forEach(item => {
      // Compare using .equals() method for ObjectId comparison
      if (item.variant && item.variant.equals(variant._id)) {
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

  // Find all transfers involving this variant
  const transfers = await Transfer.find({
    'details.variant': variant._id,
  })
    .populate('transferredBy', 'name email')
    .sort({ transferredAt: 1 });

  // Extract transfer details for this specific variant
  const transfersHistory = [];
  transfers.forEach(transfer => {
    transfer.details.forEach(detail => {
      // Compare using .equals() method for ObjectId comparison
      if (detail.variant && detail.variant.equals(variant._id)) {
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

  // Calculate totals
  const totalPurchased = purchaseOrdersHistory.reduce((sum, po) => sum + po.quantityPurchased, 0);
  const totalPurchaseReturned = purchaseOrdersHistory.reduce((sum, po) => sum + po.quantityReturned, 0);
  const totalSold = salesOrdersHistory.reduce((sum, so) => sum + so.quantitySold, 0);
  const totalSalesReturned = salesOrdersHistory.reduce((sum, so) => sum + so.quantityReturned, 0);
  const totalTransferred = transfersHistory.reduce((sum, t) => sum + t.quantityTransferred, 0);

  // Calculate current stock level
  const currentStock = variant.stock.reduce((total, stockItem) => {
    return total + (stockItem.quantity || 0);
  }, 0);

  // Prepare product information
  const productInfo = variant.productId
    ? {
        _id: variant.productId._id,
        title: variant.productId.title,
        cost: variant.productId.cost,
        price: variant.productId.price,
        priceAfterDiscount: variant.productId.priceAfterDiscount,
      }
    : null;

  // Send comprehensive response
  res.status(200).json({
    status: 'success',
    data: {
      variant: {
        _id: variant._id,
        variantCode: variant.variantCode,
        sku: variant.sku,
        color: variant.color,
        size: variant.size,
        stock: variant.stock,
        product: productInfo,
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
