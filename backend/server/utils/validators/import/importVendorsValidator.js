const Vendor = require('../../../models/vendor/vendor');
const ApiError = require('../../apiError');
const parseCsv = require('../../parseCsv');

const validateVendor = async vendor => {
  const errors = [];

  // Validate name
  if (!vendor.name) {
    errors.push('Name is required');
  } else if (typeof vendor.name !== 'string') {
    errors.push('Name must be a string');
  }

  // Validate email
  if (!vendor['contact.email']) {
    errors.push('Email is required');
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(vendor['contact.email'])) {
      errors.push('Invalid email format');
    }
  }

  // Validate phone
  if (!vendor['contact.phone']) {
    errors.push('Phone number is required');
  } else {
    const phoneRegex = /^(\+20|0)?1[0-9]{9}$/;
    if (!phoneRegex.test(vendor['contact.phone'])) {
      errors.push('Invalid Egyptian phone number format');
    }
  }

  // Validate type
  if (!vendor.type || !['current', 'equity'].includes(vendor.type)) {
    errors.push('Type must be either "current" or "equity"');
  }

  // Validate balance
  if (vendor.balance && isNaN(Number(vendor.balance))) {
    errors.push('Balance must be a number');
  }

  // Validate address fields
  const requiredAddressFields = ['street', 'city', 'state', 'country'];
  for (const field of requiredAddressFields) {
    if (!vendor[`address.${field}`]) {
      errors.push(`Address ${field} is required`);
    }
  }

  return errors;
};

const importVendorsValidator = async (req, res, next) => {
  try {
    console.log('Starting vendor validation');
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
      const vendor = fileData[i];
      const errors = await validateVendor(vendor);
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
    console.error('Error in vendor validation:', error);
    next(new ApiError(error.message, 400));
  }
};

module.exports = { importVendorsValidator };
