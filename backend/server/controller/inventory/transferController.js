const mongoose = require('mongoose');
const Variant = require('../../models/inventory/variantModel');
const Transfer = require('../../models/inventory/transferModel'); // For logging transfers
const factory = require('../handlersFactory');
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const Payment = require('../../models/vendor/paymentModel');
const Warehouse = require('../../models/inventory/warehouseModel');

/**
 * Handle stock transfer logic.
 * @param {String} type - The type of transfer ('product', 'variant', 'variants').
 * @param {String} warehouseId - The source warehouse ID.
 * @param {String} targetWarehouseId - The target warehouse ID.
 * @param {Array} details - Details of the transfer (e.g., productId or variant details).
 */
async function transferStock(type, warehouseId, targetWarehouseId, details, product, userId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const transferLogs = [];
    const arrayOfDetails = [];

    if (type === 'product') {
      // **Product-Level Transfer Logic**
      const { productId } = details;
      const variants = await Variant.find({ productId, 'stock.warehouse': warehouseId }).session(session);

      for (const variant of variants) {
        // Find the stock item for the source warehouse
        const sourceStockIndex = variant.stock.findIndex(item => item.warehouse.toString() === warehouseId && item.quantity > 0 && !variant.isDeleted);

        if (sourceStockIndex !== -1) {
          const quantityToTransfer = variant.stock[sourceStockIndex].quantity;

          // Find target stock index
          const targetStockIndex = variant.stock.findIndex(item => item.warehouse.toString() === targetWarehouseId);

          if (targetStockIndex !== -1) {
            // If target exists, update both quantities in one operation
            await Variant.findByIdAndUpdate(
              variant._id,
              {
                $set: {
                  [`stock.${sourceStockIndex}.quantity`]: 0,
                  [`stock.${targetStockIndex}.quantity`]: variant.stock[targetStockIndex].quantity + quantityToTransfer,
                },
              },
              { new: true, session }
            );
          } else {
            // If target doesn't exist, first update source, then add target
            await Variant.findByIdAndUpdate(
              variant._id,
              {
                $set: {
                  [`stock.${sourceStockIndex}.quantity`]: 0,
                },
              },
              { new: true, session }
            );

            await Variant.findByIdAndUpdate(
              variant._id,
              {
                $push: {
                  stock: { warehouse: targetWarehouseId, quantity: quantityToTransfer },
                },
              },
              { new: true, session }
            );
          }

          arrayOfDetails.push({ variant: variant._id, quantity: quantityToTransfer });
        }
      }
      transferLogs.push({
        type,
        product: productId,
        details: arrayOfDetails, // details {variantId, quantity} is not available for product-level transfer
        sourceWarehouse: warehouseId,
        targetWarehouse: targetWarehouseId,
        transferredBy: userId,
      });
    } else if (type === 'variant') {
      // **Single Variant Transfer Logic**
      const { variantId, quantity } = details;

      const variant = await Variant.findById(variantId).session(session);

      if (!variant) throw new Error(`Variant with ID ${variantId} not found`);

      const sourceStock = variant.stock.find(item => item.warehouse.toString() === warehouseId);
      if (!sourceStock || sourceStock.quantity < quantity) {
        throw new Error(`Insufficient stock for variant ${variant.variantCode} in source warehouse`);
      }

      sourceStock.quantity -= quantity;

      let targetStock = variant.stock.find(item => item.warehouse.toString() === targetWarehouseId);
      if (!targetStock) {
        targetStock = { warehouse: targetWarehouseId, quantity: 0 };
        variant.stock.push(targetStock);
      }

      targetStock.quantity += quantity;

      await variant.save({ session });

      // check if the variant is exist in tr
      // Log the transfer
      transferLogs.push({
        type,
        // variantId,  // details {variantId, quantity} is not available for single variant transfer
        sourceWarehouse: warehouseId,
        targetWarehouse: targetWarehouseId,
        // quantity,
        details: [{ variantId, quantity }],
        totalQuantity: [{ variantId, quantity }].reduce((sum, detail) => sum + detail.quantity, 0),
      });
    } else if (type === 'variants') {
      // **Multiple Variants Transfer Logic**
      for (const { variantId, quantity } of details) {
        const variant = await Variant.findById(variantId).session(session);
        if (!variant) throw new Error(`Variant with ID ${variantId} not found`);

        const sourceStockIndex = variant.stock.findIndex(item => item.warehouse.toString() === warehouseId);

        if (sourceStockIndex === -1 || variant.stock[sourceStockIndex].quantity < quantity) {
          throw new Error(`Insufficient stock for variant ${variant.variantCode} in source warehouse`);
        }

        const targetStockIndex = variant.stock.findIndex(item => item.warehouse.toString() === targetWarehouseId);

        if (targetStockIndex !== -1) {
          // If target exists, update both quantities in one operation
          await Variant.findByIdAndUpdate(
            variantId,
            {
              $set: {
                [`stock.${sourceStockIndex}.quantity`]: variant.stock[sourceStockIndex].quantity - quantity,
                [`stock.${targetStockIndex}.quantity`]: variant.stock[targetStockIndex].quantity + quantity,
              },
            },
            { new: true, session }
          );
        } else {
          // If target doesn't exist, first update source, then add target
          await Variant.findByIdAndUpdate(
            variantId,
            {
              $set: {
                [`stock.${sourceStockIndex}.quantity`]: variant.stock[sourceStockIndex].quantity - quantity,
              },
            },
            { new: true, session }
          );

          await Variant.findByIdAndUpdate(
            variantId,
            {
              $push: {
                stock: { warehouse: targetWarehouseId, quantity: quantity },
              },
            },
            { new: true, session }
          );
        }

        arrayOfDetails.push({ variant: variantId, quantity });
      }
      transferLogs.push({
        type,
        sourceWarehouse: warehouseId,
        targetWarehouse: targetWarehouseId,
        details: arrayOfDetails,
        product,
        totalQuantity: arrayOfDetails.reduce((sum, detail) => sum + detail.quantity, 0),
        transferredBy: userId,
      });
    } else {
      throw new Error(`Invalid transfer type: ${type}`);
    }

    // Save transfer logs
    const transfers = await Transfer.insertMany(transferLogs, { session });
    // console.log(data);

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    const data = await Promise.all(
      transfers.map(async transfer => {
        const trans = await Transfer.findById(transfer.id);
        return trans;
      })
    );

    // console.log(data); // Now contains the populated results

    return { success: true, message: 'Stock transfer completed successfully', data };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
}

