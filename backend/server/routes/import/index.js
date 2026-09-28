const { Router } = require('express');
const importProductRoute = require('./importProductRoute');
const importVendorsRoute = require('./importVendorsRoute');
const importCustomerRoute = require('./importCustomerRoute');
const importPurchaseOrderRoute = require('./importPurchaseOrderRoute');

const router = Router();

router.use('/products', importProductRoute);
router.use('/vendors', importVendorsRoute);
router.use('/customers', importCustomerRoute);
router.use('/purchase-orders', importPurchaseOrderRoute);

module.exports = router;
