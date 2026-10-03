const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

// const fs = require('fs').promises;
// const path = require('path');
// const JsBarcode = require('jsbarcode');
// const { createCanvas } = require('canvas');
// const BASE_URL = process.env.NODE_ENV == 'production' ? process.env.PROD_URL : process.env.DEV_URL;

const PO = require('../../models/vendor/purchaseOrder');
const Product = require('../../models/inventory/productModel');
const factory = require('../handlersFactory');
const ApiError = require('../../utils/apiError'); // DEV_URL

// Applies a PO's items to the products they reference: recomputes each product's moving-average
// cost (using stock levels BEFORE this purchase, same formula as before) and increments its stock
// in the PO's warehouse - in ONE pass per distinct product (grouped up front, since a single PO can
// have more than one line item for the same product), fetching and saving each product exactly
// once. Previously this was two separate passes (calculateMovingAverage, then updateStock) that
// each independently resolved variant -> product and re-fetched/re-saved per item; with items
// identifying their product directly, there is no variant indirection left to resolve, and no
// reason to touch the same product document twice.
const applyPurchaseToProducts = async (purchaseOrder, warehouseId, session) => {
  const itemsByProduct = new Map();

  for (const item of purchaseOrder.items) {
    const productId = item.productId.toString();
    if (!itemsByProduct.has(productId)) itemsByProduct.set(productId, []);
    itemsByProduct.get(productId).push(item);
  }

  for (const [productId, items] of itemsByProduct) {
    const product = await Product.findById(productId).session(session);
    if (!product) throw new ApiError(`Product with ID ${productId} not found.`);

    // A service has no inventory/variant data at all (see docs/entities/products.md) - it cannot
    // be "purchased into stock", so none of the moving-average-cost/warehouse-stock logic below
    // applies. The model itself rejects a service document carrying any stock, so skipping this
    // entirely (rather than letting the push below trip that guard) is both correct and required.
    if (product.type === 'service') continue;

    // calc new cost = (t_available + t_purchased) / (q_available + q_purchased), moving average cost
    const q_available = (product.stock || []).reduce((sum, stock) => sum + stock.quantity, 0);
    const q_purchased = items.reduce((total, item) => total + item.starterQuantity, 0);
    const t_available = q_available * product.cost;
    const t_purchased = items.reduce((total, item) => total + item.starterQuantity * item.unitPriceAfterDiscount, 0);

    product.cost = (t_available + t_purchased) / (q_available + q_purchased);

    const stockEntry = product.stock.find(s => s.warehouse.toString() === warehouseId);
    if (stockEntry) {
      stockEntry.quantity += q_purchased;
    } else {
      product.stock.push({ warehouse: warehouseId, quantity: q_purchased });
    }

    await product.save({ session });
  }
};

// Exported so other PO-creation entry points (e.g. the CSV import pipeline) share this exact
// cost/stock logic instead of maintaining a second copy.
exports.applyPurchaseToProducts = applyPurchaseToProducts;

exports.createPO = asyncHandler(async (req, res, next) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // `vatAmount`/`withholdingTaxAmount`/`grandTotal`/`totalAmount` are deliberately never
    // destructured here - only the percentages are ever accepted from a client; the model's own
    // pre('save') hook computes every derived amount from the real item totals (docs section "Do
    // not allow clients to manipulate the final total").
    const { vendorId, warehouseId, items, project, paymentMethod, paymentAccount, vatPercentage, withholdingTaxPercentage } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ApiError('Items must be a non-empty array');
    }

    // Create the purchase order first (before updating stock)
    const purchaseOrder = new PO({
      vendorId,
      warehouseId,
      items,
      project: project || null,
      paymentMethod: paymentMethod || null,
      paymentAccount: paymentAccount || null,
      vatPercentage,
      withholdingTaxPercentage,
      createdBy: req.user._id,
    });

    await purchaseOrder.save({ session });

    // Recompute moving-average cost and increment stock for every product this PO touches.
    await applyPurchaseToProducts(purchaseOrder, warehouseId, session);

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
