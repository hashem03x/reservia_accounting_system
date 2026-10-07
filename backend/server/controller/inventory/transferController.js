const mongoose = require('mongoose');
const Product = require('../../models/inventory/productModel');
const Transfer = require('../../models/inventory/transferModel'); // For logging transfers
const factory = require('../handlersFactory');
const asyncHandler = require('express-async-handler');
const Payment = require('../../models/vendor/paymentModel');

/**
 * Handle stock transfer logic.
 * @param {String} type - The type of transfer ('product' = move all available stock of one
 *   product; 'products' = move specific quantities of one or more products).
 * @param {String} warehouseId - The source warehouse ID.
 * @param {String} targetWarehouseId - The target warehouse ID.
 * @param {Object|Array} details - `{ productId }` for type 'product', or `[{ productId, quantity }]` for type 'products'.
 * @param {String} product - Top-level product id stored on the Transfer log record (required by the schema).
 */
async function transferStock(type, warehouseId, targetWarehouseId, details, product, userId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const transferLogs = [];

    if (type === 'product') {
      // **Whole-stock Transfer** - move everything this product has in the source warehouse.
      const { productId } = details;
      const productDoc = await Product.findById(productId).session(session);
      if (!productDoc) throw new Error(`Product with ID ${productId} not found`);

      const sourceStockIndex = productDoc.stock.findIndex(item => item.warehouse.toString() === warehouseId && item.quantity > 0);
      let quantityToTransfer = 0;

      if (sourceStockIndex !== -1) {
        quantityToTransfer = productDoc.stock[sourceStockIndex].quantity;
        const targetStockIndex = productDoc.stock.findIndex(item => item.warehouse.toString() === targetWarehouseId);

        if (targetStockIndex !== -1) {
          await Product.findByIdAndUpdate(
            productDoc._id,
            {
              $set: {
                [`stock.${sourceStockIndex}.quantity`]: 0,
                [`stock.${targetStockIndex}.quantity`]: productDoc.stock[targetStockIndex].quantity + quantityToTransfer,
              },
            },
            { new: true, session }
          );
        } else {
          await Product.findByIdAndUpdate(productDoc._id, { $set: { [`stock.${sourceStockIndex}.quantity`]: 0 } }, { new: true, session });
          await Product.findByIdAndUpdate(productDoc._id, { $push: { stock: { warehouse: targetWarehouseId, quantity: quantityToTransfer } } }, { new: true, session });
        }
      }

      transferLogs.push({
        type,
        product: productId,
        details: [{ product: productId, quantity: quantityToTransfer }],
        sourceWarehouse: warehouseId,
        targetWarehouse: targetWarehouseId,
        transferredBy: userId,
      });
    } else if (type === 'products') {
      // **Specific-quantity Transfer** - one or more products, each with its own quantity.
      const arrayOfDetails = [];
      for (const { productId, quantity } of details) {
        const productDoc = await Product.findById(productId).session(session);
        if (!productDoc) throw new Error(`Product with ID ${productId} not found`);

        const sourceStockIndex = productDoc.stock.findIndex(item => item.warehouse.toString() === warehouseId);
        if (sourceStockIndex === -1 || productDoc.stock[sourceStockIndex].quantity < quantity) {
          throw new Error(`Insufficient stock for product ${productDoc.title} in source warehouse`);
        }

        const targetStockIndex = productDoc.stock.findIndex(item => item.warehouse.toString() === targetWarehouseId);

        if (targetStockIndex !== -1) {
          await Product.findByIdAndUpdate(
            productId,
            {
              $set: {
                [`stock.${sourceStockIndex}.quantity`]: productDoc.stock[sourceStockIndex].quantity - quantity,
                [`stock.${targetStockIndex}.quantity`]: productDoc.stock[targetStockIndex].quantity + quantity,
              },
            },
            { new: true, session }
          );
        } else {
          await Product.findByIdAndUpdate(productId, { $set: { [`stock.${sourceStockIndex}.quantity`]: productDoc.stock[sourceStockIndex].quantity - quantity } }, { new: true, session });
          await Product.findByIdAndUpdate(productId, { $push: { stock: { warehouse: targetWarehouseId, quantity } } }, { new: true, session });
        }

        arrayOfDetails.push({ product: productId, quantity });
      }

      transferLogs.push({
        type,
        product, // top-level product id required by the schema - the caller-supplied "primary" product for this transfer
        sourceWarehouse: warehouseId,
        targetWarehouse: targetWarehouseId,
        details: arrayOfDetails,
        transferredBy: userId,
      });
    } else {
      throw new Error(`Invalid transfer type: ${type}`);
    }

    // Save transfer logs
    const transfers = await Transfer.insertMany(transferLogs, { session });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    const data = await Promise.all(transfers.map(transfer => Transfer.findById(transfer._id)));

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
