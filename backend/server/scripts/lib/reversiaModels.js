// Explicit registry of every Mongoose model the current (post-Leopard-extraction) Reversia
// backend actually uses, with a one-line purpose for docs/reporting. This is a hand-maintained
// list, not a directory scan, so init/reset scripts can never accidentally pick up a stray or
// dead model file. Four model files exist in server/models/ but are deliberately NOT included
// here, because none of them is require()'d anywhere by the actual running app (routes/
// controllers/services) - all four are pre-existing dead code:
//   - server/models/vendor/invoiceModel.js     - also throws on require(): references a bare
//   - server/models/expense/budgetModel.js       `mongoose` global that was never imported (only
//                                                 `{ Schema, model }` was destructured)
//   - server/models/inventory/colorModel.js    - loads fine, but nothing requires it or `ref`s
//   - server/models/inventory/imageModel.js      'Color'/'Image' - color/image data lives as
//                                                 embedded subdocuments on Product/Variant instead
// Fixing the first two bugs is out of scope here (nothing in the app would exercise the fix), so
// all four are simply excluded rather than silently papered over or turned into collections the
// app never reads from. See docs/database-initialization.md.
//
// Used by both initDb.js (create empty collections + indexes) and resetDb.js (drop + recreate).
const REVERSIA_MODELS = [
  { name: 'Brand', require: () => require('../../models/brandModel'), purpose: 'Product brand taxonomy' },
  { name: 'Category', require: () => require('../../models/categoryModel'), purpose: 'Top-level product category' },
  { name: 'SubCategory', require: () => require('../../models/subCategoryModel'), purpose: 'Product subcategory' },
  { name: 'Coupon', require: () => require('../../models/couponModel'), purpose: 'Sales-order discount coupons' },
  { name: 'Governorate', require: () => require('../../models/governorateModel'), purpose: 'Shipping region / shipping cost' },
  { name: 'Transaction', require: () => require('../../models/transactionModel'), purpose: 'Treasury/cash transactions' },
  { name: 'RoleChangeLog', require: () => require('../../models/roleChangeLogModel'), purpose: 'Audit log of role/permission changes' },
  { name: 'User', require: () => require('../../models/userModel'), purpose: 'Staff/admin accounts' },
  { name: 'Role', require: () => require('../../models/userRoleModel'), purpose: 'RBAC role + permission definitions' },
  { name: 'FixedAsset', require: () => require('../../models/fixedAssets'), purpose: 'Company fixed-assets register' },
  {
    name: 'AboutUsAndSubcategories',
    require: () => require('../../models/customization/aboutUsAndSubcatModel'),
    purpose: 'Site logo + barcode-sticker print settings',
  },
  { name: 'Expense', require: () => require('../../models/expense/expenseModel'), purpose: 'Recorded expenses' },
  { name: 'Movement', require: () => require('../../models/inventory/movementModel'), purpose: 'Inventory movement log' },
  { name: 'Product', require: () => require('../../models/inventory/productModel'), purpose: 'Product catalog' },
  { name: 'Size', require: () => require('../../models/inventory/sizeModel'), purpose: 'Product size taxonomy' },
  { name: 'Transfer', require: () => require('../../models/inventory/transferModel'), purpose: 'Inter-warehouse inventory transfers' },
  { name: 'Warehouse', require: () => require('../../models/inventory/warehouseModel'), purpose: 'Warehouse locations' },
  { name: 'SalesOrder', require: () => require('../../models/sales/salesOrderModel'), purpose: 'Sales orders' },
  { name: 'SalesOrderReturn', require: () => require('../../models/sales/salesOrderReturnModel'), purpose: 'Sales order returns' },
  { name: 'Payment', require: () => require('../../models/vendor/paymentModel'), purpose: 'Vendor/customer payments (treasury ledger)' },
  { name: 'PurchaseOrder', require: () => require('../../models/vendor/purchaseOrder'), purpose: 'Vendor purchase orders' },
  { name: 'PurchaseOrderReturn', require: () => require('../../models/vendor/purchaseOrderReturn'), purpose: 'Purchase order returns' },
  { name: 'Vendor', require: () => require('../../models/vendor/vendor'), purpose: 'Vendor/supplier records' },
  {
    name: 'Counter',
    require: () => require('../../models/config/counterModel'),
    purpose: 'Atomic sequence counters (customer numbers, journal entry numbers) - see docs/entities/customers.md, docs/entities/accounting.md',
  },
  { name: 'ChartOfAccount', require: () => require('../../models/accounting/chartOfAccountModel'), purpose: 'Accounting classification hierarchy (General Accounts / Sub Accounts)' },
  { name: 'JournalEntry', require: () => require('../../models/accounting/journalEntryModel'), purpose: 'Double-entry accounting transactions - source of truth for the General Ledger' },
  { name: 'Project', require: () => require('../../models/project/projectModel'), purpose: 'Contracted projects, with an automatic journal entry on creation' },
];

// Model names that only ever existed in the old Leopard storefront or its Shopify integration -
// both fully removed during the Reversia extraction (see docs/reversia-extraction.md). If a
// collection matching one of these names' Mongoose-computed collection name exists in the target
// database, that database is (or was) a Leopard database, not a fresh Reversia one.
const LEOPARD_MARKER_MODEL_NAMES = [
  'Cart',
  'Review',
  'Slides',
  'HeroSection',
  'OrderDetails',
  'Discount',
  'ShopifyProductMapping',
  'ShopifyCustomerMapping',
  'ShopifyVariantMapping',
  'ShopifyCollectionMapping',
  'ShopifySyncJob',
  'ShopifySyncLog',
  'ShopifyWebhookEvent',
  'ShopifyStoreInitRun',
  'ShopifyProductSyncRun',
  'ShopifyProcessedRefund',
  'ShopifyNightlySyncRun',
];

module.exports = { REVERSIA_MODELS, LEOPARD_MARKER_MODEL_NAMES };
