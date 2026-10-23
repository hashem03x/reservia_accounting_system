const Product = require('../../../models/inventory/productModel');
const Category = require('../../../models/categoryModel');
const SubCategory = require('../../../models/subCategoryModel');
const Brand = require('../../../models/brandModel');
const Warehouse = require('../../../models/inventory/warehouseModel');
const ChartOfAccount = require('../../../models/accounting/chartOfAccountModel');
const { isPucAccountEligible } = require('../../accountingConstants');

// Product/Service CSV import schema (docs section "Product CSV Import"). Mirrors the EXACT
// fields/rules of the real create path (controller/inventory/productController.js#createProduct =
// factory.createOne(Product) = `Product.create(req.body)`, utils/validators/productValidator.js's
// createProductValidator, utils/productTypeValidation.js#validateProductTypeFields) - replaces the
// previous `importProductAndVariant` controller/validator, which predated the Product/Service split
// entirely (always required category/subcategory, had no `type` column, grouped rows by title into
// a separate "Variant"-era shape with per-row SKUs that no longer matches this model). `createOne`
// below calls `Product.create()` directly (never insertMany), so every real hook still runs:
// the service-can't-have-stock guard, the pucAccount eligibility backstop, and the
// barcode default generator when no barcode is supplied.

exports.headers = [
  'TitleEn',
  'TitleAr',
  'DescriptionEn',
  'DescriptionAr',
  'Type',
  'Price',
  'PriceAfterDiscount',
  'Cost',
  'CategoryName',
  'SubcategoryName',
  'BrandName',
  'Model',
  'Specifications',
  'SKU',
  'Barcode',
  'WarehouseName',
  'Quantity',
  'DurationValue',
  'DurationUnit',
  'PucAccountCode',
  'CapacityValue',
  'CapacityUnit',
  'IsAvailable',
];

exports.requiredHeaders = ['TitleEn', 'TitleAr', 'DescriptionEn', 'DescriptionAr', 'Type'];

// Two example rows - one physical product, one service - so both supported `Type` values and
// which columns apply to each are obvious from the template itself (docs section "Product CSV
// Import" - "clear examples for both physical products and services"). CategoryName/BrandName
// and PucAccountCode are illustrative values, not guaranteed to exist in every tenant's data - the
// same convention the Purchase Order/Invoice sample templates already use for VendorNumber/
// ProjectNumber (a sample row always demonstrates the expected FORMAT; the user supplies real
// values before importing).
exports.exampleRows = [
  [
    'Copper Cable',
    'كابل نحاس',
    'Electrical cable, 10mm, PVC insulated',
    'كابل كهربائي 10 مم معزول بالPVC',
    'product',
    '150',
    '',
    '90',
    'Electrical Materials',
    'Cables',
    'ACME',
    'PX-200',
    'Stainless steel, 2-inch inlet',
    'CAB-001',
    '',
    'Main Warehouse',
    '100',
    '',
    '',
    '',
    '',
    '',
    'true',
  ],
  [
    'Electrical Installation',
    'تركيب كهربائي',
    'On-site electrical installation service',
    'خدمة تركيب كهربائي في الموقع',
    'service',
    '500',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '1',
    'month',
    '11000009',
    '',
    '',
    'true',
  ],
];

// Fetched ONCE before validating any row (not once per row) - preview and commit both call this
// fresh, so a product/barcode created between preview and commit is still correctly caught at
// commit time.
exports.fetchContext = async function fetchContext() {
  const existing = await Product.find({}).select('title barcode').lean();
  return {
    existingTitlesEn: new Set(existing.map(p => (p.title?.en || '').trim().toLowerCase()).filter(Boolean)),
    existingTitlesAr: new Set(existing.map(p => (p.title?.ar || '').trim().toLowerCase()).filter(Boolean)),
    existingBarcodes: new Set(existing.map(p => (p.barcode || '').trim()).filter(Boolean)),
  };
};

function parseBoolean(raw, fallback) {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return fallback;
  if (['true', '1', 'yes'].includes(v)) return true;
  if (['false', '0', 'no'].includes(v)) return false;
  return undefined; // signals "not a valid boolean" to the caller
}

