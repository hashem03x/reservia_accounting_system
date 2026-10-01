// Clean numeric values from strings (handle commas, spaces, etc.)
const cleanNumericValue = (value) => {
  if (value === undefined || value === null || value === '') return 0;

  // If it's already a number, return it
  if (typeof value === 'number') return value;

  // If it's a string, clean it and convert to number
  if (typeof value === 'string') {
    return parseFloat(value.replace(/,/g, '').trim()) || 0;
  }

  return 0;
};

// Generate a base SKU for a product
const generateSku = (title, index) => {
  // Convert title to uppercase, remove special chars, replace spaces with dashes
  const baseSkuPart = (title || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 6);
  return `PRD${baseSkuPart}${String(index + 1).padStart(3, '0')}`;
};

// Generate a stock-row SKU for a CSV row that doesn't supply its own.
const generateRowSku = (productSku, rowIndex) => `${productSku}-${String(rowIndex + 1).padStart(2, '0')}`;

const transformFileDataToProductData = fileData => {
  console.log(`Starting transformation of ${fileData.length} rows`);

  // Group by product TITLE, not by the sku column: a real-world CSV can put a unique sku on every
  // row (e.g. one row per warehouse batch), so grouping by sku would put every row into its own
  // single-row "product". title.en is what's actually repeated across every row belonging to the
  // same product, so it's the correct group key. Falls back to sku only for the degenerate case of
  // a row with no title at all.
  const productGroups = fileData.reduce((groups, row, index) => {
    const titleEn = (row['title.en'] || '').trim();
    const groupKey = titleEn || (row.sku || '').trim();
    if (!groupKey) {
      console.log(`Row ${index} has no title.en or sku, skipping`);
      return groups;
    }

    // Clean the data
    const titleAr = (row['title.ar'] || '').trim();
    const descEn = (row['description.en'] || '').trim();
    const descAr = (row['description.ar'] || '').trim();
    const barcode = (row.barcode || '').trim() || undefined;

    // Clean numeric values
    const cost = cleanNumericValue(row.cost);
    const price = cleanNumericValue(row.price);
    const priceAfterDiscount = row.priceAfterDiscount ? cleanNumericValue(row.priceAfterDiscount) : null;
    const quantity = cleanNumericValue(row.quantity);

    // Capacity (e.g. "100 kW") is optional - only set it when the CSV actually supplies a value.
    const capacityValueRaw = row['capacity.value'];
    const capacityValue = capacityValueRaw !== undefined && capacityValueRaw !== '' ? cleanNumericValue(capacityValueRaw) : undefined;
    const capacityUnit = (row['capacity.unit'] || '').trim() || undefined;

    // Initialize the product group if it doesn't exist. `sku` is intentionally left null here
    // (not derived from any per-row column) - it's always assigned from the product title after
    // grouping, below.
    if (!groups[groupKey]) {
      groups[groupKey] = {
        sku: null,
        title: {
          en: titleEn,
          ar: titleAr,
        },
        description: {
          en: descEn,
          ar: descAr,
        },
        cost: cost,
        price: price,
        priceAfterDiscount: priceAfterDiscount,
        category: row.category,
        subcategory: row.subcategory,
        ...(capacityValue !== undefined || capacityUnit ? { capacity: { value: capacityValue, unit: capacityUnit } } : {}),
        rows: [],
      };
    }

    // Each CSV row contributes a quantity to a warehouse (multiple rows for the same product can
    // represent different warehouse batches).
    groups[groupKey].rows.push({
      sku: (row.sku || '').trim() || undefined,
      barcode,
      quantity,
      warehouse: (row.warehouse || '').trim() || undefined,
    });

    return groups;
  }, {});

  console.log(`Grouped into ${Object.keys(productGroups).length} products`);

  return Object.values(productGroups).map((product, index) => {
    // Product-level SKU is always derived from the title, never reused from a row's own sku.
    product.sku = generateSku(product.title.en, index);

    // Ensure each row has a SKU for traceability, even though only the aggregated per-warehouse
    // quantity (not the row SKU) ends up on the created product.
    const rows = product.rows.map((row, rowIndex) => ({
      ...row,
      sku: row.sku || generateRowSku(product.sku, rowIndex),
    }));

    return {
      ...product,
      rows,
    };
  });
};

module.exports = transformFileDataToProductData;
