const Warehouse = require('../models/inventory/warehouseModel');
const Variant = require('../models/inventory/variantModel');
const AppError = require('../utils/appError');

class WarehouseService {
  async findBestWarehouseForOrder(items) {
    try {
      // Get all active warehouses
      const warehouses = await Warehouse.find({ isActive: true });
      if (!warehouses.length) {
        throw new AppError('No active warehouses found', 404);
      }

      // Calculate availability score for each warehouse
      const warehouseScores = await Promise.all(
        warehouses.map(async (warehouse) => {
          let score = 0;
          let canFulfillAllItems = true;
          let availableItems = [];

          // Check each item's availability in this warehouse
          for (const item of items) {
            const variant = await Variant.findById(item.variant);
            if (!variant) {
              throw new AppError(`Variant not found: ${item.variant}`, 404);
            }

            const warehouseStock = variant.stock.find(
              stock => stock.warehouse.toString() === warehouse._id.toString()
            );

            if (!warehouseStock || warehouseStock.quantity < item.quantity) {
              canFulfillAllItems = false;
              break;
            }

            // Add to score based on stock availability ratio
            const availabilityRatio = warehouseStock.quantity / item.quantity;
            score += availabilityRatio;

            availableItems.push({
              variant: variant._id,
              quantity: warehouseStock.quantity,
              requested: item.quantity
            });
          }

          return {
            warehouse: warehouse._id,
            name: warehouse.name,
            score: canFulfillAllItems ? score : -1,
            canFulfillAllItems,
            availableItems
          };
        })
      );

      // Filter warehouses that can fulfill all items
      const validWarehouses = warehouseScores.filter(w => w.canFulfillAllItems);

      if (!validWarehouses.length) {
        // Find which items are causing the fulfillment issue
        const itemAvailability = await this.checkItemAvailabilityAcrossWarehouses(items);
        throw new AppError(
          'No single warehouse can fulfill all items. Item availability: ' + 
          JSON.stringify(itemAvailability),
          400
        );
      }

      // Sort by score (highest first) and get the best warehouse
      const bestWarehouse = validWarehouses.sort((a, b) => b.score - a.score)[0];

      return {
        warehouseId: bestWarehouse.warehouse,
        name: bestWarehouse.name,
        availableItems: bestWarehouse.availableItems
      };
    } catch (error) {
      throw new AppError(error.message, error.statusCode || 400);
    }
  }

  async checkItemAvailabilityAcrossWarehouses(items) {
    const availability = await Promise.all(
      items.map(async (item) => {
        const variant = await Variant.findById(item.variant)
          .populate('productId', 'name');

        if (!variant) {
          return {
            item: item.variant,
            status: 'Not found',
            availableQuantity: 0,
            requestedQuantity: item.quantity
          };
        }

        // Calculate total available quantity across all warehouses
        const totalAvailable = variant.stock.reduce(
          (sum, stock) => sum + stock.quantity, 
          0
        );

        return {
          item: variant.productId.name,
          sku: variant.sku,
          status: totalAvailable >= item.quantity ? 'Available' : 'Insufficient stock',
          availableQuantity: totalAvailable,
          requestedQuantity: item.quantity
        };
      })
    );

    return availability;
  }

  async getWarehouseStockLevels(warehouseId) {
    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      throw new AppError('Warehouse not found', 404);
    }

    const variants = await Variant.find({
      'stock.warehouse': warehouseId
    }).populate('productId', 'name');

    const stockLevels = variants.map(variant => {
      const warehouseStock = variant.stock.find(
        stock => stock.warehouse.toString() === warehouseId.toString()
      );

      return {
        product: variant.productId.name,
        sku: variant.sku,
        quantity: warehouseStock ? warehouseStock.quantity : 0,
        color: variant.color,
        size: variant.size
      };
    });

    return {
      warehouse: warehouse.name,
      stockLevels
    };
  }
}

module.exports = new WarehouseService();
