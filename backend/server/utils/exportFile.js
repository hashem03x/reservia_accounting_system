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
      // A product now carries its own stock directly (no separate Variant to populate) - emit one
      // row per warehouse stock entry, or a single stock-less row for a service/unstocked product.
      const stockEntries = doc.stock && doc.stock.length > 0 ? doc.stock : [null];
      stockEntries.forEach(stockItem => {
        csvStream.write({
          ProductTitle: doc.title,
          Price: doc.price,
          SKU: doc.sku,
          Barcode: doc.barcode,
          Warehouse: stockItem ? stockItem.warehouse : '',
          Quantity: stockItem ? stockItem.quantity : 0,
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
      { header: 'SKU', key: 'SKU', width: 20 },
      { header: 'Barcode', key: 'Barcode', width: 20 },
      { header: 'Warehouse', key: 'Warehouse', width: 25 },
      { header: 'Quantity', key: 'Quantity', width: 15 },
    ];

    // Query MongoDB with a cursor
    const cursor = Product.find({ isDeleted: false }).cursor();

    for await (const doc of cursor) {
      // A product now carries its own stock directly (no separate Variant to populate) - emit one
      // row per warehouse stock entry, or a single stock-less row for a service/unstocked product.
      const stockEntries = doc.stock && doc.stock.length > 0 ? doc.stock : [null];
      stockEntries.forEach(stockItem => {
        worksheet
          .addRow({
            ProductTitle: doc.title,
            Price: doc.price,
            SKU: doc.sku,
            Barcode: doc.barcode,
            Warehouse: stockItem ? stockItem.warehouse : '',
            Quantity: stockItem ? stockItem.quantity : 0,
          })
          .commit();
      });
    }

    // Finish writing the workbook
    await workbook.commit();
  } catch (error) {
    return next(new ApiError('Error exporting Excel', 500));
  }
};

module.exports = { exportLargeCsv, exportLargeExcel };