const { check } = require('express-validator');

const Vendor = require('../../models/vendor/vendor');
const validatorMiddleware = require('../../middleware/validatorMiddleware');

// CREATE: Validate required fields for creating a new vendor
const createVendorValidators = [

    check('name')
        .notEmpty().withMessage('Name is required')
        .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters')
        .matches(/^[a-zA-Z\s\u0600-\u06FF]+$/).withMessage('Name must only contain letters and spaces'),

     check('contact.phone')
          .optional()
    //    .notEmpty().withMessage('Phone number is required')
       .matches(/^(?:\+20|0020|20)?(011|012|010|015)[0-9]{8}$/).withMessage('Invalid phone number format'),

     check('contact.email')
     .optional()
        // .op().withMessage('Email is required')
        .isEmail().withMessage('Please provide a valid email address')
        .normalizeEmail()
        .custom((value) => {
            if (!value) {
                req.body.contact.email = undefined;
                return true;
            }
            return Vendor.findOne({
                'contact.email': value
            }).then((vendor) => {
                if (vendor) {
                    return Promise.reject('Email is already in use');
                }
            });
        }),

    check('balance')
        .optional()
        .isInt({ min: 0 }).withMessage('Balance must be a non-negative integer'),

    check('address.street')
        .optional()
        .isString().withMessage('Street address must be a string')
        .isLength({ max: 100 }).withMessage('Street address cannot exceed 100 characters'),

    check('address.city')
        .optional()
        .isString().withMessage('City must be a string')
        .matches(/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/).withMessage('City name must only contain letters and spaces')
        .isLength({ max: 50 }).withMessage('City cannot exceed 50 characters'),

    check('address.state')
        .optional()
        .isString().withMessage('State must be a string')
        .matches(/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/).withMessage('State name must only contain letters and spaces')
        .isLength({ max: 50 }).withMessage('State cannot exceed 50 characters'),

    check('address.country')
        .optional()
        .isString().withMessage('Country must be a string')
        .matches(/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/).withMessage('Country name must only contain letters and spaces')
        .isLength({ max: 50 }).withMessage('Country cannot exceed 50 characters'),

    check('address.postalCode')
        .optional()
        .matches(/^\d{5}(-\d{4})?$/).withMessage('Postal code must be valid (e.g., 12345 or 12345-6789)'),

    check('paymentTerms')
        .optional()
        .isIn(['Net 15', 'Net 30', 'Net 45', 'Net 60']).withMessage('Invalid payment term. Choose from "Net 15", "Net 30", "Net 45", "Net 60"'),

    check('isActive')
        .optional()
        .isBoolean().withMessage('isActive must be a boolean'),
        validatorMiddleware
];

// UPDATE: Make validators optional since any field may be updated
const updateVendorValidators = [
    check('name').optional().notEmpty().withMessage('Name cannot be empty'),
    check('email').optional().isEmail().withMessage('Please provide a valid email'),
    check('phone').optional({ nullable: true }).isMobilePhone().withMessage('Please provide a valid phone number'),
    // Add other validators as needed
  ];
  
// DELETE: Only require the vendor ID to delete a vendor
const deleteVendorValidators = [
    check('id')
        .notEmpty().withMessage('Vendor ID is required')
        .isMongoId().withMessage('Invalid vendor ID'),
        validatorMiddleware
];

// READ: Validate read request if using parameters (e.g., vendor ID for specific vendor)
const readVendorValidators = [
    check('id')
        .optional()
        .isMongoId().withMessage('Invalid vendor ID'),
    validatorMiddleware
];

module.exports = {
    createVendorValidators,
    updateVendorValidators,
    deleteVendorValidators,
    readVendorValidators
};
