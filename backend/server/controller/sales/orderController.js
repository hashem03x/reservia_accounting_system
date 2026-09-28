const orderService = require('../../services/orderService');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

exports.createWebOrder = catchAsync(async (req, res, next) => {
  const order = await orderService.createOrder(req.body, 'website');
  
  res.status(201).json({
    status: 'success',
    data: { order }
  });
});

exports.createPOSOrder = catchAsync(async (req, res, next) => {
  // Add employee ID from authenticated user
  const orderData = {
    ...req.body,
    employee: req.user._id
  };
  
  const order = await orderService.createOrder(orderData, 'pos');
  
  res.status(201).json({
    status: 'success',
    data: { order }
  });
});

exports.updateOrderStatus = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const { status } = req.body;
  
  const order = await orderService.updateOrderStatus(orderId, status, req.user._id);
  
  res.status(200).json({
    status: 'success',
    data: { order }
  });
});

exports.processPayment = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const paymentData = req.body;
  
  const order = await orderService.processPayment(orderId, paymentData);
  
  res.status(200).json({
    status: 'success',
    data: { order }
  });
});

exports.cancelOrder = catchAsync(async (req, res, next) => {
  const { orderId } = req.params;
  const { reason } = req.body;
  
  const order = await orderService.cancelOrder(orderId, reason);
  
  res.status(200).json({
    status: 'success',
    data: { order }
  });
});
