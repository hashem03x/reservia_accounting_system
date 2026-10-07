const asyncHandler = require('express-async-handler');
const Transfer = require('../../models/inventory/transferModel');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// Helper function to get English title
const getEnglishTitle = title => {
  if (!title) return 'Unknown Product';
  return title.en || Object.values(title)[0] || 'Unknown Product';
};

// @desc    Get Inventory Transfer Report
// @route   GET /api/v1/reports/inventory-transfer
// @access  Private
exports.getInventoryTransferReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, sourceWarehouse, targetWarehouse, status, sortBy, sortOrder } = req.query;

  // Build match stage
  const matchStage = {};

  // Add date range filter if provided
  if (startDate || endDate) {
    matchStage.transferredAt = {};
    if (startDate) matchStage.transferredAt.$gte = new Date(startDate);
    if (endDate) matchStage.transferredAt.$lte = new Date(endDate);
  }

  // Add warehouse filters if provided
  if (sourceWarehouse) {
    matchStage.sourceWarehouse = require('mongoose').Types.ObjectId(sourceWarehouse);
  }
  if (targetWarehouse) {
    matchStage.targetWarehouse = require('mongoose').Types.ObjectId(targetWarehouse);
  }

  // Add status filter if provided
  if (status && ['initiated', 'completed', 'failed'].includes(status)) {
    matchStage.status = status;
  }

  const transfers = await Transfer.aggregate([
    {
      $match: matchStage,
    },
    {
      $lookup: {
        from: 'products',
        localField: 'product',
        foreignField: '_id',
        as: 'productDetails',
      },
    },
    {
      $lookup: {
        from: 'warehouses',
        localField: 'sourceWarehouse',
        foreignField: '_id',
        as: 'sourceWarehouseDetails',
      },
    },
    {
      $lookup: {
        from: 'warehouses',
        localField: 'targetWarehouse',
        foreignField: '_id',
        as: 'targetWarehouseDetails',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'transferredBy',
        foreignField: '_id',
        as: 'userDetails',
      },
    },
    {
      $unwind: {
        path: '$productDetails',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$sourceWarehouseDetails',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$targetWarehouseDetails',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$userDetails',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        date: '$transferredAt',
        type: 1,
        totalQuantity: 1,
        sourceWarehouse: '$sourceWarehouseDetails.name',
        targetWarehouse: '$targetWarehouseDetails.name',
        'product.title': '$productDetails.title',
        details: 1,
        'transferredBy.name': '$userDetails.name',
        status: 1,
      },
    },
    {
      $sort: {
        date: sortOrder === 'desc' ? -1 : 1,
      },
    },
  ]);

  // Calculate summary statistics
  const summary = {
    totalTransfers: transfers.length,
    totalQuantity: transfers.reduce((sum, t) => sum + (t.totalQuantity || 0), 0),
    byStatus: transfers.reduce((acc, transfer) => {
      if (!acc[transfer.status]) {
        acc[transfer.status] = 0;
      }
      acc[transfer.status]++;
      return acc;
    }, {}),
    byWarehouse: transfers.reduce((acc, transfer) => {
      // Source warehouse (outbound)
      if (!acc[transfer.sourceWarehouse]) {
        acc[transfer.sourceWarehouse] = { outbound: 0, inbound: 0 };
      }
      acc[transfer.sourceWarehouse].outbound += transfer.totalQuantity || 0;

      // Target warehouse (inbound)
      if (!acc[transfer.targetWarehouse]) {
        acc[transfer.targetWarehouse] = { outbound: 0, inbound: 0 };
      }
      acc[transfer.targetWarehouse].inbound += transfer.totalQuantity || 0;

      return acc;
    }, {}),
  };

  res.status(200).json({
    status: 'success',
    results: transfers.length,
    data: {
      transfers,
      summary,
    },
  });
});

