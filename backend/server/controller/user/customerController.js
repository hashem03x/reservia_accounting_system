const asyncHandler = require('express-async-handler');

const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const factory = require('../handlersFactory');
const User = require('../../models/userModel');
const { createDocumentHandlers } = require('../documentController');

const { uploadDocument: uploadCustomerDocument, deleteDocument: deleteCustomerDocument } = createDocumentHandlers(User, 'Customer');
exports.uploadCustomerDocument = uploadCustomerDocument;
exports.deleteCustomerDocument = deleteCustomerDocument;
/**
 *  @description Create offline customer
 *  @route       POST /api/v1/users/offline
 *  @access      Private/Admin
 */
exports.createCustomer = asyncHandler(async (req, res, next) => {
  // Check if customer exists with phone
  const { phone, additionalPhone, email } = req.body.contact;

  const existingCustomer = await User.findOne({ phone });

  if (existingCustomer) {
    return next(new ApiError(`Customer with phone  already exists`, 400));
  }

  // Create offline customer
  const customer = await User.create({
    name: req.body.name,
    phone,
    additionalPhone,
    email: email || undefined,
    offlineAddress: req.body.offlineAddress,
    taxInfo: req.body.taxInfo,
    bankInfo: req.body.bankInfo,
    role: 'user',
    isOffline: true,
    type: 'offline',
    // customerNumber is deliberately NOT taken from req.body - it is always server-generated
    // (see userModel.js's pre('save') hook + customerNumberService.js), so a client can never
    // set or influence it by sending the field in the request body.
  });

  res.json(apiResponse('Offline customer created successfully', true, customer));
});

/**
 *  @description Update offline customer
 *  @route       PATCH /api/v1/users/offline/:id
 *  @access      Private/Admin
 */
exports.updateCustomer = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, offlineAddress, contact, balance } = req.body;

  let phone, email;
  if (contact) {
    phone = contact.phone;
    additionalPhone = contact.additionalPhone;
    email = contact.email;
  }

  // Check if customer exists with phone
  const existingCustomer = await User.findById(id);
  if (!existingCustomer) {
    return next(new ApiError(`Customer not  exists`, 400));
  }

  if (offlineAddress) {
    const { street, city, state, postalCode } = offlineAddress;

    if (street) existingCustomer.offlineAddress.street = street;
    if (city) existingCustomer.offlineAddress.city = city;
    if (state) existingCustomer.offlineAddress.state = state;
    if (postalCode) existingCustomer.offlineAddress.postalCode = postalCode;
  }

  // Field-by-field merge (not a wholesale `existingCustomer.taxInfo = req.body.taxInfo`
  // replacement) so updating one bank/tax field from the edit form never wipes a sibling field
  // that simply wasn't included in this particular request body.
  if (req.body.taxInfo) {
    existingCustomer.taxInfo = { ...(existingCustomer.taxInfo?.toObject() || {}), ...req.body.taxInfo };
  }
  if (req.body.bankInfo) {
    existingCustomer.bankInfo = { ...(existingCustomer.bankInfo?.toObject() || {}), ...req.body.bankInfo };
  }

  if (phone) existingCustomer.phone = phone;
  if (additionalPhone) existingCustomer.additionalPhone = additionalPhone;
  if (email) existingCustomer.email = email;
  if (name) existingCustomer.name = name;
  if (balance !== undefined) existingCustomer.balance = balance;

  // existingCustomer.name = req.body.name || existingCustomer.name;
  // existingCustomer.phone = phone || existingCustomer.phone;
  // existingCustomer.email = email || existingCustomer.email;
  // existingCustomer.offlineAddress = existingCustomer.offlineAddress;

  await existingCustomer.save();

  res.json(apiResponse('Offline customer updated successfully', true, existingCustomer));
  // Update offline customer
});
// exports.updateCustomer = asyncHandler(
//   async (req, res, next) => {
//   const { id } = req.params;

//   // Check if customer exists with phone
//   const existingCustomer = await User.findOne({ phone: req.body.phone });
//   if (!existingCustomer && !(existingCustomer._id.toString() !== id)) {
//     return next(new ApiError(`Customer with phone ${req.body.phone} not  exists`, 400));
//   }

//   // Update offline customer
//   const customer = await User.findByIdAndUpdate(
//     id,
//     {
//       $set: {
//         name: req.body.name || existingCustomer.name,
//         phone: req.body.phone || existingCustomer.phone,
//         offlineAddress: req.body.offlineAddress || existingCustomer.offlineAddress,
//       },
//     },
//     { new: true }
//   );

//   if (!customer) {
//     return next(new ApiError('No customer found with that ID', 404));
//   }

//   res.json(
//    apiResponse(
//     'Offline customer updated successfully',
//     true,
//     customer
//   ));
// });

/**
 * @description Get all customers
 * @route       GET /api/v1/customers
 * @access      Private/Admin
 * */
exports.getAllCustomers = factory.getAll(User);

/**
 * @description Get customer by ID
 * @route       GET /api/v1/customers/:id
 * @access      Private/Admin
 * */
exports.getCustomerById = factory.getOne(User);

/**
 *  @description Combine online and offline customers
 *  @route       POST /api/v1/users/combine
 *  @access      Private/Admin
 */
exports.combineCustomers = asyncHandler(async (req, res) => {
  const { onlineCustomerId, offlineCustomerId } = req.body;

  // Get both customers
  const onlineCustomer = await User.findById(onlineCustomerId);
  const offlineCustomer = await User.findById(offlineCustomerId);

  if (!onlineCustomer || !offlineCustomer) {
    return res.status(404).json({
      status: 'error',
      message: 'One or both customers not found',
    });
  }

  // Merge customer data
  onlineCustomer.mandoraAddress = offlineCustomer.mandoraAddress;
  if (!onlineCustomer.phone) onlineCustomer.phone = offlineCustomer.phone;

  // Save merged customer
  await onlineCustomer.save();

  // Mark offline customer as merged
  offlineCustomer.isMerged = true;
  offlineCustomer.mergedWith = onlineCustomer._id;
  await offlineCustomer.save();

  res.status(200).json({
    status: 'success',
    data: onlineCustomer,
  });
});

/**
 *  @description Search customers
 *  @route       GET /api/v1/users/search
 *  @access      Private/Admin
 */
exports.searchCustomers = asyncHandler(async (req, res) => {
  const { query } = req.query;

  const customers = await User.find({
    $or: [
      { name: { $regex: query, $options: 'i' } },
      { phone: { $regex: query, $options: 'i' } },
      { email: { $regex: query, $options: 'i' } },
      { mandoraAddress: { $regex: query, $options: 'i' } },
    ],
  });

  res.status(200).json({
    status: 'success',
    results: customers.length,
    data: customers,
  });
});

exports.deleteCustomer = asyncHandler(async (req, res, next) => {
  const customer = await User.findByIdAndUpdate(req.params.id, { $set: { isDeleted: true } }, { new: true });
  if (!customer) {
    return next(new ApiError('No customer found with that ID', 404));
  }
  res.json(apiResponse('Customer deleted successfully', true, customer));
});
