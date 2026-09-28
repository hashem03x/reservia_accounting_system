const { getColorCode, isValidColor } = require('./colorMapping');

// Generate a base SKU for a product
const generateSku = (title, index) => {
  // Convert title to uppercase, remove special chars, replace spaces with dashes
  const baseSkuPart = (title || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 6);
  return `PRD${baseSkuPart}${String(index + 1).padStart(3, '0')}`;
};

// Generate a variant SKU based on product SKU, color, and size
const generateVariantSku = (productSku, color, size, variantIndex) => {
  // Convert color and size to uppercase, remove special chars
  const colorCode = (color || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 3);
  const sizeCode = (size || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 2);

  return `${productSku}-${colorCode}${sizeCode}${String(variantIndex + 1).padStart(2, '0')}`;
};

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

// Normalize color name to handle common variations
const normalizeColorName = colorName => {
  if (!colorName) return '';

  const normalized = colorName.toLowerCase().trim();

  // Handle common misspellings and variations
  const colorMappings = {
    baje: 'beige',
    bej: 'beige',
    burgandy: 'burgundy',
    browne: 'brown',
    'navy blue': 'navy',
    'olive green': 'olive',
    'white  ': 'white', // Handle extra spaces
    'black  ': 'black',
    'beige  ': 'beige',
    'blue  ': 'blue',
    'red  ': 'red',
    'green  ': 'green',
    'yellow  ': 'yellow',
    'purple  ': 'purple',
    'pink  ': 'pink',
    'orange  ': 'orange',
    'grey  ': 'grey',
    'gray  ': 'grey',
    'brown  ': 'brown',
  };

  return colorMappings[normalized] || normalized;
};

// Splits a CSV "images" cell (multiple URLs separated by | or ,) into a trimmed, non-empty list,
// preserving the order they were listed in - order matters (see collectProductImages() in
// integration-service, which uses position 0 as the product's featured image).
const parseImageUrls = value => {
  if (!value) return [];
  return String(value)
    .split(/[|,]/)
    .map(url => url.trim())
    .filter(Boolean);
};

const transformFileDataToProductData = fileData => {
  console.log(`Starting transformation of ${fileData.length} rows`);

  // Group by product TITLE, not by the sku column: a real-world CSV puts a UNIQUE sku on every
  // row (one per variant, e.g. TS-WHT-S/TS-WHT-M/...), so grouping by sku used to put every row
  // into its own single-variant "product" - only the first row of each real product ever got
  // through (the rest collided on the schema's unique product title index and were silently
  // dropped in the per-product try/catch in importProductController.js). title.en is what's
  // actually repeated across every row belonging to the same product, so it's the correct group
  // key. Falls back to sku only for the degenerate case of a row with no title at all.
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
    const colorName = normalizeColorName(row['color.name']);
    const size = (row.size || '').trim();
    const barcode = (row.barcode || '').trim() || undefined;
    const imageUrls = parseImageUrls(row.images);

    // Clean numeric values
    const cost = cleanNumericValue(row.cost);
    const price = cleanNumericValue(row.price);
    const priceAfterDiscount = row.priceAfterDiscount ? cleanNumericValue(row.priceAfterDiscount) : null;
    const quantity = cleanNumericValue(row.quantity);

    // Initialize the product group if it doesn't exist. `sku` is intentionally left null here
    // (not derived from any per-row column, which is variant-level data) - it's always assigned
    // from the product title after grouping, below.
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
        season: (row.season || 'all').toLowerCase().trim(),
        category: row.category,
        subcategory: row.subcategory,
        colors: {},
        variants: [],
      };
    }

    // Add color if it doesn't exist and is valid
    if (colorName && !groups[groupKey].colors[colorName]) {
      const isDefault = row['color.isDefault'] === 'TRUE' || row['color.isDefault'] === 'true' || row['color.isDefault'] === true;
      groups[groupKey].colors[colorName] = {
        name: colorName,
        isDefault: isDefault,
        images: [],
      };
    }

    // Merge this row's images into its color, in order, deduped by URL - multiple rows for the
    // same color (e.g. one row per size) can each contribute images without creating duplicates.
    if (colorName && imageUrls.length > 0 && groups[groupKey].colors[colorName]) {
      const color = groups[groupKey].colors[colorName];
      const existingUrls = new Set(color.images.map(img => img.url));
      for (const url of imageUrls) {
        if (existingUrls.has(url)) continue;
        existingUrls.add(url);
        color.images.push({ url, sortOrder: color.images.length });
      }
    } else if (imageUrls.length > 0 && !colorName) {
      console.log(`Row ${index} has images but no valid color - images skipped for this row`, imageUrls);
    }

    // Add variant if color and size are provided
    if (colorName && size) {
      // Generate a variant SKU if not provided
      const variantSku = (row.sku || '').trim() || generateVariantSku(groupKey, colorName, size, groups[groupKey].variants.length);

      groups[groupKey].variants.push({
        sku: variantSku,
        barcode,
        color: colorName,
        size: size,
        quantity: quantity,
        warehouse: (row.warehouse || '').trim() || undefined,
      });
    } else {
      console.log(`Row ${index} is missing color or size - no variant created for this row`, { colorName, size });
    }

    return groups;
  }, {});

  console.log(`Grouped into ${Object.keys(productGroups).length} products`);

  // Convert the groups object to an array and format the colors
  return Object.values(productGroups).map((product, index) => {
    // Product-level SKU is always derived from the title, never reused from a variant/row sku.
    product.sku = generateSku(product.title.en, index);

    // Ensure each variant has a unique SKU
    const variants = product.variants.map((variant, variantIndex) => {
      if (!variant.sku) {
        variant.sku = generateVariantSku(product.sku, variant.color, variant.size, variantIndex);
      }
      return variant;
    });

    // Convert colors object to array and ensure at least one color is default
    const colors = Object.values(product.colors);
    if (colors.length > 0 && !colors.some(color => color.isDefault)) {
      colors[0].isDefault = true;
    }

    return {
      ...product,
      colors: colors,
      variants: variants,
    };
  });
};

module.exports = transformFileDataToProductData;
