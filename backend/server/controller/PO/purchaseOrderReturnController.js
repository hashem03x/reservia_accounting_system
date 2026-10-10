const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

const Product = require('../../models/inventory/productModel');
const PO = require('../../models/vendor/purchaseOrder');
const POReturn = require('../../models/vendor/purchaseOrderReturn');
const Vendor = require('../../models/vendor/vendor');
const Payment = require('../../models/vendor/paymentModel');
const Transfer = require('../../models/inventory/transferModel');
const ApiError = require('../../utils/apiError');
const factory = require('../handlersFactory');
const { releaseAllocationForReturn } = require('../../services/inventory/poProjectAllocationService');

const findTransferredQuantity = async (productId, sourceWarehouseId, session) => {
  // Find transfers where this product was moved from source warehouse
  const transfers = await Transfer.find({
    'details.product': productId,
    sourceWarehouse: sourceWarehouseId,
    status: { $ne: 'cancelled' }, // Only consider non-cancelled transfers
  })
    .populate('details.product')
    .session(session);

  if (!transfers || transfers.length === 0) {
    return { hasTransfers: false };
  }

  // Calculate total transferred quantity and get target warehouses
  const transferDetails = transfers.reduce(
    (acc, transfer) => {
      const productDetail = transfer.details.find(d => d.product._id.toString() === productId.toString());

      if (productDetail) {
        acc.totalTransferred += productDetail.quantity;
        acc.targetWarehouses.push({
          warehouseId: transfer.targetWarehouse,
          quantity: productDetail.quantity,
        });
      }
      return acc;
    },
    { totalTransferred: 0, targetWarehouses: [] }
  );

  return {
    hasTransfers: true,
    ...transferDetails,
  };
};

const calculateMovingAverageOnReturn = async (OrderReturn, session) => {
  // calc new cost = (total_cost_product - total_cost_returned) / (total_quantity_product - total_quantity_returned), moving average cost
  const { productId, returnedAmount, returnedQuantity } = OrderReturn;

  const product = await Product.findById(productId).session(session);
  if (!product) throw new ApiError(`Product with ID ${productId} not found.`);

  // calc total quantity product based on actual stock records
  const totalQuantityProduct = (product.stock || []).reduce((sum, stockEntry) => sum + (stockEntry.quantity || 0), 0);

  // calc total cost of product
  const totalCostProduct = totalQuantityProduct * product.cost;

  //to more decalre only not any processing found cacl total quantity returned and cost of return
  const costOfReturnProduct = Number(returnedAmount);
  const qnatityReturnedProduct = Number(returnedQuantity);

  // Validate inputs
  if (isNaN(costOfReturnProduct) || isNaN(qnatityReturnedProduct)) {
    throw new Error('Invalid cost or quantity values for return calculation');
  }

  // calc new cost
  const denominator = totalQuantityProduct - qnatityReturnedProduct;
  const numerator = totalCostProduct - costOfReturnProduct;

  // Handle case where remaining quantity would be zero or negative after return
  if (denominator <= 0) {
    product.cost = 0;
    await product.save({ session });
    return;
  }

  const newCost = numerator / denominator;

  if (isNaN(newCost) || !isFinite(newCost)) {
    throw new Error('Cost calculation resulted in an invalid value');
  }

  // update product cost
  product.cost = newCost;
  await product.save({ session });
};

