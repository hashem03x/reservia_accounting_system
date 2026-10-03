const PO = require('../../models/vendor/purchaseOrder');
const Payment = require('../../models/vendor/paymentModel');
const factory = require('../handlersFactory');
const ApiError = require('../../utils/apiError');
const salesOrderModel = require('../../models/sales/salesOrderModel');

exports.createPurchasePayment = async (req, res, next) => {
  const { warehouseId, purchaseOrderId, amountPaid, paymentMethod, paymentAccount, notes } = req.body;

  let payment;

  const session = await Payment.startSession();

  session.startTransaction();

  try {
    const purchaseOrder = await PO.findById(purchaseOrderId).session(session);
    if (!purchaseOrder) return next(new ApiError('Purchase order not found', 404));

    const vendorId = purchaseOrder.vendorId._id;

    if (amountPaid > purchaseOrder.remainingAmount) return next(new ApiError('Amount paid cannot be greater than remaining amount', 400));

    payment = new Payment({
      warehouseId,
      purchaseOrderId,
      vendorId,
      amountPaid,
      type: 'out',
      paymentMethod,
      paymentAccount,
      paymentCategory: 'purchase',
      notes,
      createdBy: req.user.id,
    });

    await payment.save({ session });

    const updatePurchaseOrder = await PO.findById(purchaseOrderId).session(session);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ message: 'Payment created successfully', data: { payment, purchaseOrder: updatePurchaseOrder } });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    next(new ApiError(err.message, 500));
  }
};

exports.createSalesPayment = async (req, res, next) => {
  const { warehouseId, salesOrderId, amountPaid, paymentMethod, paymentAccount, notes } = req.body;

  let payment;

  const session = await Payment.startSession();

  session.startTransaction();

  try {
    const salesOrder = await salesOrderModel.findById(salesOrderId).session(session);
    if (!salesOrder) return next(new ApiError('Sales order not found', 404));

    const customerId = salesOrder.customer._id;

    if (amountPaid > salesOrder.remainingAmount) return next(new ApiError('Amount paid cannot be greater than remaining amount', 400));

    payment = new Payment({
      warehouseId,
      salesOrderId,
      customerId,
      amountPaid,
      type: 'in',
      paymentMethod,
      paymentAccount,
      paymentCategory: 'sales',
      notes,
      createdBy: req.user.id,
    });

    await payment.save({ session });

    const updateSalesOrder = await salesOrderModel.findById(salesOrderId).session(session);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ message: 'Payment created successfully', data: { payment, salesOrder: updateSalesOrder } });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    next(new ApiError(err.message, 500));
  }
};

exports.getAllPayments = factory.getAll(Payment);

exports.getPayment = factory.getOne(Payment);

// exports.updatePayment = factory.updateOne(Payment);

// exports.deletePayment = factory.deleteOne(Payment);

exports.exportPayments = async (req, res) => {
  const asyncHandler = require('express-async-handler');
  const exportToExcel = require('../../utils/exportToExcel');
  const ApiError = require('../../utils/apiError');

  try {
    const { type, paymentCategory, paymentMethod, startDate, endDate } = req.query;

    // Build match stage for aggregation
    let matchStage = {};
    if (type) matchStage.type = type;
    if (paymentCategory) matchStage.paymentCategory = paymentCategory;
    if (paymentMethod) matchStage.paymentMethod = paymentMethod;

    // Add date range filter if provided
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    // Aggregate payment data
    const payments = await Payment.aggregate([
      {
        $match: matchStage,
      },
      {
        $lookup: {
          from: 'warehouses',
          localField: 'warehouseId',
          foreignField: '_id',
          as: 'warehouse',
        },
      },
      {
        $lookup: {
          from: 'vendors',
          localField: 'vendorId',
          foreignField: '_id',
          as: 'vendor',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customer',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: '_id',
          as: 'creator',
        },
      },
      {
        $lookup: {
          from: 'salesorders',
          localField: 'salesOrderId',
          foreignField: '_id',
          as: 'salesOrder',
        },
      },
      {
        $lookup: {
          from: 'purchaseorders',
          localField: 'purchaseOrderId',
          foreignField: '_id',
          as: 'purchaseOrder',
        },
      },
      {
        $addFields: {
          warehouseName: { $arrayElemAt: ['$warehouse.name', 0] },
          vendorName: { $arrayElemAt: ['$vendor.name', 0] },
          customerName: { $arrayElemAt: ['$customer.name', 0] },
          creatorName: { $arrayElemAt: ['$creator.name', 0] },
          salesOrderNumber: {
            $cond: {
              if: { $eq: ['$paymentCategory', 'sales'] },
              then: { $toString: { $arrayElemAt: ['$salesOrder._id', 0] } },
              else: '',
            },
          },
          purchaseOrderNumber: {
            $cond: {
              if: { $eq: ['$paymentCategory', 'purchase'] },
              then: { $toString: { $arrayElemAt: ['$purchaseOrder._id', 0] } },
              else: '',
            },
          },
        },
      },
      {
        $project: {
          _id: 1,
          type: 1,
          amountPaid: 1,
          paymentMethod: 1,
          paymentCategory: 1,
          notes: 1,
          createdAt: 1,
          warehouseName: 1,
          vendorName: 1,
          customerName: 1,
          creatorName: 1,
          salesOrderNumber: 1,
          purchaseOrderNumber: 1,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
    ]);

    if (!payments.length) {
      throw new ApiError('No payment data found', 404);
    }

    // Prepare headers
    const headers = ['Date', 'Type', 'Amount', 'Payment Method', 'Category', 'Order ID', 'Warehouse', 'Vendor/Customer', 'Created By', 'Notes'];

    // Transform data for excel format
    const data = payments.map(payment => {
      // Format the amount to ensure negative numbers display correctly
      let formattedAmount = payment.amountPaid;
      if (payment.type === 'out' && payment.amountPaid > 0) {
        formattedAmount = -payment.amountPaid; // Make expense amounts negative
      }

      return [
        new Date(payment.createdAt).toLocaleString(),
        payment.type === 'in' ? 'Income' : 'Expense',
        formattedAmount,
        payment.paymentMethod,
        payment.paymentCategory,
        payment.paymentCategory === 'sales' ? payment.salesOrderNumber : payment.paymentCategory === 'purchase' ? payment.purchaseOrderNumber : '',
        payment.warehouseName || '',
        payment.vendorName || payment.customerName || '',
        payment.creatorName || '',
        payment.notes || '',
      ];
    });

    // Calculate totals
    const totals = payments.reduce(
      (acc, payment) => {
        if (payment.type === 'in') {
          acc.totalIncome += payment.amountPaid;
        } else {
          // For expenses, make sure we're adding a negative value
          acc.totalExpense += payment.amountPaid > 0 ? -payment.amountPaid : payment.amountPaid;
        }
        return acc;
      },
      { totalIncome: 0, totalExpense: 0 }
    );

    const balance = totals.totalIncome + totals.totalExpense; // Since expenses are negative, we add them

    // Prepare total row
    const totalRow = [
      'Total',
      '',
      `Income: ${totals.totalIncome.toFixed(2)} | Expense: ${totals.totalExpense.toFixed(2)} | Balance: ${balance.toFixed(2)}`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ];

    // Export to Excel
    await exportToExcel(res, 'payments_report.xlsx', headers, data, { totalRow });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      status: 'error',
      message: error.message,
    });
  }
};
