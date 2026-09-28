const fs = require('fs');

const asyncHandler = require('express-async-handler');
const json2csv = require('json2csv').parse;

exports.createCSVFile = asyncHandler(async (req, res, next) => {
    try {
        const { data } = req.body;
        const fields = ['title', 'price', 'description', 'colors', 'category', 'subcategory', 'barcode', 'season', 'imageCover', 'brand'];
        const opts = { fields };
        const csv = json2csv(data, opts);
        const filePath = path.join(__dirname, '../../public/csv/products.csv');
        fs.writeFileSync(filePath, csv);
        res.status(200).json(apiResponse(true, 'CSV file created successfully', filePath));
    } catch (error) {
        next(new ApiError(error.message, 400));
    }
});