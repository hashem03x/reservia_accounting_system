const asyncHandler = require('express-async-handler');
const Product = require('../models/inventory/productModel');

const SO = require('../models/sales/salesOrderModel');
const PO = require('../models/vendor/purchaseOrder');
const Return = require('../models/vendor/purchaseOrderReturn');
const Transfer = require('../models/inventory/transferModel');

const factory = require('./handlersFactory');
const Movement = require('../models/inventory/movementModel');
const ApiError = require('../utils/apiError');
const apiResponse = require('../utils/apiResponse');

// @desc    Create a new movement
// @route   POST /api/v1/movements
// @access  Private
exports.createMovement = asyncHandler(async (req, res, next) => {
  const { product, quantity, fromLocation, toLocation, movementType, createdBy } = req.body;

  // Validate movement type
  if (!['transfer', 'sale', 'return', 'po'].includes(movementType)) {
    return next(new ApiError('Invalid movement type', 400));
  }

  // Validate quantity
  if (quantity <= 0) {
    return next(new ApiError('Quantity must be greater than zero', 400));
  }

  // Validate locations
  if (movementType === 'transfer' && fromLocation === toLocation) {
    return next(new ApiError('From and to locations must be different for transfers', 400));
  }

  // Check stock availability for sale or transfer
  const productData = await Product.findOne({ _id: product, 'stock.warehouse': fromLocation });
  if (!productData || productData.stock.find(s => s.warehouse.toString() === fromLocation).quantity < quantity) {
    return next(new ApiError('Insufficient stock available', 400));
  }

  // Update inventory based on movement type
  if (movementType === 'transfer') {
    // Decrease stock from fromLocation
    await Product.findOneAndUpdate({ _id: product, 'stock.warehouse': fromLocation }, { $inc: { 'stock.$.quantity': -quantity } }, { new: true });

    // Increase stock at toLocation
    await Product.findOneAndUpdate({ _id: product, 'stock.warehouse': toLocation }, { $inc: { 'stock.$.quantity': quantity } }, { new: true, upsert: true });
  } else if (movementType === 'sale') {
    // Decrease stock from fromLocation
    await Product.findOneAndUpdate({ _id: product, 'stock.warehouse': fromLocation }, { $inc: { 'stock.$.quantity': -quantity } }, { new: true });
  } else if (movementType === 'return') {
    // Increase stock at fromLocation
    await Product.findOneAndUpdate({ _id: product, 'stock.warehouse': fromLocation }, { $inc: { 'stock.$.quantity': quantity } }, { new: true });
  }

  const movement = await Movement.create({
    product,
    quantity,
    fromLocation,
    toLocation,
    movementType,
    createdBy,
  });

  res.json(new apiResponse('Movement created successfully', true, movement));
});

// @desc    Get all movements
// @route   GET /api/v1/movements
// @access  Privat
exports.getMovements = asyncHandler(async (req, res) => {
  const { product } = req.query;
  const salesMovements = await SO.find({ 'items.product': product });
  const poMovements = await PO.find({ 'items.productId': product });
  const returnMovements = await Return.find({ productId: product });
  const transferMovements = await Transfer.find({ 'details.product': product });

  res.json(
    apiResponse('Movements fetched successfully', true, {
      salesMovements,
      poMovements,
      returnMovements,
      transferMovements,
    })
  );
});

// @desc    Get a single movement
// @route   GET /api/v1/movements/:id
// @access  Private
exports.getMovement = factory.getOne(Movement);

exports.updateMovement = factory.updateOne(Movement);

exports.deleteMovement = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const movement = await Movement.findByIdAndUpdate(id, { $set: { isDeleted: true } }, { new: true });

  if (!movement) {
    return next(new ApiError('No movement found with that ID', 404));
  }
  res.json(new apiResponse('Movement deleted successfully', true, movement));
});
