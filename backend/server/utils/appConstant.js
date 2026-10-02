// 'paymob-online'/'paymob-offline' and 'shopify-payments' are legacy values from the old
// storefront/Shopify-integration checkout paths (both removed) - kept in the enum only so
// historical payments remain valid/readable. paymentModel.js's pre('save') hook still applies a
// Paymob-specific processing fee to the paymob-* values, which matters for legacy payment records.
exports.PaymentMethods = ['cash', 'wallet', 'instapay', 'band_transfer', 'fawry', 'paymob-online', 'paymob-offline', 'main-bank', 'Banque Misr Deposit', 'shopify-payments'];

// Sales Order's own "how will this order be paid" selection at creation time - a distinct concept
// from the `Payment` model's `paymentMethod` above (a record of an actual payment transaction), so
// it gets its own list rather than polluting PaymentMethods with 'advanced_payment' (which would
// then also become selectable when recording a Purchase Order payment - out of scope, see
// services/payments/advancedPaymentService.js). Spread, not a hardcoded copy, so a future addition
// to PaymentMethods is automatically available here too.
exports.SalesOrderPaymentMethods = [...exports.PaymentMethods, 'advanced_payment'];

exports.expensesCategories = [
  'office-supplies',
  'operating-expenses',
  'management-expenses',
  'travel',
  'salaries',
  'marketing',
  'utilities',
  'rent',
  'dividend',
  'cleaning-and-hosting',
  'others',
  'finance-charges',
];

exports.Resources = {
  categories: 'categories',
  subcategories: 'subcategories',
  products: 'products',
  reports: 'reports',
  cash: 'cash',
  inventories: 'inventories',
  vendors: 'vendors',
  customers: 'customers',
  purchaseOrders: 'purchaseOrders',
  salesOrders: 'salesOrders',
  inventoryTransfers: 'inventoryTransfers',
  expenses: 'expenses',
  users: 'users',
  permissions: 'permissions',
  customization: 'customization',
  coupons: 'coupons',
  transactions: 'transactions',
  governorates: 'governorates',
  warehouses: 'warehouses',
  transfers: 'transfers',
  stock: 'stock',
  variants: 'variants',
  roles: 'roles',
  databaseExport: 'databaseExport',
  projects: 'projects',
  accounts: 'accounts',
  journalEntries: 'journalEntries',
  advancedPayments: 'advancedPayments',
};

exports.Actions = {
  read: 'read',
  create: 'create',
  update: 'update',
  delete: 'delete',
};

exports.adminPermission = [
  { resource: 'categories', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'subcategories', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'products', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'reports', actions: [] },
  { resource: 'cash', actions: [] },
  { resource: 'inventories', actions: ['read'] },
  { resource: 'vendors', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'customers', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'purchaseOrders', actions: ['create', 'read', 'update'] },
  { resource: 'salesOrders', actions: ['create', 'read', 'update'] },
  { resource: 'inventoryTransfers', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'expenses', actions: [] },
  { resource: 'users', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'permissions', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'customization', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'coupons', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'transactions', actions: ['read'] },
  { resource: 'governorates', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'projects', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'accounts', actions: ['create', 'delete', 'read', 'update'] },
  { resource: 'journalEntries', actions: ['create', 'read', 'update'] },
  { resource: 'advancedPayments', actions: ['create', 'delete', 'read', 'update'] },
];

exports.moderatorPermission = [
  { resource: 'vendors', actions: ['create', 'read', 'update'] },
  { resource: 'purchaseOrders', actions: ['create', 'read', 'update'] },
  { resource: 'products', actions: ['create', 'read', 'update'] },
  { resource: 'salesOrders', actions: ['create', 'read', 'update'] },
  { resource: 'customers', actions: ['create', 'read', 'update'] },
  { resource: 'expenses', actions: [] },
  { resource: 'inventories', actions: ['read'] },
  { resource: 'inventoryTransfers', actions: ['create', 'read'] },
  { resource: 'reports', actions: [] },
  { resource: 'cash', actions: [] },
  { resource: 'categories', actions: ['read'] },
  { resource: 'subcategories', actions: ['create', 'read', 'update'] },
  { resource: 'coupons', actions: ['read'] },
  { resource: 'customization', actions: ['read'] },
  { resource: 'governorates', actions: ['read'] },
  { resource: 'transactions', actions: ['read'] },
  { resource: 'users', actions: ['read'] },
  { resource: 'permissions', actions: ['read'] },
  { resource: 'databaseExport', actions: [] },
  { resource: 'projects', actions: ['create', 'read', 'update'] },
  { resource: 'accounts', actions: ['read'] },
  { resource: 'journalEntries', actions: ['create', 'read'] },
  { resource: 'advancedPayments', actions: ['create', 'read', 'update'] },
];

exports.operatorPermission = [
  { resource: 'products', actions: ['read'] },
  { resource: 'transactions', actions: ['read'] },
  { resource: 'purchaseOrders', actions: ['create', 'read', 'update'] },
  { resource: 'salesOrders', actions: ['create', 'read', 'update'] },
  { resource: 'databaseExport', actions: [] },
  { resource: 'projects', actions: ['read'] },
  { resource: 'accounts', actions: ['read'] },
  { resource: 'journalEntries', actions: ['read'] },
  { resource: 'advancedPayments', actions: ['read'] },
];

exports.userPermission = [
  { resource: 'products', actions: ['read'] },
  { resource: 'categories', actions: ['read'] },
  { resource: 'subcategories', actions: ['read'] },
  { resource: 'customization', actions: ['read'] },
  { resource: 'governorates', actions: ['read'] },
  // { resource: "vendors", actions: ["read"] },
  // { resource: "customers", actions: ["read"] },
  // { resource: "purchaseOrders", actions: ["read"] },
  // { resource: "salesOrders", actions: ["read"] },
  // { resource: "expenses", actions: [] },
  // { resource: "inventories", actions: ["read"] },
  // { resource: "inventoryTransfers", actions: ["read"] },
  // { resource: "reports", actions: [] },
  // { resource: "cash", actions: [] },
  // { resource: "coupons", actions: ["read"] },
  // { resource: "transactions", actions: [] },
  // { resource: "users", actions: ["read"] },
  // { resource: "permissions", actions: ["read"] },
];

exports.defaultPermissions = [
  { resource: 'products', actions: ['read'] },
  { resource: 'categories', actions: ['read'] },
  { resource: 'subcategories', actions: ['read'] },
  { resource: 'vendors', actions: ['read'] },
  { resource: 'customers', actions: ['read'] },
  { resource: 'purchaseOrders', actions: ['read'] },
  { resource: 'salesOrders', actions: ['read'] },
  { resource: 'expenses', actions: [] },
  { resource: 'inventories', actions: ['read'] },
  { resource: 'inventoryTransfers', actions: ['read'] },
  { resource: 'reports', actions: [] },
  { resource: 'cash', actions: [] },
  { resource: 'coupons', actions: ['read'] },
  { resource: 'customization', actions: ['read'] },
  { resource: 'governorates', actions: ['read'] },
  { resource: 'transactions', actions: [] },
  { resource: 'users', actions: ['read'] },
  { resource: 'permissions', actions: ['read'] },
];
