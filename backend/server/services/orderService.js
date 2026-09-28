const SalesOrder = require('../models/sales/salesOrderModel');
const AppError = require('../utils/appError');
const inventoryService = require('./inventoryService');
const warehouseService = require('./warehouseService');

class OrderService {
  async createOrder(orderData, orderSource) {
    try {
      // Validate and prepare order data
      const preparedOrder = {
        ...orderData,
        orderSource,
        createdAt: new Date(),
      };

      // Additional validation for online orders
      if (orderSource === 'website') {
        if (!orderData.shippingAddress || !orderData.shippingAddress.governorate) {
          throw new AppError('Shipping address is required for online orders', 400);
        }

        // For website orders, automatically select the best warehouse
        const bestWarehouse = await warehouseService.findBestWarehouseForOrder(preparedOrder.items);
        preparedOrder.warehouse = bestWarehouse.warehouseId;
      } else if (orderSource === 'pos') {
        // For POS orders, warehouse must be specified
        if (!orderData.warehouse) {
          throw new AppError('Warehouse ID is required for POS orders', 400);
        }
        if (!orderData.employee) {
          throw new AppError('Employee ID is required for POS orders', 400);
        }
      }

      // Check stock availability
      await inventoryService.checkStockAvailability(preparedOrder.items, preparedOrder.warehouse);

      // Calculate order totals
      const order = await this.calculateOrderTotals(preparedOrder);

      // Create the order
      const newOrder = await SalesOrder.create(order);

      // Update stock levels
      await inventoryService.updateStock(newOrder.items, newOrder.warehouse);

      return newOrder;
    } catch (error) {
      throw new AppError(error.message, error.statusCode || 400);
    }
  }

  async calculateOrderTotals(orderData) {
    // Calculate items subtotal
    let subTotal = 0;
    orderData.items = orderData.items.map(item => {
      // Calculate unit price after item discount
      const unitPriceAfterDiscount =
        item.discountItem.type === 'percentage' ? item.unitPrice - (item.unitPrice * item.discountItem.value) / 100 : item.unitPrice - item.discountItem.value;

      // Calculate item subtotal
      const itemSubTotal = unitPriceAfterDiscount * item.quantity;
      subTotal += itemSubTotal;

      return {
        ...item,
        unitPriceAfterDiscount,
        subTotal: itemSubTotal,
      };
    });

    // Calculate order discount
    const subtotalAfterDiscount =
      orderData.discountOrder.type === 'percentage' ? subTotal - (subTotal * orderData.discountOrder.value) / 100 : subTotal - orderData.discountOrder.value;

    // Calculate tax
    const taxAmount = (subtotalAfterDiscount * orderData.taxRate) / 100;

    // Calculate final total
    const totalAmount = subtotalAfterDiscount + taxAmount + orderData.shippingCost;

    return {
      ...orderData,
      subTotal,
      taxAmount,
      totalAmount,
      balanceDue: totalAmount,
    };
  }

  async updateOrderStatus(orderId, status, userId) {
    const order = await SalesOrder.findById(orderId);
    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Validate status transition
    const validTransitions = {
      pending: ['processing', 'cancelled'],
      processing: ['shipped', 'cancelled'],
      shipped: ['delivered', 'cancelled'],
      delivered: ['cancelled'],
      cancelled: [],
    };

    if (!validTransitions[order.orderStatus].includes(status)) {
      throw new AppError(`Invalid status transition from ${order.orderStatus} to ${status}`, 400);
    }

    // Handle stock updates for cancellations
    if (status === 'cancelled' && !order.isCancelled) {
      await inventoryService.handleOrderCancellation(order.items, order.warehouse);
    }

    order.orderStatus = status;
    order.updatedAt = new Date();
    await order.save();

    return order;
  }

  async processPayment(orderId, paymentData) {
    const order = await SalesOrder.findById(orderId);
    if (!order) {
      throw new AppError('Order not found', 404);
    }

    const { amount, paymentMethod } = paymentData;

    // Validate payment amount
    if (amount > order.balanceDue) {
      throw new AppError('Payment amount exceeds balance due', 400);
    }

    // Update payment information
    order.paidAmount += amount;
    order.balanceDue = order.totalAmount - order.paidAmount;
    order.paymentMethod = paymentMethod;

    // Update payment status
    if (order.balanceDue === 0) {
      order.paymentStatus = 'paid';
    } else if (order.paidAmount > 0) {
      order.paymentStatus = 'partial';
    }

    order.paidAt = new Date();
    await order.save();

    return order;
  }

  async cancelOrder(orderId, reason) {
    const order = await SalesOrder.findById(orderId);
    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Check if order can be cancelled
    if (['delivered', 'cancelled'].includes(order.orderStatus)) {
      throw new AppError(`Cannot cancel order in ${order.orderStatus} status`, 400);
    }

    // Restore stock for cancelled order
    await inventoryService.handleOrderCancellation(order.items, order.warehouse);

    order.orderStatus = 'cancelled';
    order.isCancelled = true;
    order.notes = reason;
    order.updatedAt = new Date();
    await order.save();

    return order;
  }
}

module.exports = new OrderService();
