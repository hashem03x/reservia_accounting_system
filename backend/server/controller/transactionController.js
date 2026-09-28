const factory = require('./handlersFactory');
const ApiError = require('../utils/apiError');
const Transaction = require('../models/transactionModel');
const asyncHandler = require('express-async-handler');
// exports.createTransaction = factory.createOne(Transaction);

exports.getTransactions = factory.getAll(Transaction);

exports.getTransaction = asyncHandler(async (req, res, next) => {
  const transaction = await Transaction.findOne({ transactionId: req.params.id });
  if (!transaction) return next(new ApiError('Transaction not found', 404));
  if (req.user.role !== 'admin' && transaction.userId.toString() !== req.user._id.toString())
    return next(new ApiError('Transaction not found', 404));

  res.status(200).json({ transaction });
});

// exports.updateTransaction = factory.updateOne(Transaction);

// exports.deleteTransaction = factory.deleteOne(Transaction);