exports.returnPurchaseOrderItem = async (req, res, next) => {
  let { purchaseOrderId, warehouseId, productId, returnedQuantity, paymentMethod, notes } = req.body;

  returnedQuantity = Number(returnedQuantity);

  const session = await POReturn.startSession();
  session.startTransaction();

  try {
    // Get original Purchase Order
    const purchaseOrder = await PO.findById(purchaseOrderId).session(session);

    if (!purchaseOrder) return next(new ApiError('Purchase order not found', 404));

    const originalItem = purchaseOrder.items.find(item => item.productId._id.toString() == productId);
    if (!originalItem) return next(new ApiError(`Item ${productId} not found in original purchase order`));

    originalItem.returnedQuantity += returnedQuantity;

    if (originalItem.returnedQuantity > originalItem.starterQuantity) return next(new ApiError(`Cannot return more items than purchased for product ${productId}`));

    // Getting remaining amount before saving
    const orderRemainingAmount = purchaseOrder.remainingAmount;

    // recalcMovingAverage

    await purchaseOrder.save({ session });

    // Calculate return amount based on original unit price after discount
    const returnedAmount = returnedQuantity * originalItem.unitPriceAfterDiscount;

    // Create return record with session
    const returnRecords = await POReturn.create(
      [
        {
          purchaseOrderId,
          warehouseId,
          productId,
          returnedQuantity,
          returnedAmount,
          notes,
          createdBy: req.user._id,
        },
      ],
      { session }
    );

    if (!returnRecords || returnRecords.length === 0) {
      throw new ApiError('Failed to create return record', 500);
    }

    // A service was never purchased into stock in the first place (see applyPurchaseToProducts /
    // docs/entities/products.md), so returning one skips moving-average-cost recalculation and the
    // entire warehouse/transfer stock-reconciliation block below - there is no inventory to give
    // back.
    const productForType = await Product.findById(productId).session(session);
    if (!productForType) return next(new ApiError(`Product with ID ${productId} not found.`));

    if (productForType.type !== 'service') {
      // Stock received on a project order was allocated to the project - release the returned
      // quantity from the project back into the warehouse first, so the return below can take it.
      await releaseAllocationForReturn(purchaseOrder, productId, returnedQuantity, { userId: req.user._id, session });

      // recalc moving average before update stock with returned quantity
      await calculateMovingAverageOnReturn(returnRecords[0], session);

      // Update product quantity in stock with transfer handling
      const product = await Product.findById(productId).session(session);
      if (!product) return next(new ApiError(`Product with ID ${productId} not found.`));

      const sourceStockEntry = product.stock.find(s => s.warehouse.toString() === warehouseId.toString());
      if (!sourceStockEntry) return next(new ApiError(`No stock found for product ${productId} in warehouse ${warehouseId}`));

      // First check if we have enough quantity across all warehouses
      let totalAvailableQuantity = sourceStockEntry.quantity;

      // Get transfer info to check target warehouse quantities
      const transferInfo = await findTransferredQuantity(productId, warehouseId, session);

      if (transferInfo.hasTransfers) {
        // Group quantities by target warehouse to avoid counting duplicates
        const warehouseQuantities = transferInfo.targetWarehouses.reduce((acc, tw) => {
          if (!acc[tw.warehouseId.toString()]) {
            acc[tw.warehouseId.toString()] = 0;
          }
          acc[tw.warehouseId.toString()] += tw.quantity;
          return acc;
        }, {});

        // Add quantities from target warehouses
        for (const [targetWarehouseId, transferredQuantity] of Object.entries(warehouseQuantities)) {
          const targetStockEntry = product.stock.find(s => s.warehouse.toString() === targetWarehouseId);
          if (targetStockEntry) {
            totalAvailableQuantity += targetStockEntry.quantity;
          }
        }
      }

      // Validate total available quantity
      if (totalAvailableQuantity < returnedQuantity) {
        return next(new ApiError(`Insufficient quantity available. Requested: ${returnedQuantity}, Available: ${totalAvailableQuantity} across all warehouses`));
      }

      let remainingToReturn = returnedQuantity;

      // First reduce from source warehouse as much as possible
      if (sourceStockEntry.quantity > 0) {
        const quantityFromSource = Math.min(sourceStockEntry.quantity, remainingToReturn);
        sourceStockEntry.quantity -= quantityFromSource;
        remainingToReturn -= quantityFromSource;
      }

      // If we still need to return more, use target warehouses
      if (remainingToReturn > 0) {
        if (!transferInfo.hasTransfers) {
          return next(new ApiError(`Insufficient quantity in warehouse ${warehouseId} for product ${productId}`));
        }

        // Group quantities by target warehouse
        const warehouseQuantities = transferInfo.targetWarehouses.reduce((acc, tw) => {
          if (!acc[tw.warehouseId.toString()]) {
            acc[tw.warehouseId.toString()] = 0;
          }
          acc[tw.warehouseId.toString()] += tw.quantity;
          return acc;
        }, {});

        // Try to fulfill the remaining return quantity from target warehouses
        for (const [targetWarehouseId, transferredQuantity] of Object.entries(warehouseQuantities)) {
          if (remainingToReturn <= 0) break;

          const targetStockEntry = product.stock.find(s => s.warehouse.toString() === targetWarehouseId);
          if (!targetStockEntry) continue;

          const quantityToReduceFromTarget = Math.min(remainingToReturn, targetStockEntry.quantity);
          if (quantityToReduceFromTarget <= 0) continue;

          targetStockEntry.quantity -= quantityToReduceFromTarget;
          remainingToReturn -= quantityToReduceFromTarget;
        }

        if (remainingToReturn > 0) {
          return next(new ApiError(`Could not find sufficient quantity across warehouses. Still need ${remainingToReturn} items`));
        }
      }

      await product.save({ session });
    }

    let paymentRecord = null;

    const vendor = await Vendor.findById(purchaseOrder.vendorId._id).session(session);

    if (!vendor) return next(new ApiError('Vendor not found', 404));
    vendor.balance -= returnedAmount;
    await vendor.save({ session });

    const amountToPayBack = returnedAmount - orderRemainingAmount;

    if (amountToPayBack > 0) {
      // Create payment record with session (This also will handle PO paid amount, vendor balance, and warehouse balance)
      [paymentRecord] = await Payment.create(
        [
          {
            warehouseId,
            purchaseOrderId,
            vendorId: purchaseOrder.vendorId._id,
            amountPaid: amountToPayBack,
            type: 'in',
            paymentMethod,
            paymentCategory: 'purchase-return',
            createdBy: req.user._id,
          },
        ],
        { session }
      );
    }

    const updatePurchaseOrder = await PO.findById(purchaseOrderId).session(session);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ message: 'Item Returned Successfully', data: { return: returnRecords[0], payment: paymentRecord, purchaseOrder: updatePurchaseOrder } });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    next(new ApiError(err.message, 500));
  }
};

// Get all returns
exports.getAllReturns = factory.getAll(POReturn);

// Get single return
exports.getReturn = asyncHandler(async (req, res, next) => {
  const returnRecord = await POReturn.findById(req.params.id).populate('purchaseOrderId', 'code').populate('productId', 'title sku').populate('createdBy', 'name');

  if (!returnRecord) {
    return next(new ApiError('Return not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: returnRecord,
  });
});
