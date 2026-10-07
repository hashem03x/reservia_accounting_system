const mongoose = require('mongoose');
const fs = require('fs');
const csv = require('csv-parse/sync');

// Import models
const Variant = require('./server/models/inventory/variantModel');
const Warehouse = require('./server/models/inventory/warehouseModel');
const Vendor = require('./server/models/vendor/vendor');

// Function to parse CSV
const parseCsv = filePath => {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  // Remove BOM if present
  const cleanContent = fileContent.charCodeAt(0) === 0xfeff ? fileContent.slice(1) : fileContent;

  return csv.parse(cleanContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  });
};

// Main function
async function checkVariants() {
  try {
    // Connect to MongoDB
    console.log('Connecting to database...');
    await mongoose.connect('mongodb://localhost:27017/reversia-accounting');
    console.log('Connected to database');

    // Parse CSV file
    console.log('Parsing CSV file...');
    const csvData = parseCsv('./test_purchase_order.csv');
    console.log(`Found ${csvData.length} rows in CSV`);

    // Extract variant codes
    const variantCodes = csvData.map(row => row.variantCode);
    console.log('Variant codes from CSV:', variantCodes);

    // Check if variants exist
    const variants = await Variant.find({ variantCode: { $in: variantCodes } });
    console.log(`Found ${variants.length} variants in database`);

    // Check which variants are missing
    const foundVariantCodes = variants.map(v => v.variantCode);
    const missingVariantCodes = variantCodes.filter(code => !foundVariantCodes.includes(code));

    if (missingVariantCodes.length > 0) {
      console.log('Missing variants:', missingVariantCodes);
    } else {
      console.log('All variants exist in the database');
    }

    // Check warehouses
    const warehouseIds = [...new Set(csvData.map(row => row.warehouseId))];
    console.log('Warehouse IDs from CSV:', warehouseIds);

    const warehouses = await Warehouse.find({ _id: { $in: warehouseIds } });
    console.log(`Found ${warehouses.length} warehouses in database`);

    if (warehouses.length < warehouseIds.length) {
      const foundWarehouseIds = warehouses.map(w => w._id.toString());
      const missingWarehouseIds = warehouseIds.filter(id => !foundWarehouseIds.includes(id));
      console.log('Missing warehouses:', missingWarehouseIds);
    }

    // Check vendors
    const vendorPhones = [...new Set(csvData.map(row => row.vendorPhoneNum))];
    console.log('Vendor phone numbers from CSV:', vendorPhones);

    const vendors = await Vendor.find({ 'contact.phone': { $in: vendorPhones } });
    console.log(`Found ${vendors.length} vendors in database`);

    if (vendors.length < vendorPhones.length) {
      const foundVendorPhones = vendors.map(v => v.contact.phone);
      const missingVendorPhones = vendorPhones.filter(phone => !foundVendorPhones.includes(phone));
      console.log('Missing vendors:', missingVendorPhones);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log('Disconnected from database');
  }
}

// Run the script
checkVariants();
