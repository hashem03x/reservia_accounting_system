const fastCsv = require('fast-csv');
const ExcelJS = require('exceljs');
const Product = require('../models/inventory/productModel');
const ApiError = require('./apiError');

const exportLargeCsv = async (res, next) => {
  try {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=products.csv');

    const csvStream = fastCsv.format({ headers: true });
    csvStream.pipe(res);

    // Query MongoDB with a cursor
    const cursor = Product.find({ isDeleted: false }).cursor();
    for await (const doc of cursor) {
      // Populate with variants
      await doc.populate('variants').execPopulate();

      doc.variants.forEach(variant => {
        csvStream.write({
          ProductTitle: doc.title,
          Price: doc.price,
          VariantSlug: variant.slug,
          Color: variant.color,
          Size: variant.size,
          SKU: variant.sku,
        });
      });
    }
    csvStream.end();
  } catch (error) {
    return next(new ApiError('Error exporting CSV', 500));
  }
};

const exportLargeExcel = async (res, next) => {
  try {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=products.xlsx');

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
    const worksheet = workbook.addWorksheet('Products');

    // Define columns
    worksheet.columns = [
      { header: 'Product Title', key: 'ProductTitle', width: 25 },
      { header: 'Price', key: 'Price', width: 15 },
      { header: 'Variant Slug', key: 'VariantSlug', width: 25 },
      { header: 'Color', key: 'Color', width: 15 },
      { header: 'Size', key: 'Size', width: 15 },
      { header: 'SKU', key: 'SKU', width: 20 },
    ];

    // Query MongoDB with a cursor
    const cursor = Product.find({ isDeleted: false }).cursor();

    for await (const doc of cursor) {
      // Populate with variants
      await doc.populate('variants').execPopulate();

      doc.variants.forEach(variant => {
        worksheet.addRow({
          ProductTitle: doc.title,
          Price: doc.price,
          VariantSlug: variant.slug,
          Color: variant.color,
          Size: variant.size,
          SKU: variant.sku,
        }).commit();
      });
    }

    // Finish writing the workbook
    await workbook.commit();
  } catch (error) {
    return next(new ApiError('Error exporting Excel', 500));
  }
};

module.exports = { exportLargeCsv, exportLargeExcel };