// Routes
const swaggerUi = require('swagger-ui-express');
const categoryRouter = require('./categoryRoute');
const subCategoryRouter = require('./subCategoryRoute');
const brandRouter = require('./brandRoute');
const productRouter = require('./inventory/productRoute');
const userRouter = require('./userRoute');
const authRouter = require('./authRoute');
const couponRoute = require('./couponRoute');
const governorateRoute = require('./governorateRoute');
const sectorRoute = require('./sectorRoute');
// Site logo + barcode-sticker display settings live on the same document as the old storefront
// "About Us" content (title/socialLinks/homeSubcategories) - those storefront-only fields are no
// longer editable from the (removed) storefront-facing UI, but logo/barcodeSittings are still
// read by the admin app shell (site logo) and the barcode-printing pages, so this route stays.
const aboutUs = require('./aboutUsRoute');
const transactionRoute = require('./transactionRoute');
const analyticsRoute = require('./analyticsRoute');
const roleRouter = require('./roleRoute');
const vendorRouter = require('./user/vendorRoute');
const warehouseRouter = require('./inventory/warehouseRoute');
const transferRoute = require('./inventory/transferRoute');
const fixedAssetRoute = require('./fixedAssetRoute');
const projectRoute = require('./project/projectRoute');
const chartOfAccountRoute = require('./accounting/chartOfAccountRoute');
const journalEntryRoute = require('./accounting/journalEntryRoute');

const bahrianDatabaseHealthRoute = require('./databaseHealth');
const databaseExportRoute = require('./databaseExportRoute');
const backupRoutes = require('../backup/backup.routes');

// const swaggerDocument = require('../../docs/swagger');

const mountRoutes = app => {
  // app.use('/api/v1/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  app.use('/api/v1/categories', categoryRouter);
  app.use('/api/v1/subCategories', subCategoryRouter);
  app.use('/api/v1/brands', brandRouter);
  app.use('/api/v1/products', productRouter);
  app.use('/api/v1/users', userRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/coupons', couponRoute);
  app.use('/api/v1/governorates', governorateRoute);
  app.use('/api/v1/about-us', aboutUs);
  app.use('/api/v1/transactions', transactionRoute);
  app.use('/api/v1/analytics', analyticsRoute);
  // Project Sectors (admin-managed lookup for Project.sector)
  app.use('/api/v1/sectors', sectorRoute);
  // role route
  app.use('/api/v1/role', roleRouter);

  // vendors route
  app.use('/api/v1/vendors', vendorRouter);

  // warehouse route
  app.use('/api/v1/warehouses', warehouseRouter);

  // fixed assets route
  app.use('/api/v1/fixed-assets', fixedAssetRoute);

  // accounting foundation: projects, chart of accounts, journal entries
  app.use('/api/v1/projects', projectRoute);
  app.use('/api/v1/accounts', chartOfAccountRoute);
  app.use('/api/v1/journal-entries', journalEntryRoute);

  // advanced payments (customer/vendor advances against a project)
  app.use('/api/v1/advanced-payments', require('./payments/advancedPaymentRoute'));
  app.use('/api/v1/shareholders', require('./equity/shareholderRoute'));

  // admin home dashboard (read-only aggregated summary)
  app.use('/api/v1/dashboard', require('./dashboardRoute'));

  // transfer route
  app.use('/api/v1/transfer', transferRoute);

  // po route
  app.use('/api/v1/purchaseOrder', require('./po/poRoute'));

  // payment route
  app.use('/api/v1/payment', require('./po/paymentRoute'));

  //file route
  app.use('/api/v1/files', require('./inventory/fileRoute'));
  app.use('/api/v1/import', require('./import/index'));

  // movement route
  app.use('/api/v1/movements', require('./inventory/movementRoute'));

  // sales route
  app.use('/api/v1/sale-orders', require('./sales/salesOrderRoute'));

  // cutomer route
  app.use('/api/v1/customers', require('./user/customerRoute'));

  // expense route
  app.use('/api/v1/expenses', require('./expenseRoutes'));

  // Reports route
  app.use('/api/v1/reports', require('./reportsRoute'));
  app.use('/api/v1/accounting-reports', require('./accountingReportsRoute'));

  // Database health route
  app.use('/api/v1/bahrain-db-health', bahrianDatabaseHealthRoute);

  // Full database export (ZIP: one JSON file per collection; admin-only)
  app.use('/api/v1/database-export', databaseExportRoute);

  // Automated backup system (tar.gz; admin-only)
  app.use('/api/v1/admin/backup', backupRoutes);

  app.all('/api/v1', (req, res) => {
    res.status(200).json({ message: 'App is running 🚀' });
  });
};

module.exports = mountRoutes;
