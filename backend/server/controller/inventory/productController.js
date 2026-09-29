const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('express-async-handler');
const { Readable } = require('stream');
const fs = require('fs');
const { Parser } = require('json2csv');
const ApiError = require('../../utils/apiError');
const { uploadMixOfFiles } = require('../../middleware/uploadImageMiddleware');
const Product = require('../../models/inventory/productModel');
const factory = require('../handlersFactory');
const Variant = require('../../models/inventory/variantModel');
const apiResponse = require('../../utils/apiResponse');
const { normalizeTags } = require('../../utils/helper');
const { default: mongoose } = require('mongoose');
// 0 = maximum compression, lowest quality, smallest file size
// 100 = minimum compression, highest quality, largest file size

const BASE_URL = process.env.NODE_ENV == 'production' ? `${process.env.PROD_URL}` : `${process.env.DEV_URL}`;
const IMAGE_QUALITY = +process.env.IMAGE_QUALITY || 60;

// Configure Sharp globally
sharp.cache(false); // Disable caching

const processImage = async (buffer, filename) => {
  // Keep original extension
  const filepath = path.join('uploads', 'products', filename);

  // Create write stream
  const writeStream = fs.createWriteStream(filepath);

  // Save original buffer directly without any processing
  await new Promise((resolve, reject) => {
    const stream = Readable.from(buffer);
    stream.pipe(writeStream).on('finish', resolve).on('error', reject);
  });

  return `${BASE_URL}/products/${filename}`;
};

// Helper function to delete image file
const deleteImage = async filename => {
  try {
    if (!filename) return;
    // const filepath = path.join(process.cwd(), 'uploads', 'products', filename);
    const filepath = path.join('uploads', 'products', filename);
    await fs.unlink(filepath);
  } catch (error) {
    console.error('Error deleting file:', error);
  }
};

exports.uploadProductImages = asyncHandler(async (req, res, next) => {
  const numColors = parseInt(req.query.colors) || 1;
  console.log(numColors);

  const uploadFields = [{ name: 'imageCover', maxCount: 1 }];

  // Add upload field for each color
  for (let i = 0; i < numColors; i++) {
    uploadFields.push({
      name: `colorImages${i}`,
      maxCount: 10,
    });
  }

  return uploadMixOfFiles(uploadFields)(req, res, next);
});

exports.handleProductImages = asyncHandler(async (req, res, next) => {
  if (!req.files) return next();

  try {
    // Process cover image if provided
    if (req.files.imageCover) {
      const coverFilename = `product-${uuidv4()}-${Date.now()}-cover.${req.files.imageCover[0].originalname.split('.').pop()}`;
      const coverUrl = await processImage(req.files.imageCover[0].buffer, coverFilename);
      req.body.imageCover = {
        url: coverUrl,
        filename: coverFilename,
      };
    }

    // Process color images. A service (type: 'service') has no colors/variants at all - see
    // docs/entities/products.md - so `colors` is legitimately absent from the request body for
    // one, and this must not crash/require it the way it does for a real product.
    let colors = [];
    if (req.body.colors) {
      JSON.parse(req.body.colors).forEach(color => {
        colors.push(color);
      });
    }

    console.log('colors', colors);

    const processedColors = [];

    for (let i = 0; i < colors.length; i++) {
      const colorImages = req.files[`colorImages${i}`];
      const color = colors[i];

      if (!color.name) {
        return next(new ApiError(`Color name is required for color ${i + 1}`, 400));
      }

      const processedImages = colorImages
        ? await Promise.all(
            colorImages.map(async (img, index) => {
              const filename = `product-${uuidv4()}-${Date.now()}-${color.name}-${index}.${img.originalname.split('.').pop()}`;
              const url = await processImage(img.buffer, filename);
              return {
                url,
                filename,
                sortOrder: index,
                imageType: color.imageType || 'detail',
                alt: color.alt || `${color.name} view ${index + 1}`,
              };
            })
          )
        : [];

      processedColors.push({
        name: color.name,
        code: color.code || '#000000',
        images: processedImages,
        isDefault: color.isDefault || false,
        isActive: color.isActive !== false,
      });
    }

    req.body.colors = processedColors;
    next();
  } catch (error) {
    next(new ApiError(`Error processing images: ${error.message}`, 500));
  }
});

