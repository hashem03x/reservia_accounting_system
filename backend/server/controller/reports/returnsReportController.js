const asyncHandler = require('express-async-handler');
const SalesOrderReturn = require('../../models/sales/salesOrderReturnModel');
const exportToExcel = require('../../utils/exportToExcel');

/**
 * Get Returns Report
 * @route GET /api/reports/returns
 * @description Retrieve analysis for returned sales orders
 */
exports.getReturnsReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, sortBy, sortOrder } = req.query;

  // Build base query
  const query = {};

  if (startDate) {
    query.createdAt = {
      ...query.createdAt,
      $gte: new Date(startDate),
    };
  }

  if (endDate) {
    query.createdAt = {
      ...query.createdAt,
      $lte: new Date(endDate),
    };
  }

  // Get all returns with populated references
  const returns = await SalesOrderReturn.find(query)
    .populate([
      {
        path: 'salesOrderId',
        select: 'orderNumber customer createdAt',
        populate: {
          path: 'customer',
          select: 'name phone email',
        },
      },
      {
        path: 'warehouseId',
        select: 'name',
      },
      {
        path: 'productId',
        select: 'title category subcategory sku barcode',
        populate: ['category', 'subcategory'],
      },
      {
        path: 'createdBy',
        select: 'name',
      },
    ])
    .lean();

  // Transform data for the report
  const returnsData = returns.map(item => ({
    returnId: item._id,
    orderNumber: item.salesOrderId?.orderNumber,
    customerName: item.salesOrderId?.customer?.name,
    customerPhone: item.salesOrderId?.customer?.phone,
    warehouse: item.warehouseId?.name,
    product: item.productId?.title?.en || item.productId?.title,
    category: item.productId?.category?.name?.en,
    subcategory: item.productId?.subcategory?.name?.en,
    sku: item.productId?.sku,
    barcode: item.productId?.barcode,
    returnedQuantity: item.returnedQuantity,
    returnedAmount: item.returnedAmount,
    createdBy: item.createdBy?.name,
    createdAt: item.createdAt,
    notes: item.notes,
  }));

  // Apply sorting
  const sortField = sortBy || 'createdAt';
  const sortDirection = sortOrder === 'asc' ? 1 : -1;
  returnsData.sort((a, b) => {
    if (sortField === 'createdAt') {
      return sortDirection * (new Date(b.createdAt) - new Date(a.createdAt));
    }
    return sortDirection * (b[sortField] - a[sortField]);
  });

  res.status(200).json({
    status: 'success',
    results: returnsData.length,
    data: returnsData,
  });
});

/**
 * Export Returns Report to Excel
 * @route POST /api/reports/returns
 * @description Export returns analysis data to Excel
 */
exports.exportReturnsReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, sortBy, sortOrder } = req.query;

  // Build base query
  const query = {};

  if (startDate) {
    query.createdAt = {
      ...query.createdAt,
      $gte: new Date(startDate),
    };
  }

  if (endDate) {
    query.createdAt = {
      ...query.createdAt,
      $lte: new Date(endDate),
    };
  }

  // Get all returns with populated references
  const returns = await SalesOrderReturn.find(query)
    .populate([
      {
        path: 'salesOrderId',
        select: 'orderNumber customer createdAt',
        populate: {
          path: 'customer',
          select: 'name phone email',
        },
      },
      {
        path: 'warehouseId',
        select: 'name',
      },
      {
        path: 'productId',
        select: 'title category subcategory sku barcode',
        populate: ['category', 'subcategory'],
      },
      {
        path: 'createdBy',
        select: 'name',
      },
    ])
    .lean();

  // If no returns found, send empty response
  if (!returns || returns.length === 0) {
    return res.status(200).json({
      status: 'success',
      results: 0,
      data: [],
    });
  }

  // Transform data for the report
  const returnsData = returns.map(item => ({
    returnId: item._id,
    orderNumber: item.salesOrderId?.orderNumber,
    customerName: item.salesOrderId?.customer?.name,
    customerPhone: item.salesOrderId?.customer?.phone,
    warehouse: item.warehouseId?.name,
    product: item.productId?.title?.en || item.productId?.title,
    category: item.productId?.category?.name?.en,
    subcategory: item.productId?.subcategory?.name?.en,
    sku: item.productId?.sku,
    barcode: item.productId?.barcode,
    returnedQuantity: item.returnedQuantity,
    returnedAmount: item.returnedAmount,
    createdBy: item.createdBy?.name,
    createdAt: item.createdAt,
    notes: item.notes,
  }));

  // Apply sorting
  const sortField = sortBy || 'createdAt';
  const sortDirection = sortOrder === 'asc' ? 1 : -1;
  returnsData.sort((a, b) => {
    if (sortField === 'createdAt') {
      return sortDirection * (new Date(b.createdAt) - new Date(a.createdAt));
    }
    return sortDirection * (b[sortField] - a[sortField]);
  });

  // Transform sorted data for Excel
  const excelData = returnsData.map(item => [
    item.orderNumber || '',
    item.customerName || '',
    item.customerPhone || '',
    item.warehouse || '',
    item.product || '',
    item.category || '',
    item.subcategory || '',
    item.sku || '',
    item.barcode || '',
    item.returnedQuantity || 0,
    Number(item.returnedAmount?.toFixed(2)) || 0,
    item.createdBy || '',
    new Date(item.createdAt).toLocaleDateString(),
    item.notes || '',
  ]);

  // Ensure we have data to export
  if (!excelData || excelData.length === 0) {
    return res.status(200).json({
      status: 'success',
      results: 0,
      data: [],
    });
  }

  const headers = ['Order Number', 'Customer Name', 'Customer Phone', 'Warehouse', 'Product', 'Category', 'Subcategory', 'SKU', 'Barcode', 'Returned Quantity', 'Returned Amount', 'Created By', 'Created At', 'Notes'];

  // Calculate totals
  const totals = returnsData.reduce(
    (acc, item) => ['Total', '', '', '', '', '', '', '', '', acc[9] + (item.returnedQuantity || 0), Number((acc[10] + (item.returnedAmount || 0)).toFixed(2)), '', '', ''],
    ['Total', '', '', '', '', '', '', '', '', 0, 0, '', '', '']
  );

  await exportToExcel(res, 'Returns_Report', headers, excelData, {
    totalRow: totals,
  });
});
