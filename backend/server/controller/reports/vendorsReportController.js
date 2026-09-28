const asyncHandler = require('express-async-handler');
const Vendor = require('../../models/vendor/vendor');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// Helper function to get sort configuration
const getSortConfig = (sortBy, sortOrder) => {
	const validSortFields = ['balance', 'totalOrders', 'totalOrdersAmount', 'totalPaidAmount'];
	const order = sortOrder === 'asc' ? 1 : -1;

	if (sortBy && validSortFields.includes(sortBy)) {
		return { [sortBy]: order };
	}
	return { _id: -1 }; // default sort
};

// Aggregate vendor data with purchase order statistics
exports.getVendorReport = asyncHandler(async (req, res) => {
	const { type, sortBy, sortOrder } = req.query;

	let matchStage = {};
	if (type) matchStage.type = type;

	const vendors = await Vendor.aggregate([
		{
			$match: matchStage
		},
		{
			$lookup: {
				from: 'purchaseorders',
				localField: '_id',
				foreignField: 'vendorId',
				as: 'purchaseOrders'
			}
		},
		{
			$addFields: {
				totalOrders: { $size: '$purchaseOrders' },
				totalOrdersAmount: { $sum: '$purchaseOrders.totalAmount' },
				totalPaidAmount: { $sum: '$purchaseOrders.paidAmount' }
			}
		},
		{
			$project: {
				purchaseOrders: 0
			}
		},
		{
			$sort: getSortConfig(sortBy, sortOrder)
		}
	]);

	res.status(200).json({
		status: 'success',
		results: vendors.length,
		data: vendors
	});
});

// =============================================================

// Export vendor report as Excel
exports.exportVendorReportExcel = asyncHandler(async (req, res) => {
	const { type, sortBy, sortOrder } = req.query;

	let matchStage = {};
	if (type) matchStage.type = type;

	const vendors = await Vendor.aggregate([
		{
			$match: matchStage
		},
		{
			$lookup: {
				from: 'purchaseorders',
				localField: '_id',
				foreignField: 'vendorId',
				as: 'purchaseOrders'
			}
		},
		{
			$addFields: {
				totalOrders: { $size: '$purchaseOrders' },
				totalOrdersAmount: { $sum: '$purchaseOrders.totalAmount' },
				totalPaidAmount: { $sum: '$purchaseOrders.paidAmount' }
			}
		},
		{
			$project: {
				_id: 0,
				name: 1,
				'contact.phone': 1,
				'contact.email': 1,
				balance: 1,
				'address.street': 1,
				'address.city': 1,
				'address.postalCode': 1,
				'address.country': 1,
				type: 1,
				totalOrders: 1,
				totalOrdersAmount: 1,
				totalPaidAmount: 1
			}
		},
		{
			$sort: getSortConfig(sortBy, sortOrder)
		}
	]);

	if (!vendors.length) {
		throw new ApiError('No vendor data found', 404);
	}

	// Prepare headers
	const headers = [
		'Name',
		'Phone',
		'Email',
		'Type',
		'Balance',
		'Total Orders',
		'Total Orders Amount',
		'Total Paid Amount',
		'Country',
		'City',
		'Street',
		'Postal Code',
	];

	// Transform data for excel format
	const data = vendors.map(vendor => ([
		vendor.name,
		vendor.contact?.phone || '',
		vendor.contact?.email || '',
		vendor.type,
		vendor.balance || 0,
		vendor.totalOrders,
		vendor.totalOrdersAmount || 0,
		vendor.totalPaidAmount || 0,
		vendor.address?.country || '',
		vendor.address?.city || '',
		vendor.address?.street || '',
		vendor.address?.postalCode || '',
	]));

	// Calculate totals
	const totals = vendors.reduce((acc, vendor) => ({
		balance: (acc.balance || 0) + (vendor.balance || 0),
		totalOrders: (acc.totalOrders || 0) + (vendor.totalOrders || 0),
		totalOrdersAmount: (acc.totalOrdersAmount || 0) + (vendor.totalOrdersAmount || 0),
		totalPaidAmount: (acc.totalPaidAmount || 0) + (vendor.totalPaidAmount || 0)
	}), {});

	// Prepare total row
	const totalRow = [
		'Total',
		'',
		'',
		'',
		totals.balance,
		totals.totalOrders,
		totals.totalOrdersAmount,
		totals.totalPaidAmount,
		'',
		'',
		'',
		''
	];

	// Export to Excel
	await exportToExcel(res, 'vendor_report.xlsx', headers, data, { totalRow });
});
