const asyncHandler = require('express-async-handler');
const FixedAsset = require('../models/fixedAssets');
const Payment = require('../models/vendor/paymentModel');
const factory = require('./handlersFactory');

// Get all fixed assets
exports.getFixedAssets = factory.getAll(FixedAsset);

// Create new fixed asset
exports.createFixedAsset = asyncHandler(async (req, res) => {
  const { name, bookValue, fairValue, warehouseId } = req.body;

  // Create the fixed asset
  const fixedAsset = await FixedAsset.create({
    name,
    bookValue,
    fairValue,
    warehouseId,
    createdBy: req.user._id,
  });

  // Create an outgoing payment for the purchase
  await Payment.create({
    warehouseId,
    type: 'out',
    amountPaid: bookValue,
    paymentMethod: 'cash', // You might want to make this configurable
    paymentCategory: 'purchase',
    notes: `Fixed asset purchase: ${name}`,
    createdBy: req.user._id,
  });

  res.status(201).json({
    status: 'success',
    data: fixedAsset,
  });
});

// Update fixed asset
exports.updateFixedAsset = asyncHandler(async (req, res) => {
  const { id } = req.params;
  // const { name, bookValue, fairValue, warehouseId } = req.body;

  const fixedAsset = await FixedAsset.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });

  if (!fixedAsset) {
    res.status(404);
    throw new Error('Fixed asset not found');
  }

  res.status(200).json({
    status: 'success',
    data: fixedAsset,
  });
});

// Sell fixed asset
exports.sellFixedAsset = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const fixedAsset = await FixedAsset.findById(id);

  if (!fixedAsset) {
    res.status(404);
    throw new Error('Fixed asset not found');
  }

  // Create an incoming payment for the sale
  await Payment.create({
    warehouseId: fixedAsset.warehouseId,
    type: 'in',
    amountPaid: fixedAsset.fairValue,
    paymentMethod: 'cash',
    paymentCategory: 'sales',
    notes: `Fixed asset sale: ${fixedAsset.name}`,
    createdBy: req.user._id,
  });

  // Delete the fixed asset
  await FixedAsset.findByIdAndDelete(id);

  res.status(200).json({
    status: 'success',
    message: 'Fixed asset sold and deleted successfully',
  });
});
