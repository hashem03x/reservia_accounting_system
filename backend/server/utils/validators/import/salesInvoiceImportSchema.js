const User = require('../../../models/userModel');
const Project = require('../../../models/project/projectModel');
const Warehouse = require('../../../models/inventory/warehouseModel');
const Product = require('../../../models/inventory/productModel');
const SalesOrder = require('../../../models/sales/salesOrderModel');
const ChartOfAccount = require('../../../models/accounting/chartOfAccountModel');
const { isPaymentAccountEligible } = require('../../accountingConstants');
const { createSalesOrder } = require('../../../services/sales/salesOrderCreation.service');

// Sales Invoice CSV import schema (docs section "Sales Invoice CSV Import", new - no previous
// importer existed for this document). Row-per-line-item, grouped by `InvoiceReference` (a
// CSV-only grouping/idempotency identifier - never the real, server-generated invoice `code`).
// `createGroup` below calls the REAL `createSalesOrder` service
// (services/sales/salesOrderCreation.service.js) directly - unlike the Purchase Invoice importer,
// this service is a plain async function (not Express-coupled), so no req/res stub is needed. It
// manages its own transaction (stock deduction, Advanced Payment consumption, the SO_CUSTOMER_
// ADVANCE_APPLIED journal entry, and Project.executedPercentage recalculation) end to end - this
// file never duplicates any of that, it only ever calls through to the one service that does it.

exports.headers = [
  'InvoiceReference',
  'CustomerNumber',
  'ProjectNumber',
  'WarehouseName',
  'ProductCode',
  'Quantity',
  'UnitPrice',
  'ItemDiscountType',
  'ItemDiscountValue',
  'VATPercentage',
  'WithholdingTaxPercentage',
  'PaymentMethod',
  'PaymentAccountCode',
  'ShippingCost',
  'Notes',
];

exports.requiredHeaders = ['InvoiceReference', 'CustomerNumber', 'ProjectNumber', 'WarehouseName', 'ProductCode', 'Quantity', 'UnitPrice'];

exports.exampleRows = [
  ['SINV-SAMPLE-0001', '1000', 'PRJ-0000001', 'Main Warehouse', '', '2', '5000', '', '', '14', '1', '', '', '', 'Sample sales invoice'],
];

exports.groupKey = row => (row.InvoiceReference || '').trim();

