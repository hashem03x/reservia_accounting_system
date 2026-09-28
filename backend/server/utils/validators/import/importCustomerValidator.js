const User = require('../../../models/userModel');
const ApiError = require('../../apiError');
const parseCsv = require('../../parseCsv');

const validateCustomer = async customer => {
  const errors = [];

  // Validate name
  if (!customer.name) {
    errors.push('Name is required');
  }

  // Validate phone
  if (!customer.phone) {
    errors.push('Phone number is required');
  } else {
    const phoneRegex = /^(\+20|0)?1[0-9]{9}$/;
    if (!phoneRegex.test(customer.phone)) {
      errors.push('Invalid Egyptian phone number format');
    }
  }

  // Validate balance if provided
  if (customer.balance && isNaN(Number(customer.balance))) {
    errors.push('Balance must be a number');
  }

  console.log('Validation errors:', errors);
  return errors;
};

const importCustomerValidator = async (req, res, next) => {
  try {
    console.log('Starting customer validation');
    if (!req.file) {
      console.log('No file uploaded');
      return next(new ApiError('Please upload a CSV file', 400));
    }

    console.log('Parsing CSV file:', req.file.path);
    const fileData = await parseCsv(req.file.path);
    console.log('Parsed CSV data:', fileData);

    if (!fileData || !fileData.length) {
      console.log('CSV file is empty');
      return next(new ApiError('CSV file is empty', 400));
    }

    const validationErrors = [];
    for (let i = 0; i < fileData.length; i++) {
      console.log(`Validating row ${i + 1}`);
      const customer = fileData[i];
      const errors = await validateCustomer(customer);
      if (errors.length > 0) {
        validationErrors.push({ row: i + 1, errors });
      }
    }

    if (validationErrors.length > 0) {
      console.log('Validation errors found:', validationErrors);
      return next(new ApiError('Validation errors in CSV file', 400, validationErrors));
    }

    console.log('Validation successful');
    req.fileData = fileData;
    next();
  } catch (error) {
    console.error('Error in customer validation:', error);
    next(new ApiError(error.message, 400));
  }
};

module.exports = { importCustomerValidator };
