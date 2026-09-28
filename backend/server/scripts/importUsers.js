const fs = require('fs');
const csv = require('csv-parse');
const mongoose = require('mongoose');
const User = require('../models/userModel');
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

// Function to clean phone numbers
const cleanPhoneNumber = phone => {
  if (!phone) return '';

  // Convert Arabic numerals to English numerals
  const arabicToEnglish = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
  };

  // Convert phone number to string and replace Arabic numerals
  let cleanedPhone = phone
    .toString()
    .split('')
    .map(char => arabicToEnglish[char] || char)
    .join('');

  // Remove all non-digit characters
  cleanedPhone = cleanedPhone.replace(/[^\d]/g, '');

  // Handle multiple phone numbers (take the first one)
  if (cleanedPhone.includes('/')) {
    cleanedPhone = cleanedPhone.split('/')[0].trim();
  }

  // Ensure it starts with '01'
  if (cleanedPhone.length >= 10) {
    if (!cleanedPhone.startsWith('0')) {
      cleanedPhone = '0' + cleanedPhone;
    }
    return cleanedPhone;
  }

  return '';
};

// Function to clean name
const cleanName = name => {
  if (!name) return '';
  // Remove leading/trailing spaces and dots
  return name.trim().replace(/^[.\s]+|[.\s]+$/g, '');
};

// Function to clean user data
const cleanUserData = user => {
  // Clean phone number - remove any non-digit characters
  let phone = cleanPhoneNumber(user.Phone || '');

  // Clean and normalize name
  const name = cleanName(user.Name || '');

  // Create offline address object from available fields
  const offlineAddress = {
    street: [user.Address1, user.Address2].filter(Boolean).join(', '),
    city: user.City || '',
    state: user.State || '',
    country: user.Country || '',
    postalCode: user.PostalCode || '',
    details: user.AddressRemarks || '',
    landmark: '',
    phone: phone, // Using same phone as primary contact
  };

  return {
    name,
    phone,
    offlineAddress: offlineAddress.street || offlineAddress.city ? offlineAddress : undefined,
  };
};

// Function to validate user data
const isValidUserData = data => {
  return data.name && data.phone;
};

// Process users in batches
async function processUsers(users) {
  for (const user of users) {
    try {
      // Clean and validate data
      const cleanedData = cleanUserData(user);

      if (!isValidUserData(cleanedData)) {
        console.log(`Skipping invalid record: Missing or invalid name/phone`);
        console.log(`Original data - Name: "${user.Name}", Phone: "${user.Phone}"`);
        continue;
      }

      // Create user object with all fields
      const userData = {
        name: cleanedData.name,
        phone: cleanedData.phone,
        type: 'offline',
        role: 'user',
        offlineAddress: cleanedData.offlineAddress,
      };

      // Try to find existing user with this phone number
      const existingUser = await User.findOne({ phone: cleanedData.phone });

      if (existingUser) {
        // Update existing user
        await User.updateOne({ phone: cleanedData.phone }, { $set: userData });
        console.log(`Updated existing user: ${cleanedData.name} (${cleanedData.phone})`);
      } else {
        // Insert new user
        await User.create(userData);
        console.log(`Successfully processed: ${cleanedData.name} (${cleanedData.phone})`);
      }
    } catch (error) {
      console.error(`Error processing record:`, error);
      continue;
    }
  }
}

// Function to process the CSV file with transaction support
const processCSV = async () => {
  const BATCH_SIZE = 100; // Process 100 users at a time
  let currentBatch = [];
  let totalImported = 0;
  let totalRecords = 0;
  let skippedRecords = 0;
  let errors = [];

  try {
    const csvPath = path.join(__dirname, '../../customer data.csv');
    console.log('Reading CSV file from:', csvPath);

    const parser = fs.createReadStream(csvPath).pipe(
      csv.parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        skipRecordsWithError: true,
        bom: true,
        relax_column_count: true,
        skip_lines_with_error: true,
      })
    );

    // Process records one by one
    for await (const record of parser) {
      totalRecords++;

      // Skip empty records
      if (!record || Object.keys(record).length === 0) {
        console.log(`Skipping empty record at line ${totalRecords}`);
        skippedRecords++;
        errors.push(`Line ${totalRecords}: Empty record`);
        continue;
      }

      currentBatch.push(record);

      // If we've reached the batch size, process the batch
      if (currentBatch.length >= BATCH_SIZE) {
        await processUsers(currentBatch);
        currentBatch = []; // Clear the batch
      }
    }

    // Process any remaining users in the last batch
    if (currentBatch.length > 0) {
      await processUsers(currentBatch);
    }

    // Print summary
    console.log(`\nImport Summary:`);
    console.log(`Total records processed: ${totalRecords}`);
    console.log(`Skipped records: ${skippedRecords}`);
    if (errors.length > 0) {
      console.log('\nErrors encountered:');
      errors.forEach(error => console.log(error));
    }
    console.log('\nImport completed successfully! All valid records were processed.');
  } catch (error) {
    console.error('\nImport failed!');
    console.error('Reason:', error.message);
    throw error;
  } finally {
    // Disconnect from MongoDB
    await mongoose.disconnect();
  }
};

// Run the import
processCSV().catch(error => {
  console.error('\nScript terminated due to error.');
  process.exit(1);
});

// * if the sub cat = T-shirt then product.subcategory = 679e7199379d6a5a7b83e49b, if the sub cat = PLUVER then product.subcategory = 67aa9d1258954481079d1a6b
// * if sub cat = jeans then product.subcategory = 679e7199379d6a5a7b83e49c, if the sub cat = dress then product.subcategory = 679e7199379d6a5a7b83e49d

/**
 * create a new script to import products and its variants from @inflow
 * but before that check the products and variants models @products and @variants and check the relation between them
 * you should make all queries using session (transactions) to make sure the data is imported correctly and not corrupted
 * Note: if the Location = "hiliopilis" then the variant.stock.warehouse = 67933fd03bf29b9f172eeab6 and if the Location = "sheikh zayed" then the variant.stock.warehouse = 67933fb13bf29b9f172eeab0
 * product.category = 679e7116379d6a5a7b83e499
 * for sub cat make a query to the db and get all subcategories and check if the sub category exists in the db if it exists then get the id of the sub category
 * if no create a new sub category and use the id of the new sub category check @categori @subCategory model
 * also check all the db models @models 
 * and get the color code from the color name check the product model @productMo

 * don't care about "website name" field
 */
