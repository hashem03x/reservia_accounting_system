const factory = require('../handlersFactory');

const Vendor = require('../../models/vendor/vendor');

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

module.exports = {
  createVendor,
  getAllVendors,
  getVendor,
  updateVendor,
  deleteVendor,
};
