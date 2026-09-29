const { body } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const User = require('../../models/userModel');

// Shared by create/update - every field is optional (tax/bank info is optional business data),
// only their shape/length is checked when provided.
const taxAndBankInfoValidators = [
  body('taxInfo.taxRegistrationNumber').optional().isString().trim().isLength({ max: 50 }),
  body('taxInfo.commercialRegistrationNumber').optional().isString().trim().isLength({ max: 50 }),
  body('bankInfo.bankName').optional().isString().trim().isLength({ max: 100 }),
  body('bankInfo.branch').optional().isString().trim().isLength({ max: 100 }),
  body('bankInfo.accountNumber').optional().isString().trim().isLength({ max: 50 }),
  body('bankInfo.iban').optional().isString().trim().isLength({ max: 50 }),
];

exports.createCustomerValidate = [
  body('name').notEmpty().withMessage('Name is required'),
  ...taxAndBankInfoValidators,

  body('contact.phone')
    .notEmpty()
    .withMessage('Phone number is required.')
    .custom(async (val, { req }) => {
      await User.findOne({ phone: val }).then(user => {
        if (user) {
          return Promise.reject(new Error(`Phone number is already in use`));
        }
      });
    }),

  body('contact.email')
    .optional()
    .isEmail()
    .withMessage('Invalid email address')
    .custom(async (val, { req }) => {
      await User.findOne({ email: val }).then(user => {
        if (user) {
          return Promise.reject(new Error(`Email is already in use`));
        }
      });
    }),

  // body('offlineAddress')
  // .notEmpty()
  // .withMessage('Offline address is required')
  // .custom(value => {
  //     if (value) {
  // if (typeof value !== 'object') {
  //     throw new Error('Offline address must be an object');
  // }
  // const { street, city, postalCode } = value;
  // if(!street || !city  || !postalCode) {
  //     throw new Error('Street, city, country, and postal code are required');
  // }

  // if (street && street.length > 100) {
  //     throw new Error('Street address cannot exceed 100 characters');
  // }
  // if (city && !/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/.test(city)) {
  //     throw new Error('City name must only contain letters and spaces');
  // }
  // if && (!/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/.tes) |.length > 50)) {
  //     throw new Error name must only contain letters and spaces and cannot exceed 50 characters');
  // }
  // if (country && !/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/.test(country)) {
  //     throw new Error('Country name must only contain letters and spaces');
  // }
  //         if (postalCode && !/^\d{5}(-\d{4})?$/.test(postalCode)) {
  //             throw new Error('Postal code must be valid (e.g., 12345 or 12345-6789)');
  //         }
  //     }
  //     return true;
  // }),
  // body('offlineAddress.postalCode').notEmpty().withMessage('Postal code is required'),
  // body('offlineAddress.city').notEmpty().withMessage('City is required'),
  // body('offlineAddress.state').notEmpty().withMessage('State is required'),

  validatorMiddleware,
];

exports.updateCustomerValidate = [
  body('name').optional(),
  ...taxAndBankInfoValidators,
  body('contact.phone')
    .optional()
    .custom(async (val, { req }) => {
      await User.findOne({ phone: val, _id: { $ne: req.params.id } }).then(user => {
        if (user) {
          return Promise.reject(new Error(`Phone number is already in use`));
        }
      });
    }),

  body('contact.email')
    .optional()
    .isEmail()
    .withMessage('invalid email address')
    .custom(async (val, { req }) => {
      await User.findOne({ email: val, _id: { $ne: req.params.id } }).then(user => {
        if (user) {
          return Promise.reject(new Error(`E-mail is already in use`));
        }
      });
    }),

  // body('offlineAddress')
  // .optional()
  // .custom(value => {
  //     if (value) {
  //         if (typeof value !== 'object') {
  //             throw new Error('Offline address must be an object');
  //         }
  //         const { street, city, state, country, postalCode } = value;

  //         if (street && street.length > 100) {
  //             throw new Error('Street address cannot exceed 100 characters');
  //         }
  //         if (city && !/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/.test(city)) {
  //             throw new Error('City name must only contain letters and spaces');
  //         }
  //         if (state && (!/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/.test(state) || state.length > 50)) {
  //             throw new Error('State name must only contain letters and spaces and cannot exceed 50 characters');
  //         }
  //         if (country && !/^[a-zA-Z\u0621-\u064A\u0660-\u0669\s]+$/.test(country)) {
  //             throw new Error('Country name must only contain letters and spaces');
  //         }
  //         if (postalCode && !/^\d{5}(-\d{4})?$/.test(postalCode)) {
  //             throw new Error('Postal code must be valid (e.g., 12345 or 12345-6789)');
  //         }
  //     }
  //     return true;
  // }),
  // body('offlineAddress.postalCode').optional(),
  // body('offlineAddress.city').optional(),
  // body('offlineAddress.state').optional(),

  validatorMiddleware,
];