exports.updateProductImages = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!req.files && !req.body.colors) return next();

  const product = await Product.findById(id);
  if (!product) return next(new ApiError('Product not found', 404));

  try {
    // Update cover image if provided
    if (req.files.imageCover) {
      // Delete old cover image
      // if (product.imageCover?.filename) {
      //   await deleteImage(product.imageCover.filename);
      // }
      const coverFilename = `product-${uuidv4()}-${Date.now()}-cover.${req.files.imageCover[0].originalname.split('.').pop()}`;
      const coverUrl = await processImage(req.files.imageCover[0].buffer, coverFilename);
      product.imageCover = {
        url: coverUrl,
        filename: coverFilename,
      };
    }

    // Process colors update. Absent for a service update (no colors/variants - see
    // docs/entities/products.md), so this must not assume the field always exists.
    const updatedColors = [];
    if (req.body.colors) {
      JSON.parse(req.body.colors).forEach(color => {
        updatedColors.push(color);
      });
    }

    const newColors = [];

    for (let i = 0; i < updatedColors.length; i++) {
      const colorData = updatedColors[i];
      // if color exist or not
      const existingColor = product.colors.find(c => c._id.toString() === colorData._id || c.name.toLowerCase() === colorData.name.toLowerCase());

      // Handle image deletions
      if (colorData.deleteImages && existingColor) {
        const deleteIds = colorData.deleteImages.split(',').map(id => id.trim());

        // delete from file server
        // const imagesToDelete = existingColor.images.filter(img =>
        //   deleteIds.includes(String(img._id))
        // );
        // await Promise.all(imagesToDelete.map(img => deleteImage(img.filename)));

        existingColor.images = existingColor.images.filter(img => !deleteIds.includes(String(img._id)));
      }

      // Process new images for this color
      const newColorImages = req.files[`colorImages${i}`];

      const processedImages = newColorImages
        ? await Promise.all(
            newColorImages.map(async (img, index) => {
              const filename = `product-${uuidv4()}-${Date.now()}-${colorData.name}-${index}.${img.originalname.split('.').pop()}`;
              const url = await processImage(img.buffer, filename);
              return {
                url,
                filename,
                sortOrder: existingColor ? existingColor.images.length + index : index,
                imageType: colorData.imageType || 'detail',
                alt: colorData.alt || `${colorData.name} view ${index + 1}`,
              };
            })
          )
        : [];

      // Combine existing and new images
      newColors.push({
        _id: existingColor?._id,
        name: colorData.name,
        code: colorData.code || existingColor?.code || '#000000',
        images: existingColor ? [...existingColor.images, ...processedImages] : processedImages,
        isDefault: colorData.isDefault || false,
        isActive: colorData.isActive !== false,
      });
    }

    product.colors = newColors;
    await product.save();
    req.body.colors = product.colors;

    next();
  } catch (error) {
    next(new ApiError(`Error updating images: ${error.message}`, 500));
  }
});

exports.updateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  if (updateData.priceAfterDiscount == null || updateData.priceAfterDiscount == 0) {
    updateData.priceAfterDiscount = null;
    // console.log('updateData.priceAfterDiscount', updateData.priceAfterDiscount);
  }

  const updatedProduct = await Product.findByIdAndUpdate(
    id,
    { $set: updateData },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updatedProduct) {
    throw new ApiError('No product found with that ID', 404);
  }

  res.status(200).json({
    status: 'success',
    data: updatedProduct,
  });
});

