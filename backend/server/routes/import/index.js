const { Router } = require('express');
const importProductRoute = require('./importProductRoute');
const importVendorsRoute = require('./importVendorsRoute');
const importCustomerRoute = require('./importCustomerRoute');
const importPurchaseOrderRoute = require('./importPurchaseOrderRoute');
const importPurchaseInvoiceRoute = require('./importPurchaseInvoiceRoute');
const importSalesInvoiceRoute = require('./importSalesInvoiceRoute');
const importCrmLeadRoute = require('./importCrmLeadRoute');

const router = Router();

router.use('/products', importProductRoute);
router.use('/vendors', importVendorsRoute);
router.use('/customers', importCustomerRoute);
router.use('/purchase-orders', importPurchaseOrderRoute);
router.use('/purchase-invoices', importPurchaseInvoiceRoute);
router.use('/sales-invoices', importSalesInvoiceRoute);
router.use('/crm-leads', importCrmLeadRoute);

module.exports = router;
