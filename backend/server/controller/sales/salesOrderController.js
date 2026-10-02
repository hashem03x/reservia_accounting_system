const { default: mongoose } = require('mongoose');
const SalesOrder = require('../../models/sales/salesOrderModel');
const SalesOrderReturn = require('../../models/sales/salesOrderReturnModel');
const Payment = require('../../models/vendor/paymentModel');
const Product = require('../../models/inventory/productModel');
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const factory = require('../handlersFactory');
const { createSalesOrder } = require('../../services/sales/salesOrderCreation.service');

// Create a new sales order
exports.createCashierSalesOrder = asyncHandler(async (req, res, next) => {
  const { customer, warehouse, items, isPrepaid, shippingCost, isCodOrder, paidAmount } = req.body;

  try {
    const salesOrder = await createSalesOrder({
      customer,
      warehouse,
      items,
      isPrepaid,
      shippingCost,
      orderSource: 'cashier',
      isCodOrder,
      paidAmount,
      createdBy: req.user._id,
      employee: req.user._id,
    });

    res.status(201).json({
      status: 'success',
      message: 'Sales order created successfully',
      data: salesOrder,
    });
  } catch (error) {
    console.error('Sales order creation rolled back due to an error:', error);
    next(new ApiError(error.message || 'Failed to create Sales Order'));
  }
});

exports.getAllSalesOrders = factory.getAll(SalesOrder);

exports.getSalesOrder = factory.getOne(SalesOrder);

// Get sales order by code
exports.getSalesOrderByCode = asyncHandler(async (req, res, next) => {
  const { code } = req.params;

  const doc = await SalesOrder.findOne({ code });

  if (!doc) {
    return next(new ApiError('No sales order found with that code', 404));
  }

  res.status(200).json({
    status: 'success',
    data: doc,
  });
});

// Pay shipping cost
exports.payShippingCost = asyncHandler(async (req, res, next) => {
  const { id: orderId } = req.params;

  const salesOrder = await SalesOrder.findByIdAndUpdate(orderId, { $set: { shippingCostPaid: true } }, { new: true });

  if (!salesOrder) {
    return next(new ApiError('No sales order found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Shipping cost paid successfully',
    data: salesOrder,
  });
});

/**
 *  @description    Cancel order (set orderStatus to 'canceled')
 *  @route          PUT /api/v1/sale-orders/:id/cancel
 *  @access         Protected/admin-manager-moderator
 */
exports.cancelOrder = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const salesOrder = await SalesOrder.findById(id);
  if (!salesOrder) {
    return next(new ApiError(`Sales order not found with id ${id}`, 404));
  }
  if (salesOrder.orderStatus === 'canceled') {
    return next(new ApiError('Order is already canceled', 400));
  }
  salesOrder.orderStatus = 'canceled';
  await salesOrder.save();
  res.status(200).json({ status: 'success', data: salesOrder });
});

/**
 *  @description    Confirm COD order (set isCodOrderConfirmed to true)
 *  @route          PUT /api/v1/sale-orders/:id/confirm-cod
 *  @access         Protected/admin-manager-moderator
 */
exports.confirmCodOrder = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const salesOrder = await SalesOrder.findById(id);
  if (!salesOrder) {
    return next(new ApiError(`Sales order not found with id ${id}`, 404));
  }
  if (!salesOrder.isCodOrder) {
    return next(new ApiError('Order is not a COD order', 400));
  }
  if (salesOrder.isCodOrderConfirmed) {
    return next(new ApiError('COD order is already confirmed', 400));
  }
  salesOrder.isCodOrderConfirmed = true;
  await salesOrder.save();
  res.status(200).json({ status: 'success', data: salesOrder });
});

/**
 *  @description    Update order to delivered
 *  @route          PUT /api/v1/sale-orders/:id/deliver
 *  @access         Protected/manager-admin
 */
exports.updateOrderToDelivered = asyncHandler(async (req, res, next) => {
  const salesOrder = await SalesOrder.findById(req.params.id);
  if (!salesOrder) {
    return next(new ApiError(`There is no sales order with id ${req.params.id}`, 404));
  }

  if (salesOrder.orderStatus === 'delivered') {
    return next(new ApiError('This order is already delivered', 400));
  }

  if (salesOrder.orderStatus === 'cancelled') {
    return next(new ApiError('Cannot deliver a cancelled order', 400));
  }

  // Update order status to delivered
  salesOrder.orderStatus = 'delivered';
  salesOrder.deliveryDate = Date.now();

  await salesOrder.save();

  res.status(200).json({ status: 'success', data: salesOrder });
});

/**
 *  @description    Process returned items on a sales order (restock + refund payment)
 *  @route          PUT /api/v1/sale-orders/:salesOrderId/cancel-items-admin
 *  @access         Protected/admin
 */
exports.returnSalesOrderItemAdmin = asyncHandler(async (req, res, next) => {
  const { salesOrderId } = req.params;
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      // 1. Get sales order by id
      const salesOrder = await SalesOrder.findById(salesOrderId).session(session);
      if (!salesOrder) {
        throw new ApiError(`Sales order not found with id ${salesOrderId}`, 404);
      }

      // 2. Loop over items and process returns
      for (const item of salesOrder.items) {
        if (item.quantityToBeReturned > 0) {
          // 2.1 Update returned quantity and reset quantityToBeReturned
          const returnedQuantity = item.quantityToBeReturned;
          item.returnedQuantity += returnedQuantity;
          item.quantityToBeReturned = 0;

          // 2.2 Increase stock on the product - a service has no stock/warehouse concept at all
          // (see docs/entities/products.md), so returning one never touches inventory.
          const product = await Product.findById(item.product).session(session);
          if (!product) {
            throw new ApiError(`Product not found with id ${item.product}`, 404);
          }

          if (product.type !== 'service') {
            const warehouseStock = product.stock.find(stock => stock.warehouse.toString() === salesOrder.warehouse.toString());

            if (!warehouseStock) {
              product.stock.push({
                warehouse: salesOrder.warehouse,
                quantity: returnedQuantity,
              });
            } else {
              warehouseStock.quantity += returnedQuantity;
            }
            await product.save({ session });
          }

          // 2.3 Create payment with type out
          const returnAmount = returnedQuantity * item.unitPriceAfterDiscount || returnedQuantity * item.unitPrice;
          const payment = new Payment({
            warehouseId: salesOrder.warehouse,
            salesOrderId: salesOrderId,
            customerId: salesOrder.customer,
            type: 'out',
            amountPaid: returnAmount,
            paymentMethod: 'paymob-online',
            paymentCategory: 'sales-return',
            notes: `Return payment for ${returnedQuantity} items`,
            createdBy: req.user._id,
          });
          await payment.save({ session });

          // 2.4 Create salesOrderReturn record
          const salesOrderReturn = new SalesOrderReturn({
            salesOrderId,
            warehouseId: salesOrder.warehouse,
            productId: item.product,
            returnedQuantity,
            returnedAmount: returnAmount,
            notes: 'Website order return',
          });
          await salesOrderReturn.save({ session });
        }
      }

      await salesOrder.save({ session });
    });

    res.status(200).json({
      status: 'success',
      message: 'Sales order items returned successfully',
    });
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
});
