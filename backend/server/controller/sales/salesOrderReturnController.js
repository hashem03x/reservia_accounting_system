const SalesOrderModel = require('../../models/sales/salesOrderModel');
const SalesOrderReturnModel = require('../../models/sales/salesOrderReturnModel');
const Variant = require('../../models/inventory/variantModel');
const Product = require('../../models/inventory/productModel');
const UserModel = require('../../models/userModel');
const Payment = require('../../models/vendor/paymentModel');
const ApiError = require('../../utils/apiError');
const factory = require('../handlersFactory');

exports.returnSalesOrderItem = async (req, res, next) => {
  let { salesOrderId, warehouseId, variantId, returnedQuantity, paymentMethod, notes } = req.body;

  returnedQuantity = Number(returnedQuantity);

  const session = await SalesOrderReturnModel.startSession();

  session.startTransaction();

  try {
    // Get original Sales Order
    const salesOrder = await SalesOrderModel.findById(salesOrderId).session(session);
    if (!salesOrder) return next(new ApiError('Sales order not found', 404));

    // Get original item (that we want to return) from sales order
    const originalItem = salesOrder.items.find(item => item.variant._id.toString() == variantId);
    if (!originalItem) return next(new ApiError(`Item ${variantId} not found in original sales order`));

    // Calculate total returned quantity
    originalItem.returnedQuantity += returnedQuantity;
    if (originalItem.returnedQuantity > originalItem.starterQuantity) return next(new ApiError(`Cannot return more items than sold for variant ${variantId}`));

    // Update quantity to be returned in sales order
    originalItem.quantityToBeReturned = Math.max(originalItem.quantityToBeReturned - returnedQuantity, 0);

    // Getting remaining amount BEFORE saving (as it will be updated after saving by pre-save middleware)
    const orderRemainingAmount = salesOrder.remainingAmount;

    await salesOrder.save({ session });

    // Get original variant to be updated
    const variant = await Variant.findById(variantId).session(session);
    if (!variant) return next(new ApiError(`Variant with ID ${variantId} not found.`));

    // Update product totalSold
    const product = await Product.findById(variant.productId).session(session);
    if (!product) return next(new ApiError(`Product not found for variant ${variantId}`));
    product.totalSold = Math.max((product.totalSold || 0) - returnedQuantity, 0);
    await product.save({ session });

    // Update variant stock in warehouse
    const stockEntry = variant.stock.find(s => s.warehouse.toString() === warehouseId.toString());
    if (!stockEntry) return next(new ApiError(`No stock found for variant ${variantId} in warehouse ${warehouseId}`));
    stockEntry.quantity += returnedQuantity;
    await variant.save({ session });

    // Calculate return amount based on original unit price after discount
    const returnedAmount = returnedQuantity * originalItem.unitPriceAfterDiscount;

    // Create return record with session
    const [returnRecord] = await SalesOrderReturnModel.create(
      [
        {
          salesOrderId,
          warehouseId,
          variantId,
          returnedQuantity,
          returnedAmount,
          notes,
          createdBy: req.user._id,
        },
      ],
      { session }
    );

    let paymentRecord = null;

    // Update customer balance
    const customer = await UserModel.findById(salesOrder.customer._id).session(session);
    if (!customer) return next(new ApiError('Customer not found', 404));
    customer.balance += returnedAmount;
    await customer.save({ session });

    // Calculate amount to paid back
    const amountToPayBack = returnedAmount - orderRemainingAmount;

    if (amountToPayBack > 0) {
      // Create payment record with session (This also will handle order paid amount, customer balance, and warehouse balance)
      [paymentRecord] = await Payment.create(
        [
          {
            warehouseId,
            salesOrderId,
            customerId: salesOrder.customer._id,
            amountPaid: amountToPayBack,
            type: 'out',
            paymentMethod,
            paymentCategory: 'sales-return',
            createdBy: req.user._id,
          },
        ],
        { session }
      );
    }

    const updateSalesOrder = await SalesOrderModel.findById(salesOrderId).session(session);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ message: 'Item Returned Successfully', data: { return: returnRecord, payment: paymentRecord, salesOrder: updateSalesOrder } });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    next(new ApiError(err.message, 500));
  }
};

