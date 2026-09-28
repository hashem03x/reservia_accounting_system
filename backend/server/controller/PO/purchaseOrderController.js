const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

// const fs = require('fs').promises;
// const path = require('path');
// const JsBarcode = require('jsbarcode');
// const { createCanvas } = require('canvas');
// const BASE_URL = process.env.NODE_ENV == 'production' ? process.env.PROD_URL : process.env.DEV_URL;

const PO = require('../../models/vendor/purchaseOrder');
const Variant = require('../../models/inventory/variantModel');
const Product = require('../../models/inventory/productModel');
const factory = require('../handlersFactory');
const ApiError = require('../../utils/apiError'); // DEV_URL

const updateStock = async (item, warehouseId, session) => {
  const { variantId, starterQuantity } = item;

  const variant = await Variant.findById(variantId).session(session);
  if (!variant) throw new ApiError(`Variant with ID ${variantId} not found.`);

  const updatedStock = variant.stock.find(s => s.warehouse.toString() === warehouseId);

  if (updatedStock) {
    updatedStock.quantity += starterQuantity;
  } else {
    variant.stock.push({ warehouse: warehouseId, quantity: starterQuantity });
  }

  await variant.save({ session });
};

const calculateMovingAverage = async (purchaseOrder, session) => {
  // calc new cost = (t_available + t_purchased) / (q_available + q_purchased), moving average cost
  // Group items by their product ID to handle multiple variants of the same product
  const variantsByProduct = new Map();

  // First, get all variants and group them by product
  for (const item of purchaseOrder.items) {
    const variant = await Variant.findById(item.variantId).populate('productId').session(session);

    if (!variant) continue;

    // productId
    const productId = variant.productId._id.toString();

    if (!variantsByProduct.has(productId)) {
      variantsByProduct.set(productId, {
        product: variant.productId,
        items: [],
      });
    }

    variantsByProduct.get(productId).items.push({
      variant,
      quantity: item.starterQuantity,
      priceAfterDiscount: item.unitPriceAfterDiscount,
    });
  }

  // Calculate and update the moving average for each product
  for (const [productId, data] of variantsByProduct) {
    const { product, items } = data;

    // Calculate q_available (total quantity in stock before purchase)
    const variants = await Variant.find({ productId: product._id }).session(session);

    const q_available = variants.reduce((total, variant) => {
      return total + variant.stock.reduce((sum, stock) => sum + stock.quantity, 0);
    }, 0);

    // logic upadte stock each time

    // Calculate q_purchased (total quantity purchased in this PO)
    const q_purchased = items.reduce((total, item) => total + item.quantity, 0);

    // Calculate t_available (total cost of available stock)
    const t_available = q_available * product.cost;

    // Calculate t_purchased (total cost of purchased items)
    const t_purchased = items.reduce((total, item) => {
      return total + item.quantity * item.priceAfterDiscount;
    }, 0);

    console.log({ t_available, t_purchased, q_available, q_purchased });

    // throw new ApiError('Stop '); // Testing

    // Calculate new average cost for the product after purchase
    // want substract the t_returnPurchase from t_purchased and q_returnPurchase from q_purchased
    const newCost = (t_available + t_purchased) / (q_available + q_purchased);

    // Update product cost
    await Product.findByIdAndUpdate(productId, { cost: newCost }, { session });
  }
};

exports.createPO = asyncHandler(async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { vendorId, warehouseId, items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ApiError('Items must be a non-empty array');
    }

    // Create the purchase order first (before updating stock)
    const purchaseOrder = new PO({
      vendorId,
      warehouseId,
      items,
      createdBy: req.user._id,
    });

    await purchaseOrder.save({ session });

    // Calculate and update moving average costs BEFORE updating stock
    await calculateMovingAverage(purchaseOrder, session);

    // Update stock after cost calculations
    await Promise.all(
      items.map(async item => {
        await updateStock(item, warehouseId, session);
      })
    );

    await session.commitTransaction();

    res.status(201).json({
      status: 'success',
      message: 'Purchase Order created successfully',
      data: purchaseOrder,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Transaction rolled back due to an error:', error);
    next(new ApiError(error.message || 'Failed to create Purchase Order'));
  } finally {
    session.endSession();
  }
});

exports.getAllPO = factory.getAll(PO);

exports.getPO = factory.getOne(PO);

// Get purchase order by code
exports.getPOByCode = asyncHandler(async (req, res, next) => {
  const { code } = req.params;

  const doc = await PO.findOne({ code });

  if (!doc) {
    return next(new ApiError('No purchase order found with that code', 404));
  }

  res.status(200).json({
    status: 'success',
    data: doc,
  });
});

// exports.updatePO = factory.updateOne(PO);

// exports.deletePO = asyncHandler(async (req, res) => {
//   const { id } = req.params;
//   const po = await PO.findByIdAndUpdate(id, { $set: { isDeleted: true } });
//   if (!po) return next(new ApiError('No document found with that ID', 404));
//   res.status(204).json({
//     status: 'success',
//     message: 'Purchase Order deleted successfully',
//     data: null,
//   });
// });

// exports.deletePO = factory.deleteOne(PO);

// =============================================================

// Generate barcode for each item
// const generateBarcode = async (item) => {
//   const { variant: variantId } = item;
//   const variant = await Variant.findById(variantId);

//   const barcodeData = `sku:${variant.sku}, price:${variant.price}`;
//   const canvas = createCanvas(400, 100);

//   JsBarcode(canvas, barcodeData, { format: 'CODE128', width: 2, height: 100, displayValue: true });

//   const buffer = canvas.toBuffer('image/jpeg');
//   const directory = path.join(__dirname, `../../../uploads/barcodes/`);
//   await fs.mkdir(directory, { recursive: true });

//   const filePath = path.join(directory, `${variant.sku}.avif`);
//   await fs.writeFile(filePath, buffer);

//   return `${BASE_URL}/barcodes/${variant.sku}.avif`;
// };
