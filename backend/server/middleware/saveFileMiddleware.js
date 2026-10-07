const cloudinary = require("cloudinary").v2;
const asyncHandler = require('express-async-handler');

const ApiError = require("../utils/apiError");

// Middleware to save a single file
exports.saveSingleFileMiddleware = (field) => 
  async (req, res, next) => {
    try {
        const file = req.file; // Directly access req.file
        console.log(file, field)
        if (file) {

            req.body
            req.body[field] = {
                url: file.path,
                publicId: file.filename // Use filename instead of fileName (common convention)
            };

            console.log('field', req.body[field]);

        }
        next(); // Always call next() even if no file is uploaded
    } catch (error) {
        console.error('Error saving single file:', error);
        res.json(new ApiError('internal server error!', 500))

    }
};

// Middleware to upload an array of files
exports.saveArrayFiles = (field = "") =>
  async (req, res, next) => {
    console.log('saveArrayFiles', field);
    try {
        const files = req.files; // Directly access req.files
        if (files && files.length > 0) {
            req.body[field] = files.map(file => ({
                url: file.path,
                publicId: file.filename // Use filename instead of fileName
            }));
        }
        console.log(req.body[field]);
        next(); // Always call next() even if no files are uploaded
    } catch (error) {
        console.error('Error uploading files:', error);
        res.json(new ApiError('Internal server error', 500 ));
    }
};

exports.updateFile = (field) => 
    asyncHandler(async (req, res, next) => {
        const id = req.params.id;
        const files = req.body[field];
        console.log('files', files);

        




    

    
});

exports.deleteFile = async (publicId) => {
    if (publicId) {
        const [err, res] = await safePromise(() => cloudinary.uploader.destroy(publicId));
        if (err) throw new ApiError('Internal server error', 500);
        return res;
    }
    }