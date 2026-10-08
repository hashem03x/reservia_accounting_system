const mongoose = require('mongoose');
const fs = require('fs');
const csv = require('csv-parse');
const dotenv = require('dotenv');
const path = require('path');
const iconv = require('iconv-lite');
dotenv.config({ path: 'config.env' });

// Import models
const FixedAsset = require('../models/fixedAssets');
const Warehouse = require('../models/inventory/warehouseModel');

// MongoDB connection
const DB_URI = process.env.DB_URI || 'mongodb://localhost:27017/reversia-accounting';

// Clean numeric values
const cleanNumericValue = value => {
  if (!value || value === '-') return 0;
  return parseFloat(value.toString().replace(/[^\d.-]/g, '')) || 0;
};

// Clean and validate asset data
const cleanAssetData = record => {
  // Clean asset name
  const cleanName = name => {
    if (!name) return '';

    // Split by double dash and clean each part
    const parts = name
      .split('--')
      .map(part => {
        const cleaned = part
          .trim()
          .replace(/\s+/g, ' ') // normalize spaces
          .replace(/^["'\s]+|["'\s]+$/g, '') // remove quotes and spaces
          .replace(/^-+|-+$/g, ''); // remove leading/trailing dashes
        return cleaned;
      })
      .filter(Boolean);

    return parts.join(' -- ');
  };

  const cleanWarehouseName = warehouse => {
    if (!warehouse) return '';
    return warehouse
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .replace(/^-+|-+$/g, '');
  };

  const name = cleanName(record['asset name']);
  const warehouseName = cleanWarehouseName(record['warehouse']);

  // Log problematic records for debugging
  if (!name || !warehouseName) {
    console.log('Invalid record:', {
      name,
      warehouseName,
      original: record,
      rawName: record['asset name'],
      rawWarehouse: record['warehouse'],
    });
  }

  return {
    name,
    bookValue: cleanNumericValue(record['book value']),
    warehouseName,
  };
};

const isValidAssetData = data => {
  return data.name && data.warehouseName;
};

async function importAssets() {
  let session;
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(DB_URI);
    console.log('Connected to MongoDB successfully');

    session = await mongoose.startSession();
    session.startTransaction();

    const csvPath = path.join(__dirname, '../../fixed assets to upload .csv');
    console.log('Reading CSV file from:', csvPath);

    // First, get all warehouses
    const warehouses = await Warehouse.find({}).session(session);
    console.log(
      'Found warehouses:',
      warehouses.map(w => w.name)
    );

    // Create case-insensitive map of warehouse names to IDs
    const warehouseMap = new Map(warehouses.map(w => [w.name.toLowerCase().trim(), w._id]));

    console.log('Available warehouse names:', Array.from(warehouseMap.keys()));

    // Read file with proper encoding for Arabic text
    const fileContent = fs.readFileSync(csvPath);
    const decodedContent = fileContent.toString('utf8');

    // Parse CSV content with proper handling of multi-line fields
    const parseCSV = content => {
      const rows = [];
      let currentRow = [];
      let currentField = '';
      let insideQuotes = false;

      for (let i = 0; i < content.length; i++) {
        const char = content[i];
        const nextChar = content[i + 1];

        if (char === '"') {
          if (insideQuotes && nextChar === '"') {
            // Handle escaped quotes
            currentField += '"';
            i++;
          } else {
            insideQuotes = !insideQuotes;
          }
        } else if (char === ',' && !insideQuotes) {
          currentRow.push(currentField.trim());
          currentField = '';
        } else if (char === '\n' && !insideQuotes) {
          currentRow.push(currentField.trim());
          if (currentRow.some(field => field)) {
            // Only add non-empty rows
            rows.push(currentRow);
          }
          currentRow = [];
          currentField = '';
        } else if (char === '\r') {
          // Skip carriage returns
          continue;
        } else {
          currentField += char;
        }
      }

      // Add the last field and row if any
      if (currentField) {
        currentRow.push(currentField.trim());
      }
      if (currentRow.length > 0) {
        rows.push(currentRow);
      }

      return rows;
    };

    // Parse CSV content
    const rows = parseCSV(decodedContent);
    if (rows.length === 0) {
      throw new Error('No data found in CSV file');
    }

    // Get header (first row)
    const header = rows[0].map(h => h.trim().toLowerCase());

    let totalRecords = 0;
    let successCount = 0;
    let errors = [];
    let assetsToCreate = [];

    // Process each row after header
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      totalRecords++;

      try {
        // Create record object from row
        const record = {};
        header.forEach((h, index) => {
          record[h] = row[index] || '';
        });

        const cleanedData = cleanAssetData(record);

        if (!isValidAssetData(cleanedData)) {
          const error = `Invalid record at line ${totalRecords}: Missing name or warehouse`;
          errors.push(error);
          console.log(error);
          continue;
        }

        // Find warehouse ID (case-insensitive)
        const warehouseLookupName = cleanedData.warehouseName.toLowerCase().trim();
        console.log(`Looking for warehouse: "${cleanedData.warehouseName}" (lookup as: "${warehouseLookupName}")`);
        const warehouseId = warehouseMap.get(warehouseLookupName);

        if (!warehouseId) {
          const error = `Invalid warehouse name "${cleanedData.warehouseName}" at line ${totalRecords}`;
          errors.push(error);
          console.log(error);
          continue;
        }

        // Create the asset data
        const assetData = {
          name: cleanedData.name,
          bookValue: cleanedData.bookValue,
          warehouseId: warehouseId,
        };

        // Check for existing asset
        const existingAsset = await FixedAsset.findOne({
          name: cleanedData.name,
          warehouseId: warehouseId,
        }).session(session);

        if (existingAsset) {
          // Update existing asset
          await FixedAsset.updateOne({ _id: existingAsset._id }, { $set: assetData }).session(session);
          console.log(`Updated existing asset: ${cleanedData.name}`);
        } else {
          // Prepare new asset
          console.log(`Prepared new asset: ${cleanedData.name}`);
          assetsToCreate.push(assetData);
        }

        successCount++;
      } catch (error) {
        console.error(`Error processing record at line ${totalRecords}:`, error);
        errors.push(`Error at line ${totalRecords}: ${error.message}`);
      }
    }

    // If there are any errors, rollback
    if (errors.length > 0) {
      await session.abortTransaction();
      console.error('\nImport failed due to errors:');
      errors.forEach(error => console.error(error));
      throw new Error('Import failed due to errors');
    }

    // Create all new assets
    if (assetsToCreate.length > 0) {
      await FixedAsset.insertMany(assetsToCreate, { session });
    }

    // Everything succeeded, commit transaction
    await session.commitTransaction();

    console.log('\nImport Summary:');
    console.log(`Total records processed: ${totalRecords}`);
    console.log(`Successfully processed: ${successCount}`);
    console.log('\nImport completed successfully!');
  } catch (error) {
    console.error('Error during import:', error.message);
    if (session) {
      await session.abortTransaction();
      console.log('Transaction aborted due to error');
    }
    throw error;
  } finally {
    if (session) {
      await session.endSession();
    }
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

// Execute the import function
console.log('Starting fixed assets import script...');
console.log('Executing import function...');
importAssets()
  .then(() => {
    console.log('Import completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\nScript terminated due to error:', error.message);
    process.exit(1);
  });
