const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const asyncHandler = require('express-async-handler');
const factory = require('./handlersFactory');

const { uploadSingleFile } = require('../middleware/uploadImageMiddleware');
const AboutUs = require('../models/customization/aboutUsAndSubcatModel');
// Upload single image
exports.uploadLogo = uploadSingleFile('logo');

// Image processing
exports.resizeImage = asyncHandler(async (req, res, next) => {
  const filename = `logo-${uuidv4()}-${Date.now()}.png`;
  if (req.file) {
    await sharp(req.file.buffer)
      // .resize(600, 600)
      .toFormat('png')
      // .png({ quality: +process.env.IMAGE_QUALITY })
      .toFile(`uploads/customization/${filename}`);
    // Save image into db
    req.body.logo = filename;
  }
  next();
});

exports.getAboutUs = factory.getAll(AboutUs);

exports.createAboutUs = factory.createOne(AboutUs);

exports.updateAboutUs = factory.updateOne(AboutUs);

// exports.deleteAboutUs = factory.deleteOne(AboutUs);
