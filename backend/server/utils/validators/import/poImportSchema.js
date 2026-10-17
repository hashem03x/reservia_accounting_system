const Vendor = require('../../../models/vendor/vendor');
const Project = require('../../../models/project/projectModel');
const Product = require('../../../models/inventory/productModel');
const Requisition = require('../../../models/vendor/requisitionModel');

// Purchase Order CSV import schema (docs section "Purchase Order CSV Import"). Row-per-line-item,
// grouped by `POReference` (a CSV-only grouping/idempotency identifier - never the real,
// server-generated `code`, which a client can never supply - see requisitionModel.js's `code`
// field: only ever assigned by its own pre('save') hook when absent). `createGroup` below mirrors
// controller/vendor/requisitionController.js#createRequisition exactly: a single, non-
// transactional, side-effect-free `Requisition.create()` - no accounting call exists anywhere in
// this file, by construction, same guarantee as the real controller.

exports.headers = ['POReference', 'VendorNumber', 'ProjectNumber', 'ItemDescription', 'ProductCode', 'Quantity', 'Unit', 'UnitPrice', 'Notes'];
exports.requiredHeaders = ['POReference', 'VendorNumber', 'ProjectNumber', 'ItemDescription', 'Quantity', 'UnitPrice'];

// Two rows sharing one POReference - demonstrates line-item grouping directly in the template.
exports.exampleRows = [
  ['PO-SAMPLE-0001', '2000', 'PRJ-0000001', 'Steel Rebar 12mm', '', '10', 'ton', '15000', 'Sample purchase order'],
  ['PO-SAMPLE-0001', '2000', 'PRJ-0000001', 'Portland Cement', '', '50', 'bag', '120', 'Sample purchase order'],
];

exports.groupKey = row => (row.POReference || '').trim();

exports.validateGroup = async function validateGroup(rows, context) {
  const errors = [];
  const first = rows[0].raw;
  const reference = (first.POReference || '').trim();

  // Every line of one Purchase Order must agree on its own PO-level fields (docs section
  // "Reject inconsistent PO-level data across rows belonging to the same PO").
  const vendorNumbers = new Set(rows.map(r => (r.raw.VendorNumber || '').trim()));
  const projectNumbers = new Set(rows.map(r => (r.raw.ProjectNumber || '').trim()));
  const notesValues = new Set(rows.map(r => (r.raw.Notes || '').trim()).filter(Boolean));

  if (vendorNumbers.size > 1) {
    errors.push({ column: 'VendorNumber', message: `All lines for PO "${reference}" must share the same VendorNumber (found: ${[...vendorNumbers].join(', ')}).` });
  }
  if (projectNumbers.size > 1) {
    errors.push({ column: 'ProjectNumber', message: `All lines for PO "${reference}" must share the same ProjectNumber (found: ${[...projectNumbers].join(', ')}).` });
  }
  if (notesValues.size > 1) {
    errors.push({ column: 'Notes', message: `All lines for PO "${reference}" should share the same Notes value when provided.` });
  }

  const vendorNumberRaw = (first.VendorNumber || '').trim();
  const projectNumberRaw = (first.ProjectNumber || '').trim();

  let vendor = null;
  if (!vendorNumberRaw) {
    errors.push({ column: 'VendorNumber', message: 'VendorNumber is required.' });
  } else if (Number.isNaN(Number(vendorNumberRaw))) {
    errors.push({ column: 'VendorNumber', value: vendorNumberRaw, message: 'VendorNumber must be a number.' });
  } else {
    vendor = await Vendor.findOne({ vendorNumber: Number(vendorNumberRaw) });
    if (!vendor) errors.push({ column: 'VendorNumber', value: vendorNumberRaw, message: `No vendor found with VendorNumber ${vendorNumberRaw}.`, suggestion: 'Check the vendor list for the correct Vendor Number.' });
  }

  let project = null;
  if (!projectNumberRaw) {
    errors.push({ column: 'ProjectNumber', message: 'ProjectNumber is required.' });
  } else {
    project = await Project.findOne({ projectNumber: projectNumberRaw });
    if (!project) errors.push({ column: 'ProjectNumber', value: projectNumberRaw, message: `No project found with ProjectNumber "${projectNumberRaw}".` });
  }

  if (!reference) {
    errors.push({ column: 'POReference', message: 'POReference is required - it groups this PO\'s line items and prevents importing the same PO twice.' });
  } else {
    const existing = await Requisition.findOne({ importReference: reference }).select('code').lean();
    if (existing) {
      errors.push({ column: 'POReference', value: reference, message: `A Purchase Order with this POReference has already been imported (existing PO code: ${existing.code}).` });
    }
  }

  const items = [];
  for (const r of rows) {
    const description = (r.raw.ItemDescription || '').trim();
    const quantityRaw = (r.raw.Quantity || '').trim();
    const unitPriceRaw = (r.raw.UnitPrice || '').trim();
    const productCode = (r.raw.ProductCode || '').trim();
    const unit = (r.raw.Unit || '').trim();

    if (!description) {
      errors.push({ row: r.row, column: 'ItemDescription', message: 'Item description is required.' });
      continue;
    }
    if (!quantityRaw || Number.isNaN(Number(quantityRaw)) || Number(quantityRaw) <= 0) {
      errors.push({ row: r.row, column: 'Quantity', value: r.raw.Quantity, message: 'Quantity must be a positive number.' });
      continue;
    }
    if (!unitPriceRaw || Number.isNaN(Number(unitPriceRaw)) || Number(unitPriceRaw) < 0) {
      errors.push({ row: r.row, column: 'UnitPrice', value: r.raw.UnitPrice, message: 'Unit price must be a non-negative number.' });
      continue;
    }

    let product = null;
    if (productCode) {
      // eslint-disable-next-line no-await-in-loop
      product = await Product.findOne({ barcode: productCode });
      if (!product) {
        errors.push({ row: r.row, column: 'ProductCode', value: productCode, message: `No product found with barcode "${productCode}".`, suggestion: 'Leave ProductCode blank for a line that isn\'t in the product catalog yet.' });
        continue;
      }
    }

    items.push({ product: product ? product._id : null, description, quantity: Number(quantityRaw), unit: unit || null, unitPrice: Number(unitPriceRaw) });
  }

  if (errors.length > 0) return { errors, value: null };

  return {
    errors,
    value: {
      vendorId: vendor._id,
      project: project._id,
      items,
      notes: [...notesValues][0] || undefined,
      importReference: reference,
    },
  };
};

exports.createGroup = async function createGroup(value, context) {
  return Requisition.create({
    vendorId: value.vendorId,
    project: value.project,
    items: value.items,
    notes: value.notes,
    importReference: value.importReference,
    status: 'draft',
    createdBy: context?.userId,
  });
};