exports.createTransfer = asyncHandler(async (req, res) => {
  const { type, warehouseId, targetWarehouseId, details, productId } = req.body;

  try {
    const result = await transferStock(type, warehouseId, targetWarehouseId, details, productId, req.user._id);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

exports.getTransfers = factory.getAll(Transfer);

// @desc    Transfer Money Between Warehouses
// @route   POST /api/v1/transfers/money
// @access  Private
exports.transferMoney = asyncHandler(async (req, res) => {
  const { from_warehouse_id, to_warehouse_id, amount, withdraw_method, deposit_method } = req.body;

  // Start a transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Create payment records
    const [paymentOut] = await Payment.create(
      [
        {
          warehouseId: from_warehouse_id,
          type: 'out',
          amountPaid: amount,
          paymentMethod: withdraw_method || 'cash',
          paymentCategory: 'transfer',
          createdBy: req.user._id,
        },
      ],
      { session }
    );

    const [paymentIn] = await Payment.create(
      [
        {
          warehouseId: to_warehouse_id,
          type: 'in',
          amountPaid: amount,
          paymentMethod: deposit_method || 'cash',
          paymentCategory: 'transfer',
          createdBy: req.user._id,
        },
      ],
      { session }
    );

    // Commit the transaction
    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      data: {
        amount,
        withdrawMethod: withdraw_method || 'cash',
        depositMethod: deposit_method || 'cash',
        paymentOut,
        paymentIn,
      },
    });
  } catch (error) {
    // If anything fails and transaction hasn't been committed, abort it
    if (session.transaction.state !== 'committed') {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    // End the session
    session.endSession();
  }
});
