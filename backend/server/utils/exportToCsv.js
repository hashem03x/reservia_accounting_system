const fastCsv = require('fast-csv');
const ApiError = require("./apiError");

const exportToCsv = async (res, filename, headers, data, options = {}) => {
  if (!data || !data.length) {
    throw new ApiError('No data available for export', 404);
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Add BOM for Excel to recognize UTF-8
  res.write('\ufeff');

  const csvStream = fastCsv.format({
    headers: true,
    writeHeaders: true,
    quote: '"',
    escape: '"',
    encoding: 'utf8'
  });

  csvStream.pipe(res);

  // Convert data array to objects with header keys
  const rowObjects = data.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });

  // Write all rows
  rowObjects.forEach(row => csvStream.write(row));

  // Add total row if provided
  if (options.totalRow) {
    // Add empty row as separator
    const separatorRow = {};
    headers.forEach(header => { separatorRow[header] = "" });
    csvStream.write(separatorRow);
    // Write total row
    const totalObj = {};
    headers.forEach((header, index) => {
      totalObj[header] = options.totalRow[index] || '';
    });
    csvStream.write(totalObj);
  }

  csvStream.end();
};

module.exports = exportToCsv;