// create product
exports.createProduct = factory.createOne(Product);
// exports.handleColorsImage = asyncHandler(async (req, res, next) => {
//   const numColor = +req.query.colorNumber || 0;
//   if (numColor < 1) return next();

//   if (!req.files) return next();

//   try {
//     // Handle cover image if present
//     if (req.files.imageCover) {
//       const imageCoverFileName = `product-${uuidv4()}-${Date.now()}-cover.webp`;
//       // await sharp(req.files.imageCover[0].buffer)
//       //   .toFormat('avif')
//       //   .avif({ quality: +process.env.IMAGE_QUALITY || 60 })
//       //   .toFile(`uploads/products/${imageCoverFileName}`);
//       const url = await processImage(req.files.imageCover[0].buffer, imageCoverFileName);

//       req.body.imageCover = {
//         url,
//         publicId: imageCoverFileName
//       };
//     }

//     // Initialize Map for color images
//     let imagesMap = new Map();

//     // Process each color's images
//     for (let i = 0; i < numColor; i++) {
//       const colorImages = req.files[`colors[${i}][images]`];
//       if (!colorImages) continue;

//       const colorName = req.body.colors[i]?.name;
//       if (!colorName) {
//         return next(new ApiError(`Color name is required for color set ${i + 1}`, 400));
//       }

//     if (Array.isArray(colorImages)) {
//         const processedImages = await Promise.all(
//           colorImages.map(async (img, index) => {
//             const imageName = `product-${uuidv4()}-${Date.now()}-${i}-${index + 1}.webp`;
//             await sharp(img.buffer)
//               .toFormat('webp')
//               .webp({ quality: +process.env.IMAGE_QUALITY || 60 })
//               .toFile(`uploads/products/${imageName}`);

//             return {
//               url: `${BASE_URL}/products/${imageName}`,
//               publicId: imageName
//             };
//           })
//         );

//         imagesMap.set(colorName.toLowerCase().trim(), processedImages);
//       }
//     }

//     // Convert Map to plain object for better serialization
//     req.body.imagesMap = Object.fromEntries(imagesMap);
//     next();
//   } catch (error) {
//     console.error('Error processing images:', error);
//     return next(new ApiError('Error processing images', 500));
//   }
// });

// exports.addImagesToProduct = (req, res, next) => {
//   const { imagesMap } = req.body;

//   if (!imagesMap) return next();

//   try {
//     const imageEntries = Object.entries(imagesMap);

//     imageEntries.forEach(([key, images], i) => {
//       if (!req.body.colors[i]) {
//         req.body.colors[i] = {};
//       }
//       req.body.colors[i].images = images;
//       req.body.colors[i].name = key;
//     });

//     next();
//   } catch (error) {
//     return next(new ApiError('Error processing images data', 400));
//   }
// };

// exports.createProduct = factory.createOne(Product);

// exports.updateColorOfImages = async (req, res, next) => {
//   try {
//     const { imagesMap } = req.body;
//     if (!imagesMap) return next();

//     const product = await Product.findById(req.params.id);
//     if (!product) return next(new ApiError('Product not found', 404));

//     const colors = product.colors || [];

//     const imagesEntries = Object.entries(imagesMap);

//     for (const [colorName, newImages] of imagesEntries) {

//       const colorData = req.body.colors?.find(
//         (color) => color.name.toLowerCase().trim() === colorName
//       );

//       const colorIndex = colors.findIndex(
//         (color) => color.name.toLowerCase().trim() === colorName
//       );

//       console.log('colorIndex', colorIndex);

//      if (colorIndex !== -1) {
//         let existingImages = colors[colorIndex].images || [];
//         if (colorData?.imageIds?.length) {
//           console.log('colorData.imageIds', colorData.imageIds);
//           existingImages = existingImages.filter(
//             (img) => !colorData.imageIds.includes(String(img._id))
//           );
//         }

//         console.log('existingImages', existingImages);