// @desc    Generate Inventory Transfer Excel Report
// @route   POST /api/v1/reports/inventory-transfer
// @access  Private
exports.generateInventoryTransferExcel = asyncHandler(async (req, res) => {
  const { startDate, endDate, sourceWarehouse, targetWarehouse, sortOrder } = req.body;

  // Build match stage
  const matchStage = {};

  // Add date range filter if provided
  if (startDate || endDate) {
    matchStage.transferredAt = {};
    if (startDate) matchStage.transferredAt.$gte = new Date(startDate);
    if (endDate) matchStage.transferredAt.$lte = new Date(endDate);
  }

  // Add warehouse filters if provided
  if (sourceWarehouse) {
    matchStage.sourceWarehouse = require('mongoose').Types.ObjectId(sourceWarehouse);
  }
  if (targetWarehouse) {
    matchStage.targetWarehouse = require('mongoose').Types.ObjectId(targetWarehouse);
  }

  // // Add status filter if provided
  // if (status && ['initiated', 'completed', 'failed'].includes(status)) {
  //   matchStage.status = status;
  // }

  const transfers = await Transfer.aggregate([
    {
      $match: matchStage,
    },
    {
      $lookup: {
        from: 'products',
        localField: 'product',
        foreignField: '_id',
        as: 'productDetails',
      },
    },
    {
      $lookup: {
        from: 'warehouses',
        localField: 'sourceWarehouse',
        foreignField: '_id',
        as: 'sourceWarehouseDetails',
      },
    },
    {
      $lookup: {
        from: 'warehouses',
        localField: 'targetWarehouse',
        foreignField: '_id',
        as: 'targetWarehouseDetails',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'transferredBy',
        foreignField: '_id',
        as: 'userDetails',
      },
    },
    {
      $unwind: {
        path: '$productDetails',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$sourceWarehouseDetails',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$targetWarehouseDetails',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$userDetails',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        date: '$transferredAt',
        type: 1,
        totalQuantity: 1,
        sourceWarehouse: '$sourceWarehouseDetails.name',
        targetWarehouse: '$targetWarehouseDetails.name',
        'product.title': '$productDetails.title',
        details: 1,
        'transferredBy.name': '$userDetails.name',
        status: 1,
      },
    },
    {
      $sort: {
        date: sortOrder === 'desc' ? -1 : 1,
      },
    },
  ]);

  if (!transfers.length) {
    throw new ApiError('No transfer data available for export', 404);
  }

  // Prepare headers
  const headers = ['Date', 'Type', 'Product', 'Total Quantity', 'From Warehouse', 'To Warehouse', 'Status', 'Transferred By'];

  // Format date for better readability
  const formatDate = date =>
    new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  // Transform data for excel format
  const data = transfers.map(transfer => [
    formatDate(transfer.date),
    transfer.type,
    getEnglishTitle(transfer.product?.title),
    transfer.details.reduce((sum, item) => sum + item.quantity, 0),
    transfer.sourceWarehouse || 'N/A',
    transfer.targetWarehouse || 'N/A',
    // transfer.status || 'N/A',
    // transfer.transferredBy?.name || 'N/A',
  ]);

  // Calculate warehouse totals
  const warehouseTotals = transfers.reduce((acc, transfer) => {
    // Source warehouse (outbound)
    if (!acc[transfer.sourceWarehouse]) {
      acc[transfer.sourceWarehouse] = { outbound: 0, inbound: 0 };
    }
    acc[transfer.sourceWarehouse].outbound += transfer.totalQuantity || 0;

    // Target warehouse (inbound)
    if (!acc[transfer.targetWarehouse]) {
      acc[transfer.targetWarehouse] = { outbound: 0, inbound: 0 };
    }
    acc[transfer.targetWarehouse].inbound += transfer.totalQuantity || 0;

    return acc;
  }, {});

  // Calculate status totals
  const statusTotals = transfers.reduce((acc, transfer) => {
    if (!acc[transfer.status]) {
      acc[transfer.status] = {
        count: 0,
        quantity: 0,
      };
    }
    acc[transfer.status].count++;
    acc[transfer.status].quantity += transfer.totalQuantity || 0;
    return acc;
  }, {});

  // Add summary section
  const summaryData = [
    ['', '', '', '', '', '', '', ''], // Empty row
    // ['Status Summary, '', '', '', '', '', '', ''],
    // ['Status', 'Count', 'Total Quantity', '', '', '', '', ''],
    // ...Object.entries(statusTotals).map(([status, { count, quantity }]) => [status.toUpperCase(), count, quantity, '', '', '', '', '']),
    ['', '', '', '', '', '', '', ''], // Empty row
    // ['Warehouse Movement Summary', '', '', '', '', '', '', ''],
    // ['Warehouse', 'Inbound', 'Outbound', 'Net', '', '', '', ''],
    // ...Object.entries(warehouseTotals).map(([warehouse, { inbound, outbound }]) => [warehouse, inbound, outbound, inbound - outbound, '', '', '', '']),
    ['', '', '', '', '', '', '', ''], // Empty row
    ['TOTAL TRANSFERS', transfers.length, '', '', '', '', '', ''],
    // ['TOTAL QUANTITY', transfers.reduce((sum, t) => sum + (t.totalQuantity || 0), 0), '', '', '', '', '', ''],
  ];

  // Generate Excel file
  await exportToExcel(res, `Inventory_Transfer_Report_${startDate ? formatDate(startDate) : 'All'}_to_${endDate ? formatDate(endDate) : 'All'}`, headers, [
    ...data,
    ...summaryData,
  ]);
});
