const Vendor = require('../../../models/vendor/vendor');
const Project = require('../../../models/project/projectModel');
const Warehouse = require('../../../models/inventory/warehouseModel');
const Product = require('../../../models/inventory/productModel');
const Requisition = require('../../../models/vendor/requisitionModel');
const PurchaseOrder = require('../../../models/vendor/purchaseOrder');
const ChartOfAccount = require('../../../models/accounting/chartOfAccountModel');
const { isPaymentAccountEligible } = require('../../accountingConstants');
const { createPO } = require('../../../controller/PO/purchaseOrderController');

// Purchase Invoice CSV import schema (docs section "Purchase Invoice CSV Import"). Row-per-line-
// item, grouped by `InvoiceReference` (a CSV-only grouping/idempotency identifier - never the
// real, server-generated invoice `code`). `createGroup` below calls the REAL `createPO` handler
// (controller/PO/purchaseOrderController.js) through a minimal req/res stub - the exact same
// technique this codebase's own tests already use to exercise it directly
// (test/vendor/requisitionInvoiceLinking.test.js) - so an imported invoice gets the identical
// transaction, stock/cost update, journal entries, and project allocation a UI-created invoice
// gets. This file never posts a journal entry or mutates accounting data itself; it only ever
// delegates to the one controller that already does, exactly once per group.

