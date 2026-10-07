const multer = require('multer');
const ApiError = require('../utils/apiError');
const path = require('path');

const multerOptions = () => {
  // store file or image in memeoryStorage
  const multerSorage = multer.memoryStorage();

  // do filters on file to check it is image only if not image return error this file not avaiable
  const multerFileFilter = (req, file, cd) => {
    if (file.mimetype.startsWith('image')) {
      cd(null, true);
    } else {
      cd(new ApiError(`Only Images allowed`, 400), false);
    }
  };

  // step 3 config muluter with this options
  const upload = multer({
    storage: multerSorage,
    fileFilter: multerFileFilter,
  });

  return upload;
};

const uploadTempFile = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/import');
    },
    filename: (req, file, cb) => {
      // Generate unique filename with original extension
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Only .csv, .xls, or .xlsx files are allowed'), false);
    }
    cb(null, true);
  },
});

// {fileUplaod , publicId}
exports.uploadSingleFile = fileName => multerOptions().single(fileName);

exports.uploadMixOfFiles = arrayOfFields => multerOptions().fields(arrayOfFields);

// {fileUplaod , publicId}
exports.uploadTempFile = fileName => uploadTempFile.single(fileName);
// exports.uploadArrayOfFiles = (fileName, maxCount) => multerOptions().array(fileName, maxCount);
