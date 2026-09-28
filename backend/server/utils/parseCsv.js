const csv = require('csv-parse');
const fs = require('fs').promises;

const parseCsv = async filePath => {
  try {
    // Read file content
    console.log(`Reading file: ${filePath}`);
    let fileContent = await fs.readFile(filePath, 'utf-8');
    console.log(`File size: ${fileContent.length} bytes`);

    // Remove BOM character if present
    if (fileContent.charCodeAt(0) === 0xfeff) {
      fileContent = fileContent.substring(1);
      console.log('Removed BOM character from CSV file');
    }

    return new Promise((resolve, reject) => {
      // Set a higher memory limit for large files
      const options = {
        columns: header => header.map(column => column.trim()),
        trim: true,
        skip_empty_lines: true,
        relax_quotes: true,
        relax_column_count: true,
        skip_records_with_error: true,
        // Add a comment character to ignore comment lines
        comment: '#',
        // Increase buffer size for better performance with large files
        max_record_size: 1024 * 1024, // 1MB per record
      };

      csv.parse(fileContent, options, (err, data) => {
        if (err) {
          console.error('CSV parsing error:', err);
          reject(err);
          return;
        }

        // Log the headers for debugging
        if (data && data.length > 0) {
          console.log('CSV Headers:', Object.keys(data[0]));
          console.log(`Parsed ${data.length} records from CSV`);
        } else {
          console.warn('No data found in CSV file');
        }

        resolve(data);
      });
    });
  } catch (error) {
    console.error('Error reading or parsing CSV file:', error);
    throw error;
  }
};

module.exports = parseCsv;