exports.validateRow = async function validateRow(row, { existingTitlesEn, existingTitlesAr, existingBarcodes }) {
  const errors = [];

  const titleEn = (row.TitleEn || '').trim();
  const titleAr = (row.TitleAr || '').trim();
  const descriptionEn = (row.DescriptionEn || '').trim();
  const descriptionAr = (row.DescriptionAr || '').trim();
  const type = (row.Type || '').trim().toLowerCase() || 'product';
  const priceRaw = (row.Price || '').trim();
  const priceAfterDiscountRaw = (row.PriceAfterDiscount || '').trim();
  const costRaw = (row.Cost || '').trim();
  const categoryNameRaw = (row.CategoryName || '').trim();
  const subcategoryNameRaw = (row.SubcategoryName || '').trim();
  const brandNameRaw = (row.BrandName || '').trim();
  const modelRaw = (row.Model || '').trim();
  const specificationsRaw = (row.Specifications || '').trim();
  const sku = (row.SKU || '').trim();
  const barcode = (row.Barcode || '').trim();
  const warehouseNameRaw = (row.WarehouseName || '').trim();
  const quantityRaw = (row.Quantity || '').trim();
  const durationValueRaw = (row.DurationValue || '').trim();
  const durationUnitRaw = (row.DurationUnit || '').trim();
  const pucAccountCodeRaw = (row.PucAccountCode || '').trim();
  const capacityValueRaw = (row.CapacityValue || '').trim();
  const capacityUnitRaw = (row.CapacityUnit || '').trim();

  if (!titleEn) errors.push({ column: 'TitleEn', value: row.TitleEn, message: 'TitleEn is required.' });
  if (!titleAr) errors.push({ column: 'TitleAr', value: row.TitleAr, message: 'TitleAr is required.' });
  if (!descriptionEn) errors.push({ column: 'DescriptionEn', value: row.DescriptionEn, message: 'DescriptionEn is required.' });
  if (!descriptionAr) errors.push({ column: 'DescriptionAr', value: row.DescriptionAr, message: 'DescriptionAr is required.' });

  if (!['product', 'service'].includes(type)) {
    errors.push({ column: 'Type', value: row.Type, message: 'Type must be either "product" or "service".' });
  }

  if (titleEn && existingTitlesEn.has(titleEn.toLowerCase())) {
    errors.push({ column: 'TitleEn', value: row.TitleEn, message: 'A product/service with this English title already exists.' });
  }
  if (titleAr && existingTitlesAr.has(titleAr.toLowerCase())) {
    errors.push({ column: 'TitleAr', value: row.TitleAr, message: 'A product/service with this Arabic title already exists.' });
  }

  // Price is optional (a product/service can be defined before it is priced) - productModel.js#cost.
  let price;
  if (priceRaw) {
    price = Number(priceRaw);
    if (Number.isNaN(price) || price < 0) {
      errors.push({ column: 'Price', value: row.Price, message: 'Price must be a non-negative number.' });
    } else if (price > 250000) {
      errors.push({ column: 'Price', value: row.Price, message: 'Price cannot exceed 250000.' });
    }
  }

  let priceAfterDiscount;
  if (priceAfterDiscountRaw) {
    priceAfterDiscount = Number(priceAfterDiscountRaw);
    if (Number.isNaN(priceAfterDiscount)) {
      errors.push({ column: 'PriceAfterDiscount', value: row.PriceAfterDiscount, message: 'PriceAfterDiscount must be a number.' });
    } else if (price !== undefined && priceAfterDiscount >= price) {
      errors.push({ column: 'PriceAfterDiscount', value: row.PriceAfterDiscount, message: 'PriceAfterDiscount must be lower than Price.' });
    }
  }

  // Capacity - optional for either type, but value/unit must be given together (model shape:
  // { value: Number, unit: String }).
  let capacityValue;
  if (capacityValueRaw) {
    capacityValue = Number(capacityValueRaw);
    if (Number.isNaN(capacityValue) || capacityValue < 0) {
      errors.push({ column: 'CapacityValue', value: row.CapacityValue, message: 'CapacityValue must be a non-negative number.' });
    }
  }
  if (capacityValueRaw && !capacityUnitRaw) {
    errors.push({ column: 'CapacityUnit', value: row.CapacityUnit, message: 'CapacityUnit is required when CapacityValue is given.' });
  }
  if (capacityUnitRaw && !capacityValueRaw) {
    errors.push({ column: 'CapacityValue', value: row.CapacityValue, message: 'CapacityValue is required when CapacityUnit is given.' });
  }

  const isAvailable = parseBoolean(row.IsAvailable, undefined);
  if (isAvailable === undefined && (row.IsAvailable || '').trim()) {
    errors.push({ column: 'IsAvailable', value: row.IsAvailable, message: 'IsAvailable must be "true" or "false".' });
  }

  // Barcode - optional; a Product's own default generator supplies one when left blank, so a
  // blank Barcode is never an error. When supplied, it must look like the real generator's output
  // (digits only, up to 12 - matches the frontend's own barcode input mask) and be unique.
  if (barcode) {
    if (!/^\d{1,12}$/.test(barcode)) {
      errors.push({ column: 'Barcode', value: row.Barcode, message: 'Barcode must contain only digits (up to 12).' });
    } else if (existingBarcodes.has(barcode)) {
      errors.push({ column: 'Barcode', value: row.Barcode, message: 'A product with this barcode already exists.' });
    }
  }

  let category = null;
  let subcategory = null;
  let brand = null;
  let cost;
  let warehouse = null;
  let quantity;

  let durationValue;
  let durationUnit;
  let pucAccount = null;

  if (type === 'service') {
    // A service has no inventory/cost/category concept (productModel.js, productTypeValidation.js)
    // - reject any attempt to smuggle those in via the CSV instead of silently ignoring them.
    if (costRaw) errors.push({ column: 'Cost', value: row.Cost, message: 'Cost does not apply to a service - leave it blank.' });
    // Service classification is pending client confirmation - unchanged: no category for a service.
    if (categoryNameRaw) errors.push({ column: 'CategoryName', value: row.CategoryName, message: 'CategoryName does not apply to a service - leave it blank.' });
    if (subcategoryNameRaw) errors.push({ column: 'SubcategoryName', value: row.SubcategoryName, message: 'SubcategoryName does not apply to a service - leave it blank.' });
    if (brandNameRaw) errors.push({ column: 'BrandName', value: row.BrandName, message: 'BrandName does not apply to a service - leave it blank.' });
    if (modelRaw) errors.push({ column: 'Model', value: row.Model, message: 'Model does not apply to a service - leave it blank.' });
    if (specificationsRaw) errors.push({ column: 'Specifications', value: row.Specifications, message: 'Specifications does not apply to a service - leave it blank.' });
    if (warehouseNameRaw || quantityRaw) {
      errors.push({ column: 'Quantity', value: row.Quantity, message: 'A service cannot have inventory stock - leave WarehouseName/Quantity blank.' });
    }

    if (!durationValueRaw) {
      errors.push({ column: 'DurationValue', value: row.DurationValue, message: 'DurationValue is required for a service.' });
    } else {
      durationValue = Number(durationValueRaw);
      if (Number.isNaN(durationValue) || durationValue <= 0) {
        errors.push({ column: 'DurationValue', value: row.DurationValue, message: 'DurationValue must be a positive number.' });
      }
    }

    durationUnit = durationUnitRaw || 'month';
    if (durationUnit !== 'month') {
      errors.push({ column: 'DurationUnit', value: row.DurationUnit, message: 'DurationUnit must be "month".' });
    }

    if (!pucAccountCodeRaw) {
      errors.push({ column: 'PucAccountCode', value: row.PucAccountCode, message: 'PucAccountCode is required for a service.' });
    } else {
      const account = await ChartOfAccount.findOne({ code: pucAccountCodeRaw });
      if (!account) {
        errors.push({ column: 'PucAccountCode', value: row.PucAccountCode, message: `No Chart of Accounts entry found with code "${pucAccountCodeRaw}".` });
      } else if (!isPucAccountEligible(account)) {
        errors.push({ column: 'PucAccountCode', value: row.PucAccountCode, message: `Account "${account.code} - ${account.name}" is not eligible as a PUC account (must be an active, non-cash asset account).` });
      } else {
        pucAccount = account;
      }
    }
  } else {
    // type === 'product'
    if (durationValueRaw) errors.push({ column: 'DurationValue', value: row.DurationValue, message: 'DurationValue does not apply to a product - leave it blank.' });
    if (pucAccountCodeRaw) errors.push({ column: 'PucAccountCode', value: row.PucAccountCode, message: 'PucAccountCode does not apply to a product - leave it blank.' });

    // Cost is optional (set by the first purchase if left blank) - productModel.js#cost.
    if (costRaw) {
      cost = Number(costRaw);
      if (Number.isNaN(cost) || cost < 0) {
        errors.push({ column: 'Cost', value: row.Cost, message: 'Cost must be a non-negative number.' });
      }
    }

    if (!categoryNameRaw) errors.push({ column: 'CategoryName', value: row.CategoryName, message: 'CategoryName is required for a product.' });

    if (!brandNameRaw) {
      errors.push({ column: 'BrandName', value: row.BrandName, message: 'BrandName is required for a product.' });
    } else {
      brand = await Brand.findOne({ 'name.en': brandNameRaw });
      if (!brand) {
        errors.push({ column: 'BrandName', value: row.BrandName, message: `No brand found named "${brandNameRaw}".` });
      }
    }

    // Stock - optional; WarehouseName and Quantity must be given together (or both left blank for
    // a product with no starting stock yet, same as a manually created product no one has stocked).
    if (warehouseNameRaw && !quantityRaw) {
      errors.push({ column: 'Quantity', value: row.Quantity, message: 'Quantity is required when WarehouseName is given.' });
    } else if (quantityRaw && !warehouseNameRaw) {
      errors.push({ column: 'WarehouseName', value: row.WarehouseName, message: 'WarehouseName is required when Quantity is given.' });
    } else if (warehouseNameRaw && quantityRaw) {
      quantity = Number(quantityRaw);
      if (Number.isNaN(quantity) || quantity < 0) {
        errors.push({ column: 'Quantity', value: row.Quantity, message: 'Quantity must be a non-negative number.' });
      }
      warehouse = await Warehouse.findOne({ name: warehouseNameRaw });
      if (!warehouse) errors.push({ column: 'WarehouseName', value: row.WarehouseName, message: `No warehouse found named "${warehouseNameRaw}".` });
    }
  }

  // Main Category + Subcategory of a product (a service row was refused above if it had them): the
  // Subcategory (optional) must belong to the Main Category.
  if (type !== 'service' && categoryNameRaw) {
    category = await Category.findOne({ 'name.en': categoryNameRaw });
    if (!category) errors.push({ column: 'CategoryName', value: row.CategoryName, message: `No category found named "${categoryNameRaw}".` });
  }
  if (type !== 'service' && subcategoryNameRaw) {
    if (!categoryNameRaw) {
      errors.push({ column: 'SubcategoryName', value: row.SubcategoryName, message: 'SubcategoryName needs a CategoryName.' });
    } else if (category) {
      subcategory = await SubCategory.findOne({ 'name.en': subcategoryNameRaw, mainCategory: category._id });
      if (!subcategory) errors.push({ column: 'SubcategoryName', value: row.SubcategoryName, message: `No subcategory named "${subcategoryNameRaw}" under category "${categoryNameRaw}".` });
    }
  }

  if (errors.length > 0) return { errors, value: null };

  return {
    errors,
    value: {
      type,
      title: { en: titleEn, ar: titleAr },
      description: { en: descriptionEn, ar: descriptionAr },
      ...(price !== undefined ? { price } : {}),
      priceAfterDiscount: priceAfterDiscount ?? null,
      ...(category ? { category: category._id } : {}),
      ...(subcategory ? { subcategory: subcategory._id } : {}),
      isAvailable,
      ...(capacityValue !== undefined ? { capacity: { value: capacityValue, unit: capacityUnitRaw } } : {}),
      sku: sku || undefined,
      barcode: barcode || undefined,
      ...(type === 'service'
        ? {
            durationValue,
            durationUnit,
            pucAccount: pucAccount._id,
          }
        : {
            ...(cost !== undefined ? { cost } : {}),
            brand: brand._id,
            model: modelRaw || undefined,
            specifications: specificationsRaw || undefined,
            stock: warehouse ? [{ warehouse: warehouse._id, quantity }] : [],
          }),
    },
  };
};

