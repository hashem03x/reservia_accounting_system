const User = require('../../models/userModel');
const ApiError = require('../../utils/apiError');
const fs = require('fs').promises;
const bcrypt = require('bcryptjs');

const transformCustomerData = async customer => {
  // Transform flat CSV structure to nested object structure
  const userData = {
    name: customer.name,
    phone: customer.phone,
    type: 'offline', // Default to offline
    role: 'user',
    balance: customer.balance ? Number(customer.balance) : 0,
  };

  return userData;
};

exports.importCustomers = async (req, res, next) => {
  try {
    console.log('Starting customer import');
    const customers = await Promise.all(req.fileData.map(transformCustomerData));
    console.log('Transformed customers:', customers);

    // Create customers in bulk
    const createdCustomers = await User.insertMany(customers);
    console.log('Created customers:', createdCustomers);

    // Delete the temporary file after processing
    await fs.unlink(req.file.path);

    res.status(201).json({
      status: 'success',
      results: createdCustomers.length,
      data: createdCustomers,
    });
  } catch (error) {
    console.error('Error importing customers:', error);
    next(new ApiError(error.message, 400));
  }
};
