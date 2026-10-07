const fs = require('fs');
const csv = require('csv-parse');
const path = require('path');

// Function to log unique subcategories
async function logUniqueSubCategories() {
    const csvFilePath = path.join(__dirname, '..', '..', 'inFlow_Inventory to system (4) (1).csv');
    
    try {
        // Create a Set to store unique subcategories
        const uniqueSubCategories = new Set();
        
        // Read and parse the CSV file
        const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
        
        // Parse CSV content
        const parser = csv.parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
        
        // Process each row
        for await (const record of parser) {
            if (record['sub cat']) {
                uniqueSubCategories.add(record['sub cat'].trim().toUpperCase());
            }
        }
        
        // Convert Set to sorted array
        const sortedSubCategories = Array.from(uniqueSubCategories).sort();
        
        // Log the results
        console.log('\nUnique Subcategories Found:');
        console.log('-------------------------');
        sortedSubCategories.forEach((category, index) => {
            console.log(`${index + 1}. ${category}`);
        });
        console.log(`\nTotal unique subcategories: ${sortedSubCategories.length}`);
        
        // Save to a log file
        const logContent = `Unique Subcategories (as of ${new Date().toISOString()}):\n` +
            '-------------------------\n' +
            sortedSubCategories.map((cat, i) => `${i + 1}. ${cat}`).join('\n') +
            `\n\nTotal: ${sortedSubCategories.length} subcategories`;
            
        fs.writeFileSync(path.join(__dirname, 'subcategories.log'), logContent);
        console.log('\nLog file has been saved to: subcategories.log');
        
    } catch (error) {
        console.error('Error processing CSV file:', error);
    }
}

// Run the function
logUniqueSubCategories();
