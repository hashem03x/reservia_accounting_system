const mongoose = require('mongoose');
const fs = require('fs').promises;
const csv = require('csv-parse');
const Product = require('../models/inventory/productModel');
const { colorMapping } = require('../utils/colorMapping');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: 'config.env' });

// MongoDB connection
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
  const content = await fs.readFile(csvFilePath, 'utf-8');
  return new Promise((resolve, reject) => {
    csv.parse(
      content,
      {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      },
      (err, data) => {
        if (err) reject(err);
        else resolve(data);
      }
    );
  });
};

// Function to read and parse JSON file
const readJSON = async () => {
  const jsonFilePath = path.join(__dirname, '../../leopard-live.products_1.json');
  const content = await fs.readFile(jsonFilePath, 'utf-8');
  return JSON.parse(content);
};

// Function to find product in old JSON data
const findProductInOldData = (oldProducts, websiteName) => {
  return oldProducts.find(product => product.title?.en?.toLowerCase().includes(websiteName.toLowerCase()) || product.title?.ar?.toLowerCase().includes(websiteName.toLowerCase()));
};

// Function to convert color hex to name
const getColorNameFromHex = hex => {
  if (!hex) return 'black';

  // Normalize hex color
  hex = hex.toLowerCase();
  if (!hex.startsWith('#')) hex = '#' + hex;

  // Create reverse mapping of hex to color name
  const hexToName = Object.entries(colorMapping).reduce((acc, [name, hexValue]) => {
    acc[hexValue.toLowerCase()] = name;
    return acc;
  }, {});

  return hexToName[hex] || 'black';
};

// Function to format image URL
const formatImageUrl = imageName => {
  if (!imageName) return null;
  return imageName.startsWith('http') ? imageName : `https://api.leopardegy.com/products/${imageName}`;
};

// Main update function
const updateProductImages = async () => {
  try {
    // Read the CSV and JSON files
    const csvData = await readCSV();
    const oldProducts = await readJSON();

    // Process each product in CSV
    for (const row of csvData) {
      const websiteName = row['website name']?.trim();
      const productNameEn = row['name eng']?.trim();

      // Skip if website name is 'no' or empty
      if (!websiteName || websiteName.toLowerCase() === 'no') {
        console.log(`Skipping product "${productNameEn}" - no website name`);
        continue;
      }

      // Start a session for transaction
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // Find the product in old data
        const oldProduct = findProductInOldData(oldProducts, websiteName);

        if (!oldProduct) {
          console.log(`No matching old product found for "${websiteName}"`);
          await session.abortTransaction();
          session.endSession();
          continue;
        }

        // Find the current product in MongoDB
        const currentProduct = await Product.findOne({
          'title.en': productNameEn,
        }).session(session);

        if (!currentProduct) {
          console.log(`Product not found in database: "${productNameEn}"`);
          await session.abortTransaction();
          session.endSession();
          continue;
        }

        // Map old stock images to new color images
        if (oldProduct.stock && oldProduct.stock.length > 0) {
          for (const currentColor of currentProduct.colors) {
            // Find matching stock item by color
            const matchingStock = oldProduct.stock.find(stock => {
              const oldColorName = getColorNameFromHex(stock.color);
              return oldColorName.toLowerCase() === currentColor.name.toLowerCase();
            });

            if (matchingStock && matchingStock.image) {
              // Map stock images to color images
              currentColor.images = matchingStock.image.map((img, index) => ({
                url: formatImageUrl(img),
                alt: `${currentProduct.title.en} - ${currentColor.name} - ${index + 1}`,
                filename: img,
                sortOrder: index,
                imageType: 'detail',
              }));

              // Add imageCover as the last image if it exists
              if (oldProduct.imageCover) {
                currentColor.images.push({
                  url: formatImageUrl(oldProduct.imageCover),
                  alt: `${currentProduct.title.en} - ${currentColor.name} - cover`,
                  filename: oldProduct.imageCover,
                  sortOrder: currentColor.images.length,
                  imageType: 'main',
                });
              }

              console.log(`Updated color ${currentColor.name} with ${currentColor.images.length} images`);
            } else {
              console.log(`No matching stock found for color ${currentColor.name}`);
            }
          }
        }

        // Save the updated product
        const result = await currentProduct.save({ session });
        await session.commitTransaction();
        console.log(
          `Successfully updated images for product: "${productNameEn}"`,
          result.colors.map(c => ({ name: c.name, imageCount: c.images.length }))
        );
      } catch (error) {
        console.error(`Error updating product "${productNameEn}":`, error);
        await session.abortTransaction();
      } finally {
        session.endSession();
      }
    }

    console.log('Image update process completed!');
  } catch (error) {
    console.error('Script error:', error);
  } finally {
    await mongoose.disconnect();
  }
};

// Run the script
updateProductImages().catch(console.error);
