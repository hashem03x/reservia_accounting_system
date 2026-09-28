const Variant = require('../models/inventory/variantModel');
const AppError = require('../utils/appError');

class InventoryService {
  async checkStockAvailability(items, warehouseId) {
    const stockChecks = await Promise.all(
      items.map(async item => {
        const variant = await Variant.findById(item.variant);
        if (!variant) {
          throw new AppError(`Variant not found: ${item.variant}`, 404);
        }

        const warehouseStock = variant.stock.find(stock => stock.warehouse.toString() === warehouseId.toString());

        if (!warehouseStock) {
          throw new AppError(`No stock found for variant ${variant.sku} in specified warehouse`, 400);
        }

        if (warehouseStock.quantity < item.quantity) {
          throw new AppError(`Insufficient stock for variant ${variant.sku}. Requested: ${item.quantity}, Available: ${warehouseStock.quantity}`, 400);
        }

        return {
          variant,
          requestedQuantity: item.quantity,
          warehouseStock,
        };
      })
    );

    return stockChecks;
  }

  async updateStock(items, warehouseId, operation = 'decrease') {
    const updates = await Promise.all(
      items.map(async item => {
        const variant = await Variant.findById(item.variant);
        if (!variant) {
          throw new AppError(`Variant not found: ${item.variant}`, 404);
        }

        const warehouseStockIndex = variant.stock.findIndex(stock => stock.warehouse.toString() === warehouseId.toString());

        if (warehouseStockIndex === -1) {
          throw new AppError(`No stock found for variant ${variant.sku} in specified warehouse`, 400);
        }

        // Calculate new quantity
        const currentQuantity = variant.stock[warehouseStockIndex].quantity;
        const quantityChange = operation === 'decrease' ? -item.quantity : item.quantity;
        const newQuantity = currentQuantity + quantityChange;

        // Validate new quantity
        if (newQuantity < 0) {
          throw new AppError(`Cannot reduce stock below 0 for variant ${variant.sku}. Current: ${currentQuantity}, Requested change: ${Math.abs(quantityChange)}`, 400);
        }

        // Update stock quantity
        variant.stock[warehouseStockIndex].quantity = newQuantity;

        // Save the variant with the updated stock
        await variant.save();

        return {
          variant: variant._id,
          sku: variant.sku,
          previousQuantity: currentQuantity,
          newQuantity,
          warehouse: warehouseId,
        };
      })
    );

    return updates;
  }

  async handleOrderCancellation(items, warehouseId) {
    // Restore stock for cancelled items
    return this.updateStock(items, warehouseId, 'increase');
  }

  async handleStockAdjustment(variantId, warehouseId, adjustment) {
    const variant = await Variant.findById(variantId);
    if (!variant) {
      throw new AppError('Variant not found', 404);
    }

    const warehouseStockIndex = variant.stock.findIndex(stock => stock.warehouse.toString() === warehouseId.toString());

    if (warehouseStockIndex === -1) {
      // If warehouse stock entry doesn't exist, create it
      variant.stock.push({
        warehouse: warehouseId,
        quantity: adjustment.quantity,
      });
    } else {
      // Update existing warehouse stock
      const newQuantity = variant.stock[warehouseStockIndex].quantity + adjustment.quantity;
      if (newQuantity < 0) {
        throw new AppError('Stock adjustment would result in negative quantity', 400);
      }
      variant.stock[warehouseStockIndex].quantity = newQuantity;
    }

    await variant.save();
    return variant;
  }
}

module.exports = new InventoryService();
