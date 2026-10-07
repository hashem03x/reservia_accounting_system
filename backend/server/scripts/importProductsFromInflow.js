const fs = require('fs');
const csv = require('csv-parse');
const mongoose = require('mongoose');
const Product = require('../models/inventory/productModel');
const Variant = require('../models/inventory/variantModel');
const { getColorCode, isValidColor } = require('../utils/colorMapping');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: 'config.env' });

// Connect to MongoDB
mongoose
  .connect(process.env.DB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('Connected to MongoDB...'))
  .catch(err => console.error('Could not connect to MongoDB...', err));

// Clean price values by removing commas and converting to number
const cleanPrice = price => {
  if (!price || price === '-') return 0;
  return Number(price.replace(/,/g, ''));
};

// Clean and validate color
const cleanColor = color => {
  if (!color) return 'black';

  // Convert to lowercase and handle special cases
  color = color.toLowerCase().trim();

  // Special case mappings
  const specialCases = {
    'dark red': 'red',
    mix: 'black',
    'black&brown': 'black',
    'black&orange': 'black',
    navynavyprada: 'navy',
    'gray black': 'black',
    'white black': 'black',
    full: 'black',
    'full cover': 'black',
    'cafe au lait': 'brown',
    coffe: 'brown',
    purpple: 'purple',
    grren: 'green',
    grey: 'gray',
    'off white': 'white',
  };

  // Check special cases first
  const colorKey = color.toLowerCase();
  if (specialCases[colorKey]) {
    return specialCases[colorKey];
  }

  // Handle compound colors (take the first valid color)
  if (color.includes('&') || color.includes(' ')) {
    const parts = color.split(/[& ]+/);
    for (const part of parts) {
      if (isValidColor(part)) {
        return part;
      }
    }
  }

  return isValidColor(color) ? color : 'black';
};

// Group variants by product
const groupVariantsByProduct = records => {
  const productGroups = {};

  records.forEach(record => {
    const productName = record['name eng']?.trim();
    if (!productName) {
      console.warn('Skipping record with no product name:', record);
      return;
    }

    // Initialize product group if not exists
    if (!productGroups[productName]) {
      productGroups[productName] = {
        title: {
          en: record['name eng']?.trim() || '',
          ar: record['name arabic']?.trim() || '',
        },
        description: {
          en: record['des eng']?.trim() || '',
          ar: record['des.arabic']?.trim() || '',
        },
        cost: cleanPrice(record['cost']),
        price: cleanPrice(record['price']),
        category: record['main cat']?.trim(),
        subcategory: record['sub cat']?.trim(),
        variants: [],
      };
    }

    const color = cleanColor(record['colors']);
    if (!isValidColor(color)) {
      console.warn(`Warning: Invalid color "${record['colors']}" found for product "${productName}". Using "black" instead.`);
    }

    // Get variant code from the first column
    const variantCode = Object.values(record)[0]?.trim();
    if (!variantCode) {
      console.warn(`Warning: Missing variant code for product "${productName}"`);
      return;
    }

    // Add variant
    productGroups[productName].variants.push({
      variantCode: variantCode,
      color: color,
      size: record['size']?.trim()?.toUpperCase() || 'ONE SIZE',
      sku: `${variantCode}-${color}-${record['size']}`,
      stock: [
        {
          warehouse: record['Location'],
          quantity: Number(record['Quantity']) || 0,
          starterQuantity: Number(record['Quantity']) || 0,
        },
      ],
    });
  });

  return productGroups;
};

// Process products and variants with transaction support
const processProducts = async productGroups => {
  for (const [productName, productData] of Object.entries(productGroups)) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      console.log(`Processing product: ${productName}`);

      // Check if any variant code already exists
      const variantCodes = productData.variants.map(v => v.variantCode);
      const existingVariants = await Variant.find({
        variantCode: { $in: variantCodes },
      }).session(session);

      if (existingVariants.length > 0) {
        const existingCodes = existingVariants.map(v => v.variantCode);
        console.log(`Skipping product "${productName}" - variant codes already exist: ${existingCodes.join(', ')}`);
        await session.abortTransaction();
        session.endSession();
        continue;
      }

      // Check if product already exists
      const existingProduct = await Product.findOne({
        'title.en': productData.title.en,
        'title.ar': productData.title.ar,
      }).session(session);

      if (existingProduct) {
        console.log(`Skipping duplicate product: ${productName}`);
        await session.abortTransaction();
        session.endSession();
        continue;
      }

      // Validate category and subcategory IDs
      if (!mongoose.Types.ObjectId.isValid(productData.category) || !mongoose.Types.ObjectId.isValid(productData.subcategory)) {
        console.log(`Skipping product "${productName}" due to invalid category/subcategory IDs`);
        await session.abortTransaction();
        session.endSession();
        continue;
      }

      // Create product with proper i18n fields
      const product = new Product({
        title: {
          en: productData.title.en,
          ar: productData.title.ar,
        },
        description: {
          en: productData.description.en,
          ar: productData.description.ar,
        },
        cost: productData.cost,
        price: productData.price,
        category: productData.category,
        subcategory: productData.subcategory,
        colors: [],
        variants: [],
        isAvailable: true,
        isDeleted: false,
        season: 'all',
      });

      // Track unique colors
      const uniqueColors = new Set();

      // Create variants
      for (const variantData of productData.variants) {
        const color = variantData.color;
        uniqueColors.add(color);

        // Ensure variant code is set and valid
        if (!variantData.variantCode) {
          throw new Error(`Missing variant code for product "${productName}" with color=${color}, size=${variantData.size}`);
        }

        // Clean variant code (remove scientific notation)
        const cleanedVariantCode = variantData.variantCode.includes('E+') ? variantData.variantCode.replace('E+', '0'.repeat(12)) : variantData.variantCode;

        const variant = new Variant({
          productId: product._id,
          ...variantData,
          variantCode: cleanedVariantCode,
          sku: `${cleanedVariantCode}-${color}-${variantData.size}`,
        });

        await variant.save({ session });
        product.variants.push(variant._id);
      }

      // Add unique colors to product with their codes
      uniqueColors.forEach(color => {
        product.colors.push({
          name: color,
          code: getColorCode(color),
          isDefault: product.colors.length === 0,
        });
      });

      await product.save({ session });
      await session.commitTransaction();
      console.log(`Successfully imported product: ${productName}`);
    } catch (error) {
      await session.abortTransaction();
      console.error(`Error processing product "${productName}":`, error.message);
    } finally {
      session.endSession();
    }
  }

  console.log('Import process completed!');
};

// Main function to process the CSV file
const processCSV = async () => {
  const csvFilePath = path.join(__dirname, '../../inFlow_Inventory to system (4) (1).csv');

  const parser = fs.createReadStream(csvFilePath).pipe(
    csv.parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    })
  );

  const records = [];
  for await (const record of parser) {
    records.push(record);
  }

  const productGroups = groupVariantsByProduct(records);
  await processProducts(productGroups);

  // Disconnect from MongoDB
  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
};

// Run the import
processCSV().catch(error => {
  console.error('\nScript terminated due to error:', error);
  process.exit(1);
});