//       colors[colorIndex] = {
//           ...colors[colorIndex],
//           images: [...existingImages, ...newImages],
//           code: colorData?.code || colors[colorIndex].code,
//           name: colorName
//         };
//         console.log('colors[colorIndex]', colors[colorIndex]);
//       } else {
//         colors.push({
//           name: colorName,
//           images: newImages,
//           code: colorData?.code || ''
//         });
//       }
//     }

//     req.body.colors = colors;
//     next();
//   } catch (error) {
//     console.error('Error updating colors:', error);
//     next(new ApiError('Error processing colors', 500));
//   }
// };

// const handleColors = async(productId, updateColor) =>{
//   const product = await Product.findById(productId);
//   if (!product) {
//    product.colors = product.colors.map(color => {
//         // [{name: 'red', code: 'red', images: []}]
//         updateColor.forEach(color => {

//         });
//    })

//    product.colors.push(...updateColor); // [{name: 'red', code: 'red', images: []}]
// }
//   await product.save();
// }

exports.createFilterObject = asyncHandler(async (req, res, next) => {
  let filterObject = {};

  const { mainCategoryId, subCategories, sizes, colors, tags, isDeleted, isAvailable } = req.query;

  const categoryFilter = mainCategoryId ? { category: mainCategoryId } : {};

  if (mainCategoryId) delete req.query.mainCategoryId;

  const subCategoryFilter = subCategories
    ? {
        subcategory: {
          $in: subCategories
            .split(',')
            .map(subcategory => subcategory.trim())
            .filter(subcategory => subcategory !== ''),
        },
      }
    : {};

  if (subCategories) delete req.query.subCategories;

  const sizeFilter = sizes
    ? {
        'stock.sizes.size': {
          $in: sizes
            .split(',')
            .map(size => size.trim())
            .filter(size => size !== ''),
        },
      }
    : {};

  if (sizes) delete req.query.sizes;

  const colorFilter = colors
    ? {
        'stock.color': {
          $in: colors
            .split(',')
            .map(color => color.trim())
            .filter(color => color !== ''),
        },
      }
    : {};

  if (colors) delete req.query.colors;

  const tagsFilter = tags
    ? {
        tags: {
          $in: tags
            .split(',')
            .map(tag => tag.trim())
            .filter(tag => tag !== ''),
        },
      }
    : {};

  if (tags) delete req.query.tags;

  const isDeletedFilter = isDeleted ? { isDeleted: isDeleted === 'true' } : {};
  const isAvailableFilter = isAvailable ? { isAvailable: isAvailable === 'true' } : {};

  if (isDeleted) delete req.query.isDeleted;
  if (isAvailable) delete req.query.isAvailable;

  filterObject = {
    ...categoryFilter,
    ...subCategoryFilter,
    ...sizeFilter,
    ...colorFilter,
    ...tagsFilter,
    ...isDeletedFilter,
    ...isAvailableFilter,
  };

  req.filterObject = filterObject;
  next();
});

exports.getProducts = factory.getAll(Product, 'Products', ' ', false);