exports.returnAllSalesOrderItems = async (req, res, next) => {
  const { salesOrderId, warehouseId, paymentMethod, notes } = req.body;

  const session = await SalesOrderReturnModel.startSession();
  session.startTransaction();

  try {
    // Get original Sales Order
    const salesOrder = await SalesOrderModel.findById(salesOrderId).session(session);
    if (!salesOrder) return next(new ApiError('Sales order not found', 404));

    // Calculate total return amount
    let totalReturnedAmount = 0;
    const returnRecords = [];

    // Process each item in the sales order that has remaining items to return
    for (const item of salesOrder.items) {
      const remainingQty = item.starterQuantity - item.returnedQuantity;

      if (remainingQty <= 0) continue; // Skip items that are already fully returned

      // Update returned quantity in sales order
      item.returnedQuantity += remainingQty;
      item.quantityToBeReturned = 0;

      // Get original variant to be updated
      const variant = await Variant.findById(item.variant._id).session(session);
      if (!variant) {
        await session.abortTransaction();
        session.endSession();
        return next(new ApiError(`Variant with ID ${item.variant._id} not found.`, 404));
      }

      // Get product to update totalSold
      const product = await Product.findById(variant.productId).session(session);
      if (!product) {
        await session.abortTransaction();
        session.endSession();
        return next(new ApiError(`Product not found for variant ${item.variant._id}`, 404));
      }

      // Update product totalSold
      product.totalSold = Math.max((product.totalSold || 0) - remainingQty, 0);
      await product.save({ session });

      // Update stock in warehouse
      const stockEntry = variant.stock.find(s => s.warehouse.toString() === warehouseId.toString());
      if (!stockEntry) {
        await session.abortTransaction();
        session.endSession();
        return next(new ApiError(`No stock found for variant ${item.variant._id} in warehouse ${warehouseId}`, 404));
      }
      stockEntry.quantity += remainingQty;
      await variant.save({ session });

      // Calculate return amount for this item
      const returnedAmount = remainingQty * item.unitPriceAfterDiscount;
      totalReturnedAmount += returnedAmount;

      // Create return record for this item
      const [returnRecord] = await SalesOrderReturnModel.create(
        [
          {
            salesOrderId,
            warehouseId,
            variantId: item.variant._id,
            returnedQuantity: remainingQty,
            returnedAmount,
            notes,
            createdBy: req.user._id,
          },
        ],
        { session }
      );

      returnRecords.push(returnRecord);
    } // End loop

    if (returnRecords.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return next(new ApiError('No items available to return', 400));
    }

    // Get remaining amount BEFORE saving (as it will be updated after saving by pre-save middleware)
    const orderRemainingAmount = salesOrder.remainingAmount;

    // Save the updated sales order
    await salesOrder.save({ session });

    // Update customer balance
    const customer = await UserModel.findById(salesOrder.customer._id).session(session);
    if (!customer) {
      await session.abortTransaction();
      session.endSession();
      return next(new ApiError('Customer not found', 404));
    }
    customer.balance += totalReturnedAmount;
    await customer.save({ session });

    let paymentRecord = null;
    const amountToPayBack = totalReturnedAmount - orderRemainingAmount;

    if (amountToPayBack > 0) {
      // Create payment record
      [paymentRecord] = await Payment.create(
        [
          {
            warehouseId,
            salesOrderId,
            customerId: salesOrder.customer._id,
            amountPaid: amountToPayBack,
            type: 'out',
            paymentMethod,
            paymentCategory: 'sales-return',
            createdBy: req.user._id,
          },
        ],
        { session }
      );
    }

    const updatedSalesOrder = await SalesOrderModel.findById(salesOrderId).session(session);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'All items returned successfully',
      data: {
        returns: returnRecords,
        payment: paymentRecord,
        salesOrder: updatedSalesOrder,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    next(new ApiError(err.message, 500));
  }
};

// Get all returns
exports.getAllReturns = factory.getAll(SalesOrderReturnModel);

// Get single return
exports.getReturn = factory.getOne(SalesOrderReturnModel);