exports.validateGroup = async function validateGroup(rows, context) {
  const errors = [];
  const first = rows[0].raw;
  const reference = (first.InvoiceReference || '').trim();

  // Every line of one invoice must agree on its own invoice-level fields (same rule Phases 2-3
  // enforce for Purchase Orders/Invoices, applied here to Sales Invoices).
  const fieldsThatMustAgree = ['CustomerNumber', 'ProjectNumber', 'WarehouseName', 'PaymentMethod', 'PaymentAccountCode', 'VATPercentage', 'WithholdingTaxPercentage'];
  for (const field of fieldsThatMustAgree) {
    const values = new Set(rows.map(r => (r.raw[field] || '').trim()).filter(Boolean));
    if (values.size > 1) {
      errors.push({ column: field, message: `All lines for invoice "${reference}" must share the same ${field} (found: ${[...values].join(', ')}).` });
    }
  }

  const customerNumberRaw = (first.CustomerNumber || '').trim();
  const projectNumberRaw = (first.ProjectNumber || '').trim();
  const warehouseNameRaw = (first.WarehouseName || '').trim();
  const paymentMethodRaw = (first.PaymentMethod || '').trim() || null;
  const paymentAccountCodeRaw = (first.PaymentAccountCode || '').trim();
  const vatRaw = (first.VATPercentage || '').trim();
  const withholdingRaw = (first.WithholdingTaxPercentage || '').trim();
  const shippingCostRaw = (first.ShippingCost || '').trim();
  const notesValues = new Set(rows.map(r => (r.raw.Notes || '').trim()).filter(Boolean));

  let customer = null;
  if (!customerNumberRaw) {
    errors.push({ column: 'CustomerNumber', message: 'CustomerNumber is required.' });
  } else if (Number.isNaN(Number(customerNumberRaw))) {
    errors.push({ column: 'CustomerNumber', value: customerNumberRaw, message: 'CustomerNumber must be a number.' });
  } else {
    customer = await User.findOne({ customerNumber: Number(customerNumberRaw), role: 'user' });
    if (!customer) errors.push({ column: 'CustomerNumber', value: customerNumberRaw, message: `No customer found with CustomerNumber ${customerNumberRaw}.` });
  }

  // "Project exists and is eligible" (docs section "Sales Invoice CSV Import") - no project
  // status check exists anywhere on the real Sales Order creation path (confirmed by reading
  // salesOrderModel.js/salesValidator.js/salesOrderCreation.service.js - only existence is
  // checked there), so this importer adds its own explicit eligibility gate rather than
  // inventing a change to the existing Sales Order business rules.
  let project = null;
  if (!projectNumberRaw) {
    errors.push({ column: 'ProjectNumber', message: 'ProjectNumber is required.' });
  } else {
    project = await Project.findOne({ projectNumber: projectNumberRaw });
    if (!project) {
      errors.push({ column: 'ProjectNumber', value: projectNumberRaw, message: `No project found with ProjectNumber "${projectNumberRaw}".` });
    } else if (project.status === 'cancelled') {
      errors.push({ column: 'ProjectNumber', value: projectNumberRaw, message: `Project "${projectNumberRaw}" is cancelled and is not eligible for new Sales Invoices.` });
    }
  }

  let warehouse = null;
  if (!warehouseNameRaw) {
    errors.push({ column: 'WarehouseName', message: 'WarehouseName is required.' });
  } else {
    warehouse = await Warehouse.findOne({ name: warehouseNameRaw });
    if (!warehouse) errors.push({ column: 'WarehouseName', value: warehouseNameRaw, message: `No warehouse found named "${warehouseNameRaw}".` });
  }

  if (!reference) {
    errors.push({ column: 'InvoiceReference', message: 'InvoiceReference is required - it groups this invoice\'s line items and prevents importing the same invoice twice.' });
  } else {
    const existingInvoice = await SalesOrder.findOne({ importReference: reference }).select('code').lean();
    if (existingInvoice) {
      errors.push({ column: 'InvoiceReference', value: reference, message: `An invoice with this InvoiceReference has already been imported (existing invoice code: ${existingInvoice.code}).` });
    }
  }

  let paymentMethod = null;
  if (paymentMethodRaw) {
    if (!['account', 'advanced_payment'].includes(paymentMethodRaw)) {
      errors.push({ column: 'PaymentMethod', value: paymentMethodRaw, message: 'Must be "account" or "advanced_payment".' });
    } else {
      paymentMethod = paymentMethodRaw;
    }
  }

  if (paymentMethod === 'advanced_payment' && project && customer) {
    const projectCustomerId = project.customer?._id || project.customer;
    if (!projectCustomerId || String(projectCustomerId) !== String(customer._id)) {
      errors.push({ column: 'PaymentMethod', message: `Project "${projectNumberRaw}" does not belong to CustomerNumber ${customerNumberRaw}, so Advanced Payment cannot be used.` });
    }
  }

  let paymentAccount = null;
  if (paymentMethod === 'account') {
    if (!paymentAccountCodeRaw) {
      errors.push({ column: 'PaymentAccountCode', message: 'Required when PaymentMethod is "account".' });
    } else {
      paymentAccount = await ChartOfAccount.findOne({ code: paymentAccountCodeRaw });
      if (!paymentAccount) {
        errors.push({ column: 'PaymentAccountCode', value: paymentAccountCodeRaw, message: `No Chart of Accounts entry found with code "${paymentAccountCodeRaw}".` });
      } else if (!isPaymentAccountEligible(paymentAccount)) {
        errors.push({ column: 'PaymentAccountCode', value: paymentAccountCodeRaw, message: 'This account is not a Cash or Cash Equivalent account.' });
      }
    }
  } else if (paymentAccountCodeRaw) {
    errors.push({ column: 'PaymentAccountCode', message: 'PaymentAccountCode can only be set when PaymentMethod is "account".' });
  }

  let vatPercentage = 0;
  if (vatRaw) {
    if (Number.isNaN(Number(vatRaw)) || Number(vatRaw) < 0) errors.push({ column: 'VATPercentage', value: vatRaw, message: 'Must be a non-negative number.' });
    else vatPercentage = Number(vatRaw);
  }
  let withholdingTaxPercentage = 0;
  if (withholdingRaw) {
    if (![0, 1, 3, 5].includes(Number(withholdingRaw))) errors.push({ column: 'WithholdingTaxPercentage', value: withholdingRaw, message: 'Must be one of: 0, 1, 3, 5.' });
    else withholdingTaxPercentage = Number(withholdingRaw);
  }

  let shippingCost;
  if (shippingCostRaw) {
    if (Number.isNaN(Number(shippingCostRaw)) || Number(shippingCostRaw) <= 0) {
      errors.push({ column: 'ShippingCost', value: shippingCostRaw, message: 'Must be a positive number when provided.' });
    } else {
      shippingCost = Number(shippingCostRaw);
    }
  }

  const items = [];
  for (const r of rows) {
    const productCode = (r.raw.ProductCode || '').trim();
    const quantityRaw = (r.raw.Quantity || '').trim();
    const unitPriceRaw = (r.raw.UnitPrice || '').trim();
    const discountType = (r.raw.ItemDiscountType || '').trim() || 'fixed';
    const discountValueRaw = (r.raw.ItemDiscountValue || '').trim();

    if (!productCode) {
      errors.push({ row: r.row, column: 'ProductCode', message: 'ProductCode is required.' });
      continue;
    }
    if (!quantityRaw || Number.isNaN(Number(quantityRaw)) || Number(quantityRaw) <= 0 || !Number.isInteger(Number(quantityRaw))) {
      errors.push({ row: r.row, column: 'Quantity', value: r.raw.Quantity, message: 'Quantity must be a positive whole number.' });
      continue;
    }
    if (!unitPriceRaw || Number.isNaN(Number(unitPriceRaw)) || Number(unitPriceRaw) <= 0) {
      errors.push({ row: r.row, column: 'UnitPrice', value: r.raw.UnitPrice, message: 'Unit price must be a positive number.' });
      continue;
    }
    if (!['percentage', 'fixed'].includes(discountType)) {
      errors.push({ row: r.row, column: 'ItemDiscountType', value: r.raw.ItemDiscountType, message: 'Must be "percentage" or "fixed".' });
      continue;
    }
    const discountValue = discountValueRaw ? Number(discountValueRaw) : 0;
    if (Number.isNaN(discountValue) || discountValue < 0) {
      errors.push({ row: r.row, column: 'ItemDiscountValue', value: r.raw.ItemDiscountValue, message: 'Must be a non-negative number.' });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const product = await Product.findOne({ barcode: productCode });
    if (!product) {
      errors.push({ row: r.row, column: 'ProductCode', value: productCode, message: `No product found with barcode "${productCode}".` });
      continue;
    }

    items.push({
      product: product._id,
      unitPrice: Number(unitPriceRaw),
      itemDiscount: { type: discountType, value: discountValue },
      starterQuantity: Number(quantityRaw),
    });
  }

  if (errors.length > 0) return { errors, value: null };

  return {
    errors,
    value: {
      customer: customer._id,
      warehouse: warehouse._id,
      project: project._id,
      items,
      isPrepaid: false,
      shippingCost,
      paymentMethod,
      paymentAccount: paymentAccount ? paymentAccount._id : null,
      vatPercentage,
      withholdingTaxPercentage,
      notes: [...notesValues][0] || undefined,
      importReference: reference,
    },
  };
};

// Calls the REAL createSalesOrder service directly - unlike the Purchase Invoice importer, this
// service is a plain async function (not an Express handler), so no req/res stub is needed. It
// manages its own transaction end to end (stock, Advanced Payment, journal entries, executed %
// recalculation) - this file never duplicates any of that itself.
exports.createGroup = async function createGroup(value, context) {
  return createSalesOrder({
    customer: value.customer,
    warehouse: value.warehouse,
    items: value.items,
    isPrepaid: value.isPrepaid,
    shippingCost: value.shippingCost,
    paymentMethod: value.paymentMethod || undefined,
    paymentAccount: value.paymentAccount || undefined,
    project: value.project,
    vatPercentage: value.vatPercentage,
    withholdingTaxPercentage: value.withholdingTaxPercentage,
    createdBy: context?.userId,
    employee: context?.userId,
    extraFields: { importReference: value.importReference, notes: value.notes },
  });
};
