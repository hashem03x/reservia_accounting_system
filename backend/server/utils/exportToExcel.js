const ExcelJS = require('exceljs');
const ApiError = require("./apiError");

const exportToExcel = async (res, filename, headers, data, options = {}) => {
  if (!data || !data.length) {
    throw new ApiError('No data available for export', 404);
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(filename);

  // Add headers
  worksheet.columns = headers.map(header => ({ header, key: header }));

  // Add data rows
  data.forEach(row => {
    const rowObj = {};
    headers.forEach((header, index) => {
      rowObj[header] = row[index];
    });
    worksheet.addRow(rowObj);
  });

  // Add empty row as separator
  worksheet.addRow({});

  // Add total row with formatting
  if (options.totalRow) {
    const totalRow = worksheet.addRow(
      headers.map((_, index) => options.totalRow[index] || '')
    );

    // Apply formatting to total row
    totalRow.eachCell(cell => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF0F0F0' }  // Gray background
      };
      cell.font = {
        bold: true
      };
    });
  }

  // Set response headers
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);

  // Write to response
  await workbook.xlsx.write(res);
};

module.exports = exportToExcel;
