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
const projectManagerRoute = require('./project/projectManagerRoute');
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
const reversalRoute = require('./accounting/reversalRoute');
const currencyRoute = require('./accounting/currencyRoute');

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
  // Project Managers (admin-managed list for Project.projectManager)
  app.use('/api/v1/project-managers', projectManagerRoute);
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
  // Currency Management master data (multi-currency Journal Entries) - see currencyRoute.js's
  // header comment for why this is a new `currencyManagement` permission resource rather than the
  // pre-existing, unrelated `currencies` one.
  app.use('/api/v1/currencies', currencyRoute);
  // Accounting reversals: returns, payment and settlement reversals (services/accounting/reversalService.js)
  app.use('/api/v1/reversals', reversalRoute);
  // PDF attachments of purchase orders, sales orders and journal entries (services/files/attachmentService.js)
  app.use('/api/v1/attachments', require('./attachmentRoute'));
  app.use('/api/v1/accounting-periods', require('./accounting/accountingPeriodRoute'));
  // Currency Manager - currencies and their rates against the EGP base (services/accounting/currencyService.js)
  app.use('/api/v1/currencies', require('./accounting/currencyRoute'));
  // Parent Account Groups - the managed classifications behind ChartOfAccount.parentGroupNameEn/Ar
  // (services/accounting/accountParentGroupService.js)
  app.use('/api/v1/account-parent-groups', require('./accounting/accountParentGroupRoute'));

  // advanced payments (customer/vendor advances against a project)
  app.use('/api/v1/advanced-payments', require('./payments/advancedPaymentRoute'));
  app.use('/api/v1/shareholders', require('./equity/shareholderRoute'));

  // admin home dashboard (read-only aggregated summary)
  app.use('/api/v1/dashboard', require('./dashboardRoute'));

  // transfer route
  app.use('/api/v1/transfer', transferRoute);
  app.use('/api/v1/puc-transfers', require('./inventory/pucTransferRoute'));

  // po route
  app.use('/api/v1/purchaseOrder', require('./po/poRoute'));

  // Purchase Orders (user-facing name) - the new, purely operational pre-invoice document.
  // Internally named "requisitions" to avoid colliding with the route above, which the UI now
  // calls "Purchase Invoices" (see models/vendor/requisitionModel.js's header comment).
  app.use('/api/v1/requisitions', require('./vendor/requisitionRoute'));

  // Projected Cash Flow Forecasting (read-only Phase 1 - services/cashflow/cashFlowForecastService.js)
  app.use('/api/v1/cash-flow-forecast', require('./cashflow/cashFlowForecastRoute'));

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
  app.use('/api/v1/expense-categories', require('./expenseCategoryRoute'));

  // Reports route
  app.use('/api/v1/reports', require('./reportsRoute'));
  app.use('/api/v1/accounting-reports', require('./accountingReportsRoute'));

  // Database health route
  app.use('/api/v1/bahrain-db-health', bahrianDatabaseHealthRoute);

  // Full database export (ZIP: one JSON file per collection; admin-only)
  app.use('/api/v1/database-export', databaseExportRoute);

  // Automated backup system (tar.gz; admin-only)
  app.use('/api/v1/admin/backup', backupRoutes);

  // Central Business Portal: current-user identity/effective-access, and platform-wide
  // administration (docs section "Central Business Portal").
  app.use('/api/v1/me', require('./portal/portalRoute'));
  app.use('/api/v1/admin/platform', require('./portal/platformAdminRoute'));

  // Reservia CRM (Developer Brief) - leads, pipeline, activity timeline (services/crm/leadService.js).
  app.use('/api/v1/crm/leads', require('./crm/leadRoute'));
  app.use('/api/v1/crm/whatsapp', require('./crm/whatsappRoute'));
  // Public website lead-capture (no auth; its own CORS/rate-limit/honeypot - see the route's own
  // header comment for why this is intentionally separate from the authenticated crm/leads above).
  app.use('/api/v1/crm/public', require('./crm/publicLeadRoute'));
  // Change Request 2, section 4 - the unified, API-key-secured lead intake for every external
  // channel, plus the Meta Lead Ads and Google Ads lead-form webhooks and their admin screen
  // (see routes/crm/integrationRoute.js's own header for each endpoint's authorization).
  app.use('/api/v1/crm/integrations', require('./crm/integrationRoute'));
  // Phase 2 (due 2026-12-10) - quotations (services/crm/quotationService.js).
  app.use('/api/v1/crm/quotations', require('./crm/quotationRoute'));
  // Dashboard + Performance tab (acceptance report sections 4/5) - real, MD-entered targets and
  // ad spend, and the report aggregations that read them back (services/crm/reportService.js).
  app.use('/api/v1/crm/targets', require('./crm/targetRoute'));
  app.use('/api/v1/crm/ad-spend', require('./crm/adSpendRoute'));
  app.use('/api/v1/crm/reports', require('./crm/reportRoute'));
  app.use('/api/v1/crm/team', require('./crm/teamRoute'));
  app.use('/api/v1/crm/attachments', require('./crm/leadAttachmentRoute').byId);

  // Reservia Commercial - engineering estimation, BOQ, pricing and quotation workflow
  // (services/commercial/*). Calculation logic is Excel-sourced (On_Grid.xlsx/Off_Grid.xlsx/
  // Solar_Pumping3.xlsx) - see services/commercial/*Engine.js; the project/revision/approval/
  // proposal workflow is the module's own business rules, same split the implementation plan
  // documents.
  app.use('/api/v1/commercial/materials', require('./commercial/materialRoute'));
  // Deal Engine C18-C24: approved supplier list and supplier price list uploads.
  app.use('/api/v1/commercial/suppliers', require('./commercial/supplierRoute'));
  app.use('/api/v1/commercial/projects', require('./commercial/projectRoute'));
  app.use('/api/v1/commercial/revisions', require('./commercial/revisionRoute'));
  app.use('/api/v1/commercial/approvals', require('./commercial/approvalRoute'));
  app.use('/api/v1/commercial/proposals', require('./commercial/proposalRoute'));
  app.use('/api/v1/commercial/dashboard', require('./commercial/dashboardRoute'));
  // QA finding B3 - the Finance-managed pricing configuration (levers + VAT).
  app.use('/api/v1/commercial/pricing-config', require('./commercial/pricingConfigRoute'));
  // QA finding B5 - CRM -> Commercial handoff (staff-session, CRM-access gated; see the route file).
  app.use('/api/v1/commercial/handoff', require('./commercial/handoffRoute'));
  app.use('/api/v1/commercial/attachments', require('./commercial/projectAttachmentRoute').byId);

  // Website Management (CMS for the public Reservia website, Reservia_Website repo) - Pages,
  // Sections (nested under /website/pages/:pageId/sections - see routes/website/pageRoute.js) and
  // the Media Library. Gated by its own middleware/websiteAccess.js, not the ERP's permission
  // matrix - same pattern as CRM/Commercial above.
  app.use('/api/v1/website/pages', require('./website/pageRoute'));
  app.use('/api/v1/website/media', require('./website/mediaRoute'));
  app.use('/api/v1/website/settings', require('./website/settingsRoute'));
  // Overview, activity log, live-site rebuild, navigation, integrations, custom code (per-route auth).
  app.use('/api/v1/website', require('./website/siteRoute'));
  // Public, read-only, published-content-only feed for the website build (no auth - see the
  // route's own header comment).
  app.use('/api/v1/website/public', require('./website/publicSiteRoute'));

  app.all('/api/v1', (req, res) => {
    res.status(200).json({ message: 'App is running 🚀' });
  });
};

module.exports = mountRoutes;