exports.getFilteredProducts = asyncHandler(async (req, res, next) => {
  const { format } = req.query; // Check if CSV format is requested
  const allProducts = await Product.find().sort({ createdAt: -1 });

  const filteredProducts = allProducts
    .map(product => {
      // Convert Mongoose document to plain object
      const productObj = product.toObject();

      // Filter colors that have at least one variant available in stock
      const filteredColors = productObj.colors.filter(color => productObj.variants.some(variant => variant.color === color.name && variant.stock.some(s => s.quantity > 0)));

      return { ...productObj, colors: filteredColors };
    })
    .filter(product => product.colors.length > 0);

  // If CSV format is requested
  if (format === 'csv') {
    try {
      // Prepare data for CSV with only required fields
      const csvData = filteredProducts.map(product => {
        // Get the first image from the first available color
        let imageUrl = '';
        if (product.colors && product.colors.length > 0) {
          const firstColor = product.colors[0];
          if (firstColor.images && firstColor.images.length > 0) {
            imageUrl = firstColor.images[0].url || '';
          }
        }

        return {
          id: product._id,
          // No public storefront in the Reversia accounting app - product detail pages don't exist.
          url: '',
          title_en: product.title?.en || '',
          title_ar: product.title?.ar || '',
          description_en: product.description?.en || '',
          description_ar: product.description?.ar || '',
          price: product.price || 0,
          priceAfterDiscount: product.priceAfterDiscount || product.price || 0,
          image: imageUrl,
          availability: product.isAvailable && !product.isDeleted ? 'In Stock' : 'Out of Stock',
          condition: 'New',
        };
      });

      // Define CSV fields
      const fields = [
        { label: 'id', value: 'id' },
        { label: 'link', value: 'url' },
        { label: 'title', value: 'title_en' },
        // { label: 'title', value: 'title_ar' },
        { label: 'description', value: 'description_en' },
        // { label: 'description', value: 'description_ar' },
        { label: 'price', value: 'price' },
        { label: 'price_after_discount', value: 'priceAfterDiscount' },
        { label: 'image_link', value: 'image' },
        { label: 'availability', value: 'availability' },
        { label: 'condition', value: 'condition' },
      ];

      // Create CSV parser
      const json2csvParser = new Parser({ fields });
      const csv = json2csvParser.parse(csvData);

      // Set headers for CSV download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="products-${Date.now()}.csv"`);

      return res.status(200).send(csv);
    } catch (error) {
      return next(new ApiError(`Error generating CSV: ${error.message}`, 500));
    }
  }

  // Default JSON response
  res.json({
    length: filteredProducts.length,
    data: filteredProducts,
  });
});

exports.getProduct = factory.getOne(Product);

exports.getProductsByIds = asyncHandler(async (req, res, next) => {
  let { ids, page = 1, limit = 10 } = req.query;
  if (!ids) return res.status(400).json({ status: 'fail', message: 'ids parameter is required' });

  try {
    if (typeof ids === 'string') {
      if (ids.startsWith('[')) {
        ids = JSON.parse(ids);
      } else {
        ids = ids.split(',');
      }
    }

    if (!Array.isArray(ids)) {
      return res.status(400).json({ status: 'fail', message: 'ids must be an array' });
    }

    // ✅ فلترة + تحويل
    ids = ids.filter(id => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));

    if (ids.length === 0) {
      return res.status(400).json({ status: 'fail', message: 'No valid ObjectIds provided' });
    }

    page = parseInt(page);
    limit = parseInt(limit);
    const skip = (page - 1) * limit;

    const query = { _id: { $in: ids } };
    const total = await Product.countDocuments(query);
    const products = await Product.find(query).skip(skip).limit(limit);
    const numberOfPages = Math.ceil(total / limit);

    res.status(200).json({
      data: products,
      results: products.length,
      paginationResult: {
        numberOfPages,
        currentPage: page,
        limit: limit,
      },
    });
  } catch (error) {
    console.log(error);
    return next(new ApiError('Invalid ids parameter', 400));
  }
});

// Powers the tags filter's suggestion list on the admin product list page - every distinct tag
// currently in use across non-deleted products, so an admin filters by tags that actually exist
// instead of free-typing and getting zero results. A single Mongo `distinct` is cheap regardless
// of catalog size (no per-product scan needed beyond the index-backed distinct itself).
exports.getDistinctTags = asyncHandler(async (req, res) => {
  // Model.distinct() reads raw stored values directly - it does not hydrate full Mongoose
  // documents, so productModel.js's post('init') repair hook never runs here. Legacy corrupted
  // tags (see utils/helper.js's normalizeTags/unwrapCorruptedTag) would otherwise leak into the
  // admin's tag-suggestions autocomplete as-is; run every raw value through normalizeTags (which
  // can expand one corrupted entry into several real tags) and re-dedupe before returning.
  const rawTags = await Product.distinct('tags', { isDeleted: false });
  const tags = normalizeTags(rawTags);
  res.status(200).json({ data: tags.sort() });
});

