const fs = require('fs');
const csv = require('csv-parse');
const mongoose = require('mongoose');
const Product = require('../models/inventory/productModel');
const Variant = require('../models/inventory/variantModel');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: 'config.env' });

// Connect to MongoDB
mongoose
  .connect(process.env.DB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('Connected to MongoDB...'))
  .catch(err => console.error('Could not connect to MongoDB...', err));

// Function to read and parse CSV file
const readCSV = async () => {
  const csvFilePath = path.join(__dirname, '../../inFlow_Inventory to system (4) (1).csv');
  const csvData = [];
  const parser = fs
    .createReadStream(csvFilePath)
    .pipe(csv.parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true // Handle BOM character
    }));

  for await (const record of parser) {
    csvData.push(record);
  }

  return csvData;
};

// Function to normalize size
const normalizeSize = (size) => {
  if (!size) return null;
  return size.trim().toUpperCase();
};

// Function to update a single record with its own transaction
async function updateSingleRecord(record) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const variantCode = Object.values(record)[0]?.trim();
    const productNameEn = record['name eng']?.trim();
    const color = record['colors']?.trim().toLowerCase();
    const size = normalizeSize(record['size']);

    if (!variantCode || !productNameEn) {
      console.error(`Missing variant code or product name in record:`, record);
      return;
    }

    console.log(`Processing: Code=${variantCode}, Name=${productNameEn}, Color=${color}, Size=${size}`);

    // Find the product
    const product = await Product.findOne({
      'title.en': { $regex: new RegExp('^' + productNameEn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
    }).session(session);

    if (!product) {
      console.error(`Product not found: "${productNameEn}"`);
      return;
    }

    // Find the variant with case-insensitive matching
    const variant = await Variant.findOne({
      product: product._id,
      ...(color && { color: { $regex: new RegExp('^' + color + '$', 'i') } }),
      ...(size && { size: { $regex: new RegExp('^' + size + '$', 'i') } })
    }).session(session);

    if (!variant) {
      console.error(`Variant not found for product "${productNameEn}" with color=${color}, size=${size}`);
      return;
    }

    // Update variant code
    variant.variantCode = variantCode;

    // Save the updated variant
    await variant.save({ session });
    await session.commitTransaction();
    console.log(`Updated variant code ${variantCode} for ${productNameEn} (${color}, ${size})`);
  } catch (error) {
    console.error(`Error updating record:`, error);
    await session.abortTransaction();
  } finally {
    session.endSession();
  }
}

// Main function to update variant codes
async function updateVariantCodes() {
  try {
    // Read the CSV file
    const csvData = await readCSV();
    console.log(`Read ${csvData.length} records from CSV`);
    console.log('First record for debugging:', csvData[0]);

    // Process each record with its own transaction
    for (const record of csvData) {
      await updateSingleRecord(record);
    }

    console.log('Successfully completed all updates');
  } catch (error) {
    console.error('Script error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the script
updateVariantCodes().catch(error => {
  console.error('\nScript terminated due to error:', error);
  process.exit(1);
});
