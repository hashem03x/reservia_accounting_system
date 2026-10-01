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
     
    

  
