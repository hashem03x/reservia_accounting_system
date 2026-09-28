const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const factory = require('../handlersFactory');
const Warehouse = require('../../models/inventory/warehouseModel');
const Payment = require('../../models/vendor/paymentModel');
const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const ApiError = require('../../utils/apiError');
const { uploadSingleFile } = require('../../middleware/uploadImageMiddleware');

// Upload single image
exports.uploadWarehouseImage = uploadSingleFile('image');

// Image Processing
exports.processImage = asyncHandler(async (req, res, next) => {
  if (req.file) {
    const extension = req.file.originalname.split('.').pop();
    const filename = `warehouse-${uuidv4()}-${Date.now()}.${extension}`;
    await sharp(req.file.buffer)
      // .resize(600, 600)
      .toFile(`uploads/warehouses/${filename}`);
    req.body.image = filename;
  } else if (req.body.image === 'null' || req.body.image === null) {
    // Convert string "null" to actual null value
    req.body.image = null;
  }
  next();
});

exports.warehouseHandler = asyncHandler(async (req, res, next) => {
  const { isDefault } = req.body;
  if (isDefault) {
    await Warehouse.updateMany({ $set: { isDefault: false } });
  }
  next();
});

exports.createWarehouse = factory.createOne(Warehouse);

exports.getAllWarehouse = factory.getAll(Warehouse);

exports.getWarehouse = factory.getOne(Warehouse);

exports.updateWarehouse = factory.updateOne(Warehouse);

exports.deleteWarehouse = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const document = await Warehouse.findByIdAndUpdate(id, { $set: { isDeleted: true } }, { new: true });

  if (!document) {
    return next(new ApiError(`No document for this id ${id}`, 404));
  }

  res.status(204).json(apiResponse('Warehouse deleted successfully', true, document));
});

// Update exchange rate for a specific currency across all warehouses
exports.updateExchangeRate = asyncHandler(async (req, res, next) => {
  const { currency, exchangeRate } = req.body;

  if (!['usd', 'eur', 'try', 'cny'].includes(currency)) {
    return next(new ApiError('Invalid currency. Must be one of: usd, eur, try, cny', 400));
  }

  if (exchangeRate <= 0) {
    return next(new ApiError('Exchange rate must be greater than 0', 400));
  }

  const updateQuery = {};
  updateQuery[`${currency}.exchangeRate`] = exchangeRate;

  const documents = await Warehouse.updateMany({ isDeleted: false }, { $set: updateQuery });

  res.status(200).json(apiResponse('Exchange rate updated successfully', true, { modifiedCount: documents.modifiedCount }));
});

// Update currency balance for a specific warehouse
exports.updateCurrencyBalance = asyncHandler(async (req, res, next) => {
  const { warehouseId, currency, amount } = req.body;

  if (!['usd', 'eur', 'try', 'cny'].includes(currency)) {
    return next(new ApiError('Invalid currency. Must be one of: usd, eur, try, cny', 400));
  }

  const warehouse = await Warehouse.findById(warehouseId);
  if (!warehouse) {
    return next(new ApiError(`No warehouse found with id ${warehouseId}`, 404));
  }

  if (!warehouse[currency]) {
    return next(new ApiError(`Currency ${currency} not configured for this warehouse`, 400));
  }

  // Check if there's enough balance in the warehouse
  if (Math.abs(amount) > warehouse.balance) {
    return next(new ApiError(`Insufficient balance in warehouse. Available: ${warehouse.balance} EGP`, 400));
  }

  // Calculate equivalent amount in the target currency
  const equivalentAmount = amount / warehouse[currency].exchangeRate;

  const updateQuery = {
    $inc: {
      [`${currency}.balance`]: equivalentAmount,
      // balance: -amount, // Decrease the warehouse balance by the EGP amount
    },
  };

  const document = await Warehouse.findByIdAndUpdate(warehouseId, updateQuery, { new: true });

  // Create payment record
  await Payment.create({
    warehouseId,
    type: 'out',
    amountPaid: Math.abs(amount),
    paymentMethod: 'cash',
    paymentCategory: 'currency-transfer',
    notes: `${Math.abs(equivalentAmount).toFixed(2)} ${currency.toUpperCase()} (${Math.abs(amount).toFixed(2)} EGP) @ ${warehouse[currency].exchangeRate}`,
    createdBy: req.user._id,
  });

  res.status(200).json(apiResponse('Currency balance updated successfully', true, document));
});

// Convert currency balance to warehouse balance
exports.convertCurrencyToBalance = asyncHandler(async (req, res, next) => {
  const { warehouseId, currency, amount } = req.body;

  // Validate currency
  if (!['usd', 'eur', 'try', 'cny'].includes(currency)) {
    return next(new ApiError('Invalid currency. Must be one of: usd, eur, try, cny', 400));
  }

  // Validate amount
  if (amount <= 0) {
    return next(new ApiError('Amount must be greater than 0', 400));
  }

  // Find warehouse
  const warehouse = await Warehouse.findById(warehouseId);
  if (!warehouse) {
    return next(new ApiError(`No warehouse found with id ${warehouseId}`, 404));
  }

  // Check if warehouse has sufficient currency balance
  if (warehouse[currency].balance < amount) {
    return next(new ApiError(`Insufficient ${currency.toUpperCase()} balance`, 400));
  }

  // Calculate equivalent amount in warehouse currency using exchange rate
  const equivalentAmount = amount * warehouse[currency].exchangeRate;

  // Update warehouse
  const updatedWarehouse = await Warehouse.findByIdAndUpdate(
    warehouseId,
    {
      $inc: {
        [`${currency}.balance`]: -amount, // Decrease currency balance
        // balance: equivalentAmount, // Increase warehouse balance
      },
    },
    { new: true }
  );

  // Create payment record
  await Payment.create({
    warehouseId,
    type: 'in',
    amountPaid: equivalentAmount,
    paymentMethod: 'cash',
    paymentCategory: 'currency-transfer',
    notes: `${amount.toFixed(2)} ${currency.toUpperCase()} → ${equivalentAmount.toFixed(2)} EGP @ ${warehouse[currency].exchangeRate}`,
    createdBy: req.user._id,
  });

  res.status(200).json(apiResponse('Currency converted successfully', true, updatedWarehouse));
});