exports.dedupeKeys = [
  { column: 'TitleEn', keyFn: row => row.TitleEn },
  { column: 'TitleAr', keyFn: row => row.TitleAr },
  { column: 'Barcode', keyFn: row => row.Barcode },
];

// Mirrors controller/inventory/productController.js#createProduct (= factory.createOne(Product) =
// `Product.create(req.body)`) exactly - a plain create, so every real schema hook (the
// service-can't-have-stock guard, the pucAccount eligibility backstop, the barcode default
// generator) runs identically to a manually created product. Creating a Product has no accounting
// side effects of its own (no journal entries, no automatic accounting action) - confirmed by
// productModel.js having no such hooks - so importing one can never post to the books.
exports.createOne = async function createOne(value, context) {
  return Product.create({ ...value, createdBy: context?.userId });
};

// Format guide of every column (utils/csvImport/formatGuide.js - downloaded from the import screen as
// a separate file, never mixed into the data template). Kept beside the validation above, and
// test/import/importFormatGuides.test.js fails if these and the real columns ever disagree.
// required: 'yes' (column and value required) | 'no' | 'conditional' (see the description).
exports.fieldSpecs = [
  {
    column: "TitleEn",
    required: "yes",
    description: "English name - must be unique.",
    format: "Text",
    example: "Copper Cable"
  },
  {
    column: "TitleAr",
    required: "yes",
    description: "Arabic name - must be unique.",
    format: "Text",
    example: "كابل نحاس"
  },
  {
    column: "DescriptionEn",
    required: "yes",
    description: "English description.",
    format: "Text",
    example: "Electrical cable, 10mm"
  },
  {
    column: "DescriptionAr",
    required: "yes",
    description: "Arabic description.",
    format: "Text",
    example: "كابل كهربائي 10 مم"
  },
  {
    column: "Type",
    required: "yes",
    description: "Physical product or service.",
    format: "product or service",
    example: "product"
  },
  {
    column: "Price",
    required: "no",
    description: "Selling price - optional (a product can be defined before it is priced).",
    format: "Number (EGP), up to 2 decimals, no separators or currency symbol, 0 - 250000",
    example: "150"
  },
  {
    column: "PriceAfterDiscount",
    required: "no",
    description: "Discounted price - must be lower than Price.",
    format: "Number (EGP), up to 2 decimals, no separators or currency symbol",
    example: "140"
  },
  {
    column: "Cost",
    required: "no",
    description: "Products only, optional - if empty, the first purchase sets it. Leave empty for a service.",
    format: "Number (EGP), up to 2 decimals, no separators or currency symbol, >= 0",
    example: "90"
  },
  {
    column: "CategoryName",
    required: "conditional",
    description: "Main Category (English name, must exist) - required for a product; leave empty for a service.",
    format: "Existing category name",
    example: "Electrical Materials"
  },
  {
    column: "SubcategoryName",
    required: "no",
    description: "Subcategory (English name) - products only, must belong to CategoryName.",
    format: "Existing subcategory of that category",
    example: "Cables"
  },
  {
    column: "BrandName",
    required: "conditional",
    description: "Brand (English name, must exist) - required for a product; leave empty for a service.",
    format: "Existing brand name",
    example: "ACME"
  },
  {
    column: "Model",
    required: "no",
    description: "Model / item number - products only.",
    format: "Text",
    example: "PX-200"
  },
  {
    column: "Specifications",
    required: "no",
    description: "Technical specifications - products only.",
    format: "Text",
    example: "10mm, PVC insulated"
  },
  {
    column: "SKU",
    required: "no",
    description: "Stock-keeping code.",
    format: "Text",
    example: "CAB-001"
  },
  {
    column: "Barcode",
    required: "no",
    description: "Barcode (generated when empty) - must be unique.",
    format: "Digits only",
    maxLength: 12,
    example: "123456789012"
  },
  {
    column: "WarehouseName",
    required: "conditional",
    description: "Opening stock warehouse - products only, together with Quantity.",
    format: "Existing warehouse name",
    example: "Main Warehouse"
  },
  {
    column: "Quantity",
    required: "conditional",
    description: "Opening stock quantity - products only, together with WarehouseName.",
    format: "Number, no separators, >= 0",
    example: "100"
  },
  {
    column: "DurationValue",
    required: "conditional",
    description: "Service duration - required for a service; leave empty for a product.",
    format: "Number > 0",
    example: "1"
  },
  {
    column: "DurationUnit",
    required: "no",
    description: "Unit of DurationValue (services only; defaults to month).",
    format: "month",
    example: "month"
  },
  {
    column: "PucAccountCode",
    required: "conditional",
    description: "Chart of Accounts code of the PUC account a purchase of this service posts to - required for a service; leave empty for a product.",
    format: "Existing active, non-cash asset account code",
    example: "11000009"
  },
  {
    column: "CapacityValue",
    required: "conditional",
    description: "Capacity (e.g. 100) - together with CapacityUnit.",
    format: "Number, no separators, >= 0",
    example: "100"
  },
  {
    column: "CapacityUnit",
    required: "conditional",
    description: "Capacity unit (e.g. kW) - together with CapacityValue.",
    format: "Text",
    example: "kW"
  },
  {
    column: "IsAvailable",
    required: "no",
    description: "Whether it can be sold / bought (defaults to true).",
    format: "true or false",
    example: "true"
  }
];
