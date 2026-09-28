const Vendor = require('../../models/vendor/vendor');
const ApiError = require('../../utils/apiError');
const fs = require('fs').promises;

const transformVendorData = vendor => {
  // Transform flat CSV structure to nested object structure
  return {
    type: vendor.type,
    name: vendor.name.replace(/[&.]/g, ''), // Remove special characters from name
    contact: {
      phone: vendor['contact.phone'],
      email: vendor['contact.email'],
    },
    balance: Number(vendor.balance),
    address: {
      street: vendor['address.street'],
      city: vendor['address.city'],
      state: vendor['address.state'],
      country: vendor['address.country'],
      postalCode: vendor['address.postalCode'],
    },
  };
};

exports.importVendors = async (req, res, next) => {
  try {
    console.log('Starting vendor import');
    const vendors = req.fileData.map(transformVendorData);
    console.log('Transformed vendors:', vendors);

    // Create vendors in bulk
    const createdVendors = await Vendor.insertMany(vendors);
    console.log('Created vendors:', createdVendors);

    // Delete the temporary file after processing
    await fs.unlink(req.file.path);

    res.status(201).json({
      status: 'success',
      results: createdVendors.length,
      data: createdVendors,
    });
  } catch (error) {
    console.error('Error importing vendors:', error);
    next(new ApiError(error.message, 400));
  }
};
