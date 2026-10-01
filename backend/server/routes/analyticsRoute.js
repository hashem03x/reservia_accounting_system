const express = require('express');
const {
  getSalesOverview,
  getTopSellingProducts,
  getRevenueByCategory,
  getCustomerInsights,
  getInventoryStatus,
  getSalesByTimePeriod,
  getProductPerformance,
  getWarehousesBalance,
  getUserAcquisitionAndRetention,
  getOrderStatistics,
  getBestSellingGovernorates,
  getSalesByCategory,
  getSalesBySubCategory,
  getProductAvailabilityAnalysis,
} = require('../controller/analyticsController');

const authController = require('../controller/user/authController');

const router = express.Router();

router.use(authController.protect, authController.allowedTo('admin'));

router.get('/sales-overview', getSalesOverview);
router.get('/top-selling-products', getTopSellingProducts);
router.get('/revenue-by-category', getRevenueByCategory);
router.get('/customer-insights', getCustomerInsights);
router.get('/inventory-status', getInventoryStatus);

router.get('/sales-by-time-period', getSalesByTimePeriod);
router.get('/product-performance', getProductPerformance);
router.get('/user-acquisition-retention', getUserAcquisitionAndRetention);
router.get('/order-statistics', getOrderStatistics);

router.get('/best-selling-governorates', getBestSellingGovernorates);
router.get('/sales-by-category', getSalesByCategory);
router.get('/sales-by-sub-category', getSalesBySubCategory);

router.get('/product-availability', getProductAvailabilityAnalysis);
router.get('/warehouses-balance', getWarehousesBalance);

module.exports = router;