exports.headers = [
  'InvoiceReference',
  'PONumber',
  'VendorNumber',
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

exports.requiredHeaders = ['InvoiceReference', 'PONumber', 'VendorNumber', 'ProjectNumber', 'WarehouseName', 'ProductCode', 'Quantity', 'UnitPrice'];

exports.exampleRows = [
  ['INV-SAMPLE-0001', 'PO-SAMPLE-0001', '2000', 'PRJ-0000001', 'Main Warehouse', '', '10', '15000', '', '', '14', '1', '', '', 'Sample purchase invoice'],
];

exports.groupKey = row => (row.InvoiceReference || '').trim();

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

exports.validateGroup = async function validateGroup(rows, context) {
  const errors = [];
  const first = rows[0].raw;
  const reference = (first.InvoiceReference || '').trim();

  // Every line of one invoice must agree on its own invoice-level fields (docs section "Reject
  // inconsistent [document]-level data across rows belonging to the same [document]" - the same
  // rule Phase 2 enforces for Purchase Orders, applied here to invoices).
  const fieldsThatMustAgree = ['PONumber', 'VendorNumber', 'ProjectNumber', 'WarehouseName', 'PaymentMethod', 'PaymentAccountCode', 'VATPercentage', 'WithholdingTaxPercentage'];
  for (const field of fieldsThatMustAgree) {
    const values = new Set(rows.map(r => (r.raw[field] || '').trim()).filter(Boolean));
    if (values.size > 1) {
      errors.push({ column: field, message: `All lines for invoice "${reference}" must share the same ${field} (found: ${[...values].join(', ')}).` });
    }
  }

  const poNumberRaw = (first.PONumber || '').trim();
  const vendorNumberRaw = (first.VendorNumber || '').trim();
  const projectNumberRaw = (first.ProjectNumber || '').trim();
  const warehouseNameRaw = (first.WarehouseName || '').trim();
  const paymentMethodRaw = (first.PaymentMethod || '').trim() || null;
  const paymentAccountCodeRaw = (first.PaymentAccountCode || '').trim();
  const vatRaw = (first.VATPercentage || '').trim();
  const withholdingRaw = (first.WithholdingTaxPercentage || '').trim();
  const notesValues = new Set(rows.map(r => (r.raw.Notes || '').trim()).filter(Boolean));

  let vendor = null;
  if (!vendorNumberRaw) {
    errors.push({ column: 'VendorNumber', message: 'VendorNumber is required.' });
  } else if (Number.isNaN(Number(vendorNumberRaw))) {
    errors.push({ column: 'VendorNumber', value: vendorNumberRaw, message: 'VendorNumber must be a number.' });
  } else {
    vendor = await Vendor.findOne({ vendorNumber: Number(vendorNumberRaw) });
    if (!vendor) errors.push({ column: 'VendorNumber', value: vendorNumberRaw, message: `No vendor found with VendorNumber ${vendorNumberRaw}.` });
  }

  let project = null;
  if (!projectNumberRaw) {
    errors.push({ column: 'ProjectNumber', message: 'ProjectNumber is required.' });
  } else {
    project = await Project.findOne({ projectNumber: projectNumberRaw });
    if (!project) errors.push({ column: 'ProjectNumber', value: projectNumberRaw, message: `No project found with ProjectNumber "${projectNumberRaw}".` });
  }

  let warehouse = null;
  if (!warehouseNameRaw) {
    errors.push({ column: 'WarehouseName', message: 'WarehouseName is required.' });
  } else {
    warehouse = await Warehouse.findOne({ name: warehouseNameRaw });
    if (!warehouse) errors.push({ column: 'WarehouseName', value: warehouseNameRaw, message: `No warehouse found named "${warehouseNameRaw}".` });
  }

  // The Purchase Order (Requisition) this invoice must reference - replicates
  // purchaseOrder.js's pre('save') backstop exactly (status, vendor match, project match) so a
  // bad reference is reported clearly here, before anything is created, rather than only at
  // commit time.
  let requisition = null;
  if (!poNumberRaw) {
    errors.push({ column: 'PONumber', message: 'PONumber is required - every Purchase Invoice must reference an eligible Purchase Order.' });
  } else {
    requisition = await Requisition.findOne({ code: poNumberRaw });
    if (!requisition) {
      errors.push({ column: 'PONumber', value: poNumberRaw, message: `No Purchase Order found with PONumber "${poNumberRaw}".` });
    } else {
      if (requisition.status !== 'open') {
        errors.push({ column: 'PONumber', value: poNumberRaw, message: `Purchase Order "${poNumberRaw}" is not open for invoicing (it is a draft or has been cancelled).` });
      }
      if (vendor && String(requisition.vendorId?._id || requisition.vendorId) !== String(vendor._id)) {
        errors.push({ column: 'VendorNumber', message: `VendorNumber ${vendorNumberRaw} does not match Purchase Order "${poNumberRaw}"'s own vendor.` });
      }
      if (project && String(requisition.project?._id || requisition.project) !== String(project._id)) {
        errors.push({ column: 'ProjectNumber', message: `ProjectNumber ${projectNumberRaw} does not match Purchase Order "${poNumberRaw}"'s own project.` });
      }
    }
  }

  if (!reference) {
    errors.push({ column: 'InvoiceReference', message: 'InvoiceReference is required - it groups this invoice\'s line items and prevents importing the same invoice twice.' });
  } else {
    const existingInvoice = await PurchaseOrder.findOne({ importReference: reference }).select('code').lean();
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

  const items = [];
  let groupPreTaxTotal = 0;
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
    if (product.type === 'service' && !product.pucAccount) {
      errors.push({ row: r.row, column: 'ProductCode', value: productCode, message: `Service "${product.title?.en || productCode}" has no PUC account configured - set one before purchasing it.` });
      continue;
    }

    const quantity = Number(quantityRaw);
    const unitPrice = Number(unitPriceRaw);
    const perUnitDiscount = discountType === 'percentage' ? (unitPrice * discountValue) / 100 : discountValue;
    groupPreTaxTotal += round2(quantity * Math.max(0, unitPrice - perUnitDiscount));

    items.push({
      productId: product._id,
      unitPrice,
      itemDiscount: { type: discountType, value: discountValue },
      starterQuantity: quantity,
    });
  }

  // The remaining-balance pre-check (docs section "Invoice quantities and amounts do not exceed
  // the PO's remaining eligible... amounts") - a convenience for a clear error at preview time;
  // the AUTHORITATIVE enforcement is the atomic `$expr`-guarded increment inside purchaseOrder.js's
  // own pre('save') hook, re-checked again at commit regardless of what this says.
  if (requisition && requisition.status === 'open') {
    const remaining = Math.max(0, round2((requisition.amount || 0) - (requisition.invoicedAmount || 0)));
    if (groupPreTaxTotal > remaining) {
      errors.push({
        column: 'PONumber',
        message: `This invoice's pre-tax total (${groupPreTaxTotal}) exceeds Purchase Order "${poNumberRaw}"'s remaining balance (${remaining}).`,
      });
    }
  }

  if (errors.length > 0) return { errors, value: null };

  return {
    errors,
    value: {
      vendorId: vendor._id,
      warehouseId: warehouse._id,
      project: project._id,
      requisition: requisition._id,
      items,
      paymentMethod,
      paymentAccount: paymentAccount ? paymentAccount._id : null,
      vatPercentage,
      withholdingTaxPercentage,
      notes: [...notesValues][0] || undefined,
      importReference: reference,
    },
  };
};

// Calls the REAL createPO handler through a minimal req/res stub - the exact technique this
// codebase's own tests use (test/vendor/requisitionInvoiceLinking.test.js) to exercise it
// directly. Guarantees the imported invoice gets the identical transaction, stock/cost update,
// journal entries, and project allocation a UI-created invoice gets - this file never calls any
// accounting service itself.
exports.createGroup = function createGroup(value, context) {
  return new Promise((resolve, reject) => {
    let responded = false;
    const req = { body: value, user: { _id: context?.userId } };
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        responded = true;
        if (this.statusCode && this.statusCode >= 400) reject(new Error(payload?.message || 'Failed to create Purchase Invoice.'));
        else resolve(payload.data);
      },
    };
    Promise.resolve(
      createPO(req, res, err => {
        if (!responded) reject(err instanceof Error ? err : new Error(err?.message || 'Failed to create Purchase Invoice.'));
      }),
    ).catch(err => {
      if (!responded) reject(err);
    });
  });
};
