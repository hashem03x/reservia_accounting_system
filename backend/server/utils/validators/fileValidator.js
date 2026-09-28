const Product = require("../../models/inventory/productModel");
const Subcategory = require("../../models/subCategoryModel");


exports.validateProductData = async (data) => {  
    const { title,
         price,
         description,
         colors,
         category,
         subcategory,
         barcode,
         season,
         imageCover,
         brand } = data;

    const subcategoryExists = await Subcategory.findById(subcategory);
         if (!subcategoryExists) {
           throw new Error('Product validation failed. Invalid subcategory ID');
         }

      if (!title.en || !title.ar) {
        throw new Error('Product validation failed. Missing required field: title in both languages');
      }
      if (!description.en || !description.ar) {
        throw new Error('Product validation failed. Missing required field: description in both languages');
      }

      if (!title) {
        throw new Error('Product validation failed. Missing required field: title');
      }
      if (!description) {
        throw new Error('Product validation failed. Missing required field: description');
      }
      if (!price) {
        throw new Error('Product validation failed. Missing required field: price');
      }
      if (!colors || colors.length === 0) {
        throw new Error('Product validation failed. Missing required field: colors');
      }
      if (!category) {
        throw new Error('Product validation failed. Missing required field: category');
      }
      if (!subcategory) {
        throw new Error('Product validation failed. Missing required field: subcategory');
      }

      return data;
    };
     
    

  
exports.validateVariantData = (data) => {
    const { productId, color, size, sku, variantCode } = data;
    const product = Product.findById(productId);

    if(!product) {
      throw new Error(`Product with id ${productId} not found`);
    }

    if (!data.productId || !data.color || !data.size || !data.sku || !data.variantCode) {
      throw new Error(`Variant validation failed. Missing required fields: ${JSON.stringify(data)}`);
    }
    return data;
  };

  // check available data
  