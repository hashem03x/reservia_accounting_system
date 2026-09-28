const factory = require('../handlersFactory')
const Stock = require('../../models/inventory/inventoryModel');


function createStockImages(stockNum) {
    let stockImages = [];
    for (let i = 1; i <= stockNum; i++) {
      stockImages.push({ name: `stockImage-${i}`, maxCount: 10 });
    }
    return stockImages;
  }

  exports.resizeProductImages = asyncHandler(async (req, res, next) => {
    // console.log('req.files', req.files);
    if (req.files) {
      if (req.files.imageCover) {
        const imageCoverFileName = `product-${uuidv4()}-${Date.now()}-covre.png`;
        await sharp(req.files.imageCover[0].buffer)
          // .resize(2000, 1333)
          .toFormat('png')
          .png({ quality: +process.env.IMAGE_QUALITY })
          .toFile(`uploads/products/${imageCoverFileName}`);
        // save image into db
        req.body.imageCover = imageCoverFileName;
      }
      // if (req.files[`stockImage-1`]) {
      for (let i = 1; i <= req.query.stockNum; i++) {
        let stockImages = [];
  
        if (req.body[`stockImage-${i}`]) {
          if (!Array.isArray(req.body[`stockImage-${i}`])) req.body[`stockImage-${i}`] = [req.body[`stockImage-${i}`]];
          // console.log('req.body.stock[i - 1]', req.body.stock[i - 1]);
  
          req.body.stock[i - 1].image = [];
  
          for (let j = 0; j < req.body[`stockImage-${i}`].length; j++) {
             req.body.stock[i - 1].image.push(req.body[`stockImage-${i}`][j].split('/').pop());
          }
        }
  
        if (req.files[`stockImage-${i}`]) {
          // console.log('!!!____________req.body.stock[i - 1]', req.body.stock[i - 1]);
  
          // Use a single await for all image processing to ensure all images are processed before moving on
          stockImages = await Promise.all(
            req.files[`stockImage-${i}`].map(async (img, index) => {
              const imageName = `product-${uuidv4()}-${Date.now()}-${i}-${index + 1}.png`;
              await sharp(img.buffer).toFormat('png').png({ quality: +process.env.IMAGE_QUALITY }).toFile(`uploads/products/${imageName}`);
              return imageName;
            })
          );
  
          // Ensure the images are added correctly to req.body.stock[i - 1].image
          if (Array.isArray(req.body.stock[i - 1].image)) {
            req.body.stock[i - 1].image.push(...stockImages);
          } else {
            req.body.stock[i - 1].image = stockImages;
            // console.log('req.body.stock[i - 1]', req.body.stock[i - 1]);
          }
          // console.log('@@@@____________req.body.stock[i - 1]', req.body.stock[i - 1]);
        }
  
        // console.log('######____________req.body.stock[i - 1]', req.body.stock[i - 1]);
      }
      // console.log('req.body___________>>>> ', req.body.stock);
    }
    next();
  });

exports.createFilterObject = (req, res, next) => {
    let filterObject = {};
    const { mainCategoryId, subCategories, sizes, colors, tags } = req.query;
  
    // Category filter
    const categoryFilter = mainCategoryId ? { category: mainCategoryId } : {};
    if (mainCategoryId) delete req.query.mainCategoryId;
  
    // Subcategory filter
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
  
    // Size filter
    const sizeFilter = sizes
      ? {
          'stock.sizes.size': {
            $in: sizes
              .split(',')
              .map(size => size.trim()) // remove any white space
              .filter(size => size !== ''), // remove any empty string
          },
        }
      : {};
    if (sizes) delete req.query.sizes;
  
    // Color filter
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
  
    // Tags filter
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
  
    // Combine all filters
    filterObject = {
      ...categoryFilter,
      ...subCategoryFilter,
      ...sizeFilter,
      ...colorFilter,
      ...tagsFilter,
    };
    req.filterObject = filterObject;
    next();
  };
  
  

exports.createStock = factory.createOne(Stock);

exports.getAllStock = factory.getAll(Stock);

exports.getStock = factory.getOne(Stock);


exports.updateStock = factory.updateOne(Stock);

exports.deleteStock = factory.deleteOne(Stock);