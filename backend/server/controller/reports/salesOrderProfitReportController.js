const asyncHandler = require('express-async-handler');
const SalesOrder = require('../../models/sales/salesOrderModel');
const exportToExcel = require('../../utils/exportToExcel');

// Helper function to get English title
const getEnglishTitle = title => {
  if (!title) return 'Unknown Product';
  return title.en || Object.values(title)[0] || 'Unknown Product';
};

// Helper function to format date
const formatDate = date => {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

// @desc    Get Sales Order Profit Report
// @route   GET /api/v1/reports/sales-profit
// @access  Private
exports.getSalesOrderProfitReport = asyncHandler(async (req, res) => {
  let { startDate, endDate, warehouse } = req.query;

  // Set default date range to last year if not provided
  if (!startDate || !endDate) {
    const now = new Date();
    endDate = now.toISOString();
    startDate = new Date(now.setFullYear(now.getFullYear() - 1)).toISOString();
  }

  // Build query
  const query = {
    createdAt: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
  };

  if (warehouse) {
    query.warehouse = warehouse;
  }

  const salesOrders = await SalesOrder.find(query)
    .populate({
      path: 'items.product',
      select: 'title cost',
    })
    .populate('warehouse', 'name')
    .select('items totalAmount createdAt warehouse');

  // Calculate profit for each order
  const profitReport = salesOrders.map(order => {
    let totalCost = 0;

    // Calculate total cost from items
    order.items.forEach(item => {
      if (item.product && item.product.cost) {
        totalCost += item.product.cost * (item.starterQuantity - (item.returnedQuantity || 0));
      }
    });

    const totalSales = order.totalAmount || 0;
    const profit = totalSales - totalCost;
    const profitMargin = totalSales > 0 ? ((profit / totalSales) * 100).toFixed(2) : 0;

    return {
      orderId: order._id,
      date: order.createdAt,
      warehouse: order.warehouse ? order.warehouse.name : 'N/A',
      items: order.items.map(item => ({
        name: item.product ? getEnglishTitle(item.product.title) : 'Unknown Item',
        quantity: item.starterQuantity - (item.returnedQuantity || 0),
        costPrice: item.product ? item.product.cost : 0,
        sellingPrice: item.unitPriceAfterDiscount || item.unitPrice || 0,
      })),
      totalSales,
      totalCost,
      profit,
      profitMargin: `${profitMargin}%`,
    };
  });

  res.status(200).json({
    status: 'success',
    results: profitReport.length,
    data: profitReport,
  });
});

// @desc    Generate Sales Order Profit Report Excel
// @route   POST /api/v1/reports/sales-profit
// @access  Private
exports.generateSalesOrderProfitReport = asyncHandler(async (req, res) => {
  let { startDate, endDate, warehouse } = req.body;

  // Set default date range to last year if not provided
  if (!startDate || !endDate) {
    const now = new Date();
    endDate = now.toISOString();
    startDate = new Date(now.setFullYear(now.getFullYear() - 1)).toISOString();
  }

  // Build query
  const query = {
    createdAt: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
  };

  if (warehouse) {
    query.warehouse = warehouse;
  }

  const salesOrders = await SalesOrder.find(query)
    .populate({
      path: 'items.product',
      select: 'title cost',
    })
    .populate('warehouse', 'name')
    .select('items totalAmount createdAt warehouse');

  // Prepare data for Excel export
  const headers = [
    'Date',
    'Order ID',
    'Warehouse',
    'Product',
    'Quantity',
    'Cost Price',
    'Selling Price',
    'Total Cost',
    'Total Sales',
    'Profit',
    'Profit Margin',
  ];

  const excelData = [];
  let totalSales = 0;
  let totalCost = 0;
  let totalProfit = 0;

  salesOrders.forEach(order => {
    order.items.forEach(item => {
      if (item.product) {
        const quantity = item.starterQuantity - (item.returnedQuantity || 0);
        const costPrice = item.product.cost || 0;
        const sellingPrice = item.unitPriceAfterDiscount || item.unitPrice || 0;
        const itemTotalCost = costPrice * quantity;
        const itemTotalSales = sellingPrice * quantity;
        const itemProfit = itemTotalSales - itemTotalCost;
        const profitMargin = itemTotalSales > 0 ? ((itemProfit / itemTotalSales) * 100).toFixed(2) : '0.00';

        totalSales += itemTotalSales;
        totalCost += itemTotalCost;
        totalProfit += itemProfit;

        excelData.push([
          formatDate(order.createdAt),
          order._id.toString(),
          order.warehouse ? order.warehouse.name : 'N/A',
          getEnglishTitle(item.product.title),
          quantity,
          costPrice,
          sellingPrice,
          itemTotalCost,
          itemTotalSales,
          itemProfit,
          `${profitMargin}%`,
        ]);
      }
    });
  });

  // Add total row
  const totalProfitMargin = totalSales > 0 ? ((totalProfit / totalSales) * 100).toFixed(2) : '0.00';
  const totalRow = [
    'TOTAL',
    '',
    '',
    '',
    '',
    '',
    '',
    totalCost,
    totalSales,
    totalProfit,
    `${totalProfitMargin}%`,
  ];

  // Generate Excel file
  const filename = `Sales_Profit_Report_${formatDate(startDate)}_to_${formatDate(endDate)}`;
  await exportToExcel(res, filename, headers, excelData, { totalRow });
});