exports.updateProduct2 = factory.updateOne(Product);

exports.deleteProduct = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const product = await Product.findById(id);

  if (!product) {
    return next(new ApiError('No product found with that ID', 404));
  }

  let colors = product.colors;

  colors = await Promise.all(
    colors.map(async color => {
      color.images = [{}];
      color.isDeleted = true;

      const newColor = { ...color };

      return newColor;
    })
  );

  product.colors = colors;

  let variants = product.variants;

  variants = await Promise.all(
    variants.map(async variant => {
      await Variant.findByIdAndUpdate(variant._id, { quantity: 0, isDeleted: true });
    })
  );

  product.isDeleted = true;
  product.imageCover = {};
  await product.save();

  const data = {
    product,
    variants,
  };

  res.status(200).json({
    status: 'success',
    message: 'Product deleted successfully',
    data,
  });
});

exports.deleteProductImage = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { image } = req.body;

  const imageName = image.startsWith('http') ? image.split('/').pop() : image;

  const product = await Product.findByIdAndUpdate(id, { $pull: { 'stock.$[].image': imageName } }, { new: true });

  if (!product) {
    return next(new ApiError('No document found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Image deleted successfully',
    data: product,
  });
});

exports.getProductsColorsSizes = asyncHandler(async (req, res, next) => {
  const products = await Product.find({}, 'stock.color stock.sizes.size').select('stock.color stock.sizes.size');

  const uniqueSizes = new Set();
  const uniqueNumSizes = new Set();
  const uniqueColors = new Set();

  products.forEach(product => {
    product.stock.forEach(stockItem => {
      stockItem.sizes.forEach(sizeItem => {
        if (isNaN(sizeItem.size)) {
          uniqueSizes.add(sizeItem.size);
        } else {
          uniqueNumSizes.add(sizeItem.size);
        }
      });
      uniqueColors.add(stockItem.color);
    });
  });

  const sortedSizes = Array.from(uniqueSizes).sort();
  const sortedNumSizes = Array.from(uniqueNumSizes).sort((a, b) => a - b);
  const sortedColors = Array.from(uniqueColors).sort();

  res.status(200).json({
    status: 'success',
    data: {
      sizes: sortedSizes,
      numSizes: sortedNumSizes,
      colors: sortedColors,
    },
  });
});

exports.applyDiscount = asyncHandler(async (req, res, next) => {
  const { discount } = req.body;

  if (discount > 100 || discount < 0) {
    return res.status(400).json({
      status: 'fail',
      message: 'Invalid discount value',
    });
  }

  const products = await Product.find({}).select('price priceAfterDiscount');

  for (const product of products) {
    const discountedPrice = parseFloat((product.price * (1 - discount / 100)).toFixed(2));
    product.priceAfterDiscount = discountedPrice;
    await product.save();
  }

  res.status(200).json({
    status: 'success',
    message: 'All products price updated successfully',
  });
});

exports.applyDiscountToProduct = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { discount } = req.body;

  if (discount > 100 || discount < 0) {
    return res.status(400).json({
      status: 'fail',
      message: 'Invalid discount value',
    });
  }

  const product = await Product.findById(id).select('price priceAfterDiscount');

  if (!product) {
    return res.status(404).json({
      status: 'fail',
      message: 'Product not found',
    });
  }

  const discountedPrice = parseFloat((product.price * (1 - discount / 100)).toFixed(2));

  product.priceAfterDiscount = discountedPrice;
  await product.save();

  res.status(200).json({
    status: 'success',
    message: 'Product price updated successfully',
    data: product,
  });
});
