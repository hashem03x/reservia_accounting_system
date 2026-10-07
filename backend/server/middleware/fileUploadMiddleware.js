const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const ApiError = require('../utils/apiError');
const {saveSingleFileMiddleware, saveArrayFiles} = require('./saveFileMiddleware')



// Configure Cloudinary
cloudinary.config(process.env.CLOUDINARY_URL);

/**
 * Create a Cloudinary storage instance for multer.
 * Allows storing images in multiple folders.
 * @param {string} folder - The folder name in Cloudinary.
 * @returns {CloudinaryStorage} - Configured Cloudinary storage.
 */

// const format = async (req, file) => file.mimetype.startsWith('image');

const createCloudinaryStorage = (folder) => {
   return new CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
            folder:`uploads/${folder}`, // Specify the folder in Cloudinary
            format: async (req, file) => file.mimetype.split('/')[1], // Only allow image formats
            public_id: (req, file) => {
                // Ensure the public ID is unique and safe
                const baseName = file.originalname.split('.')[0]; // Get the base name without extension
                const timestamp = Date.now(); // Add timestamp for uniqueness
                return `${baseName}-${timestamp}`; // Create a unique public ID
            },
            transformation: [
                { quality: 'auto:good' }, // Adjust quality automatically
                { fetch_format: 'auto' } // Use WebP or other formats for better performance
            ]
        }
    });
};

/**
 * Middleware to upload a single file.
 * @param {string} folder - Folder name in Cloudinary.
 * @param {string} fileName - Name of the file field in the request.
 * @returns {Function} - Multer middleware for single file upload.
 */
exports.uploadSingleFileONCloudinary= (folder, field) => {
      // step 1 upload image 
    return [
      multer({ storage: createCloudinaryStorage(folder) }).single(field),
      saveSingleFileMiddleware(field)
    ]
};

/**
 * Middleware to upload multiple files.
 * @param {string} folder - Folder name in Cloudinary.
 * @param {string} filesName - Name of the file field in the request.
 * @param {number} numberOfFiles - Maximum number of files to upload.
 * @returns {Function} - Multer middleware for multiple file uploads.
 */
exports.uploadFilesOnCloudinary = (folder, field, numberOfField = 10) => {
    const storage = createCloudinaryStorage(`uploads/${folder}`);
    return[ 
        multer({ storage }).array(field, numberOfField),
        saveArrayFiles(field)
    ];
};

/**
 * Middleware to upload multiple fields.
 * @param {string} folder - Folder name in Cloudinary.
 * @param {Object} fields - Fields in the request to upload.
 * @returns {Function} - Multer middleware for multiple field uploads.
 */

exports.uploadFieldsOnCloudinary = (folder, field) => {
    const storage = createCloudinaryStorage(`uploads/${folder}`);
    return [
        multer({ storage }).fields(field),
        saveArrayFiles(field)
    ];
};


exports.destorySingleFileOnCloudinary = async (publicId) =>{
  if(publicId) {
      const [err, res] = await safePromise(
          () => cloudinary.uploader.destroy(publicId));

         if(err) throw new ApiError('inernal server error ', 500)

        return res;
    }
}



// const saveFileMiddleware = (req, res, next)

/** in this way upload fiel from mechin and add to cloudinary this way not efficiency
 * Upload an image to Cloudinary and optimize it.
 * @param {string} fileUpload - URL or path of the file to upload.
 * @param {string} publicId - Public ID for the uploaded image.
 * @returns {Promise<void>} - Promise resolving when the upload is complete.
 */
// const uploadFileOnCloudinary = async (fileUpload, publicId) => {
//     try {
//         // Step 1: Upload the image
//         const uploadResult = await cloudinary.uploader.upload(fileUpload, {
//             public_id: publicId,
//         });

//         console.log(uploadResult);

//         // Step 2: Optimize delivery by resizing and applying auto-format and auto-quality
//         const optimizeUrl = cloudinary.url(publicId, {
//             fetch_format: 'auto',
//             quality: 'auto'
//         });

//         console.log(optimizeUrl);

//         // Step 3: Transform the image: auto-crop to square aspect ratio
//         const autoCropUrl = cloudinary.url(publicId, {
//             crop: 'auto',
//             gravity: 'auto',
//             width: 500,
//             height: 500,
//         });

//         console.log(autoCropUrl);
//     } catch (error) {
//         console.error('Error uploading file to Cloudinary:', error);
//     }
// };