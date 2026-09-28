const asyncHandler = require('express-async-handler');
const Variant = require('../models/inventory/variantModel');

const SO = require('../models/sales/salesOrderModel');
const PO = require('../models/vendor/purchaseOrder');
const Return = require('../models/vendor/purchaseOrderReturn');
const Transfer = require('../models/inventory/transferModel');

const factory = require('./handlersFactory');
const Movement = require('../models/inventory/movementModel');
const ApiError = require('../utils/apiError');
const apiResponse = require('../utils/apiResponse');
const { writeFileAsync } = require('xlsx');

// @desc    Create a new movement
// @route   POST /api/v1/movements
// @access  Private
exports.createMovement = asyncHandler(async (req, res, next) => {
  const { product, variant, quantity, fromLocation, toLocation, movementType, createdBy } = req.body;

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
  const variantData = await Variant.findOne({ _id: variant, 'stock.warehouse': fromLocation });
  if (!variantData || variantData.stock.find(s => s.warehouse.toString() === fromLocation).quantity < quantity) {
    return next(new ApiError('Insufficient stock available', 400));
  }

  // Update inventory based on movement type
  if (movementType === 'transfer') {
    // Decrease stock from fromLocation in Variant
    await Variant.findOneAndUpdate({ _id: variant, 'stock.warehouse': fromLocation }, { $inc: { 'stock.$.quantity': -quantity } }, { new: true });

    // Increase stock at toLocation in Variant
    await Variant.findOneAndUpdate({ _id: variant, 'stock.warehouse': toLocation }, { $inc: { 'stock.$.quantity': quantity } }, { new: true, upsert: true });
  } else if (movementType === 'sale') {
    // Decrease stock from fromLocation in Variant
    await Variant.findOneAndUpdate({ _id: variant, 'stock.warehouse': fromLocation }, { $inc: { 'stock.$.quantity': -quantity } }, { new: true });
  } else if (movementType === 'return') {
    // Increase stock at fromLocation in Variant
    await Variant.findOneAndUpdate({ _id: variant, 'stock.warehouse': fromLocation }, { $inc: { 'stock.$.quantity': quantity } }, { new: true });
  }

  const movement = await Movement.create({
    product,
    variant,
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
  const { variant } = req.query;
  const salesMovements = await SO.find({ 'items.variant': variant });
  const poMovements = await PO.find({ 'items.variant': variant });
  const returnMovements = await Return.find({ 'items.variant': variant });
  const transferMovements = await Transfer.find({ 'details.variant': variant });

  const movements = [...salesMovements, ...poMovements, ...returnMovements, ...transferMovements];
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
