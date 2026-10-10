const factory = require('../handlersFactory');

const Vendor = require('../../models/vendor/vendor');
const { createDocumentHandlers } = require('../documentController');
const asyncHandler = require('express-async-handler');
const { vendorFixedAssetAcquisitions } = require('../../services/fixedAssets/fixedAssetPaymentService');
const { vendorExpenses } = require('../../services/expenses/vendorExpenseService');

const { uploadDocument: uploadVendorDocument, deleteDocument: deleteVendorDocument } = createDocumentHandlers(Vendor, 'Vendor');

/**
 * @module
 * @function
 * @name createVendor
 * @description Create a new vendor
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} - New vendor object
 *  @route       delete /api/v1/vendors
 *  @access      Private/Admin/
 */
const createVendor = factory.createOne(Vendor);

/**
 * @module
 * @function
 * @name getAllVendors
 * @description Get all vendors
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} - All vendors
 * @route       GET /api/v1/vendors
 * @access      Private/Admin/
 */

const getAllVendors = factory.getAll(Vendor);

/**
 * @module
 * @function
 * @name getVendor
 * @description Get a vendor by id
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} - Vendor object
 * @route       GET /api/v1/vendors/:id
 * @access      Private/Admin/
 */

const getVendor = factory.getOne(Vendor);

/**
 * @module
 * @function
 * @name updateVendor
 * @description Update a vendor by id
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} - Updated vendor object
 * @route       PUT /api/v1/vendors/:id
 * @access      Private/Admin/
 */

const updateVendor = factory.updateOne(Vendor);

/**
 * @module
 * @function
 * @name deleteVendor
 * @description Delete a vendor by id
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} - Deleted vendor object
 * @route       DELETE /api/v1/vendors/:id
 * @access      Private/Admin/
 */

const deleteVendor = async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);

  if (!vendor) {
    return res.status(404).json({ success: false, message: 'Vendor not found' });
  }

  vendor.isDeleted = true;
  await vendor.save();

  res.status(200).json({ success: true, message: 'Vendor deleted successfully', data: vendor });
};

// GET /vendors/:id/fixed-asset-acquisitions - fixed assets bought from this vendor, with the amount
// owed, paid and outstanding read from the ledger (fixedAssetPaymentService.js).
const getVendorFixedAssetAcquisitions = asyncHandler(async (req, res) => {
  res.status(200).json({ status: 'success', data: await vendorFixedAssetAcquisitions(req.params.id) });
});

// GET /vendors/:id/expenses?from=&to=&status= - the vendor's expenses with paid / outstanding amounts.
const getVendorExpenses = asyncHandler(async (req, res) => {
  const { from, to, status } = req.query;
  res.status(200).json({ status: 'success', data: await vendorExpenses(req.params.id, { from, to, status }) });
});

module.exports = {
  getVendorExpenses,
  getVendorFixedAssetAcquisitions,
  createVendor,
  getAllVendors,
  getVendor,
  updateVendor,
  deleteVendor,
  uploadVendorDocument,
  deleteVendorDocument,
};
