const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from config.env
try {
  dotenv.config({ path: 'config.env' });
  console.log('Loaded environment from config.env');
} catch (error) {
  console.warn('Warning: Could not load config.env file:', error.message);
}

// Database connection string with fallback
const DB_URI = process.env.DB_URI || 'mongodb://localhost:27017/reversia-accounting';

// Function to check if a filename has an extension other than .avif
const needsAvifExtension = filename => {
  if (!filename) return false;

  // If it already ends with .avif, no change needed
  if (filename.toLowerCase().endsWith('.avif')) return false;

  // Check if it has any extension (contains a dot)
  return filename.includes('.');
};

// Function to convert filename to .avif extension
const convertToAvifExtension = filename => {
  if (!filename) return filename;

  // Extract the base name without extension
  const baseName = filename.substring(0, filename.lastIndexOf('.'));

  // Return with .avif extension
  return `${baseName}.avif`;
};

// Main function to update image extensions
const updateImageExtensionsToAvif = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(DB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    // Get direct access to the products collection
    const productsCollection = mongoose.connection.db.collection('products');

    // Get all products
    const products = await productsCollection.find({}).toArray();
    console.log(`Found ${products.length} products to process`);

    // Log a sample product to understand the structure
    if (products.length > 0) {
      const sampleProduct = products[0];
      console.log('\nSample product structure:');
      console.log('- Product ID:', sampleProduct._id);
      console.log('- Title:', sampleProduct.title?.en || sampleProduct.title || 'No title');

      // Check if the product has colors
      if (sampleProduct.colors && Array.isArray(sampleProduct.colors)) {
        console.log('- Has colors array with', sampleProduct.colors.length, 'colors');

        // Check the first color if available
        if (sampleProduct.colors.length > 0) {
          const sampleColor = sampleProduct.colors[0];
          console.log('  - First color:', sampleColor.name || 'No name');

          // Check if the color has images
          if (sampleColor.images && Array.isArray(sampleColor.images)) {
            console.log('  - First color has', sampleColor.images.length, 'images');

            // Log the first image if available
            if (sampleColor.images.length > 0) {
              const sampleImage = sampleColor.images[0];
              console.log('    - First image filename:', sampleImage.filename || 'No filename');
              console.log('    - First image URL:', sampleImage.url || 'No URL');
            } else {
              console.log('    - No images in first color');
            }
          } else {
            console.log('  - First color has no images array');
          }
        }
      } else {
        console.log('- No colors array found');
      }

      // Check if the product has imageCover
      if (sampleProduct.imageCover) {
        console.log('- Has imageCover:', sampleProduct.imageCover.url || 'No URL');
      } else {
        console.log('- No imageCover found');
      }
      console.log('\n');
    }

    // Count products with images that need updating
    let productsWithNonAvifImages = 0;
    let totalImagesNeedingUpdate = 0;

    // Check all products for non-avif images
    for (const product of products) {
      let productHasNonAvifImages = false;

      // Check colors.images
      if (product.colors && Array.isArray(product.colors)) {
        for (const color of product.colors) {
          if (color.images && Array.isArray(color.images)) {
            for (const image of color.images) {
              if (image.filename && needsAvifExtension(image.filename)) {
                totalImagesNeedingUpdate++;
                productHasNonAvifImages = true;
                console.log(`Found non-avif image: ${image.filename} in product "${product.title?.en || 'Unknown'}"`);
              }
            }
          }
        }
      }

      // Check imageCover
      if (product.imageCover && product.imageCover.url && needsAvifExtension(product.imageCover.url)) {
        totalImagesNeedingUpdate++;
        productHasNonAvifImages = true;
        console.log(`Found non-avif imageCover: ${product.imageCover.url} in product "${product.title?.en || 'Unknown'}"`);
      }

      if (productHasNonAvifImages) {
        productsWithNonAvifImages++;
      }
    }

    console.log(`\nFound ${totalImagesNeedingUpdate} non-avif images in ${productsWithNonAvifImages} products`);

    let totalUpdatedProducts = 0;
    let totalUpdatedImages = 0;

    // Process each product
    for (const product of products) {
      let productUpdated = false;
      const updates = {};

      // Process each color in the product
      if (product.colors && Array.isArray(product.colors)) {
        for (let colorIndex = 0; colorIndex < product.colors.length; colorIndex++) {
          const color = product.colors[colorIndex];
          if (!color.images || !Array.isArray(color.images)) continue;

          let colorUpdated = false;

          // Check each image in the color
          for (let imageIndex = 0; imageIndex < color.images.length; imageIndex++) {
            const image = color.images[imageIndex];
            if (image.filename && needsAvifExtension(image.filename)) {
              // Store the original filename for logging
              const originalFilename = image.filename;

              // Update the filename to use .avif extension
              product.colors[colorIndex].images[imageIndex].filename = convertToAvifExtension(image.filename);

              // If the URL contains the filename, update it too
              if (image.url && image.url.includes(originalFilename)) {
                product.colors[colorIndex].images[imageIndex].url = image.url.replace(originalFilename, product.colors[colorIndex].images[imageIndex].filename);
              }

              console.log(`Updated image: ${originalFilename} -> ${product.colors[colorIndex].images[imageIndex].filename}`);
              totalUpdatedImages++;
              colorUpdated = true;
              productUpdated = true;
            }
          }

          if (colorUpdated) {
            const productTitle = product.title?.en || product.title || 'Unknown';
            const colorName = color.name || 'Unknown color';
            console.log(`Updated images for color ${colorName} in product "${productTitle}"`);
          }
        }

        if (productUpdated) {
          updates.colors = product.colors;
        }
      }

      // Check if imageCover needs to be updated (though it's marked as "Not used" in the model)
      if (product.imageCover && product.imageCover.url && needsAvifExtension(product.imageCover.url)) {
        const originalUrl = product.imageCover.url;
        product.imageCover.url = convertToAvifExtension(product.imageCover.url);
        updates.imageCover = product.imageCover;
        console.log(`Updated imageCover: ${originalUrl} -> ${product.imageCover.url}`);
        productUpdated = true;
      }

      // Save the product if it was updated
      if (productUpdated) {
        await productsCollection.updateOne({ _id: product._id }, { $set: updates });
        totalUpdatedProducts++;
        const productTitle = product.title?.en || product.title || 'Unknown';
        console.log(`Saved updates for product: "${productTitle}"`);
      }
    }

    console.log('\nImage extension update process completed!');
    console.log(`Updated ${totalUpdatedImages} images across ${totalUpdatedProducts} products`);
  } catch (error) {
    console.error('Script error:', error);
    if (error.name === 'MongoNetworkError') {
      console.error('Is the MongoDB server running?');
    } else if (error.name === 'MongoParseError') {
      console.error('Invalid MongoDB connection string:', DB_URI);
    }
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('Disconnected from MongoDB');
    }
  }
};

// Run the script
updateImageExtensionsToAvif().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
