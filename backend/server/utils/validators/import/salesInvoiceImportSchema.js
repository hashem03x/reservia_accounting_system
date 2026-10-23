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
  'Notes',
];

exports.requiredHeaders = ['InvoiceReference', 'CustomerNumber', 'ProjectNumber', 'WarehouseName', 'ProductCode', 'Quantity', 'UnitPrice'];

exports.exampleRows = [
  ['SINV-SAMPLE-0001', '1000', 'PRJ-0000001', 'Main Warehouse', '', '2', '5000', '', '', '14', '1', '', '', 'Sample sales invoice'],
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

  // Shipping Cost was removed from Sales Invoices (client requirement "Sales Invoice - Remove Payment
  // Method and Shipping Cost") - no longer in the template. An older file that still carries a value
  // is refused rather than silently dropping an amount; historical invoices keep theirs.
  if (shippingCostRaw) {
    errors.push({ column: 'ShippingCost', value: shippingCostRaw, message: 'Shipping Cost is no longer part of a Sales Invoice - leave it empty or remove the column.' });
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

// Format guide of every column (utils/csvImport/formatGuide.js - downloaded from the import screen as
// a separate file, never mixed into the data template). Kept beside the validation above, and
// test/import/importFormatGuides.test.js fails if these and the real columns ever disagree.
// required: 'yes' (column and value required) | 'no' | 'conditional' (see the description).
exports.fieldSpecs = [
  {
    column: "InvoiceReference",
    required: "yes",
    description: "Your reference for the Sales Invoice - rows with the same reference are the lines of ONE invoice; a reference already imported is refused.",
    format: "Text",
    example: "SINV-SAMPLE-0001"
  },
  {
    column: "CustomerNumber",
    required: "yes",
    description: "Customer Number of an existing customer - the invoice receivable is recorded under this customer.",
    format: "Number",
    example: "1000"
  },
  {
    column: "ProjectNumber",
    required: "yes",
    description: "Project Number of an existing, not cancelled project.",
    format: "Existing project number",
    example: "PRJ-0000001"
  },
  {
    column: "WarehouseName",
    required: "yes",
    description: "Warehouse the goods are issued from.",
    format: "Existing warehouse name",
    example: "Main Warehouse"
  },
  {
    column: "ProductCode",
    required: "yes",
    description: "Barcode of the product/service sold.",
    format: "Existing product barcode",
    example: "123456789012"
  },
  {
    column: "Quantity",
    required: "yes",
    description: "Quantity sold.",
    format: "Whole number > 0",
    example: "2"
  },
  {
    column: "UnitPrice",
    required: "yes",
    description: "Unit price before discount.",
    format: "Number (EGP), up to 2 decimals, no separators or currency symbol, > 0",
    example: "5000"
  },
  {
    column: "ItemDiscountType",
    required: "no",
    description: "Line discount type.",
    format: "percentage or fixed",
    example: "percentage"
  },
  {
    column: "ItemDiscountValue",
    required: "no",
    description: "Line discount (percent or amount, per ItemDiscountType).",
    format: "Number >= 0",
    example: "5"
  },
  {
    column: "VATPercentage",
    required: "no",
    description: "VAT % of the invoice.",
    format: "Number >= 0",
    example: "14"
  },
  {
    column: "WithholdingTaxPercentage",
    required: "no",
    description: "Withholding tax % of the invoice.",
    format: "0, 1, 3 or 5",
    example: "1"
  },
  {
    column: "PaymentMethod",
    required: "no",
    description: "Collect payment when the invoice is created: into a cash/bank account, or from the customer's advance (the project must belong to the customer). Empty = unpaid. (Shipping Cost is no longer part of a Sales Invoice.)",
    format: "account or advanced_payment",
    example: ""
  },
  {
    column: "PaymentAccountCode",
    required: "conditional",
    description: "Chart of Accounts code of the Cash / Cash Equivalent account - required when PaymentMethod is account (only then).",
    format: "Existing cash/bank account code",
    example: "11000001"
  },
  {
    column: "Notes",
    required: "no",
    description: "Invoice notes.",
    format: "Text",
    example: "Sample sales invoice"
  }
];
