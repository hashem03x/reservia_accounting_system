const { check } = require('express-validator');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { AccountTypes } = require('../accountingConstants');

// Fast request checks for /account-parent-groups. Business rules (duplicate names in any spelling,
// system-default protection, type changes while accounts use the group, delete protection) are
// decided by services/accounting/accountParentGroupService.js and backed by the model's own
// validation and unique indexes.

const idParam = check('id').isMongoId().withMessage('Invalid parent group id');

const nameRule = (field, label, { required }) => {
  const chain = required ? check(field).exists({ checkNull: true }).withMessage(`${label} is required`).bail() : check(field).optional();
  return chain
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .isLength({ max: 100 })
    .withMessage(`${label} cannot exceed 100 characters`);
};

const typeRule = ({ required }) =>
  (required ? check('type').exists({ checkNull: true }).withMessage('Account type is required').bail() : check('type').optional())
    .isIn(AccountTypes)
    .withMessage(`Account type must be one of: ${AccountTypes.join(', ')}`);

const common = [
  check('description').optional({ nullable: true }).isString().withMessage('Description must be text').bail().trim().isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
  check('sortOrder').optional({ nullable: true, checkFalsy: true }).isInt({ min: 0, max: 1000000 }).withMessage('Sort order must be a whole number of 0 or more').toInt(),
  check('isActive').optional().isBoolean({ strict: true }).withMessage('isActive must be true or false'),
];

exports.getAccountParentGroupValidator = [idParam, validatorMiddleware];

exports.listAccountParentGroupsValidator = [
  check('status').optional().isIn(['all', 'active', 'inactive']).withMessage('Status must be all, active or inactive'),
  check('type').optional({ checkFalsy: true }).isIn(AccountTypes).withMessage(`Account type must be one of: ${AccountTypes.join(', ')}`),
  check('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
  check('limit').optional().isInt({ min: 1, max: 200 }).withMessage('Invalid limit'),
  validatorMiddleware,
];

exports.createAccountParentGroupValidator = [
  nameRule('nameEn', 'English group name', { required: true }),
  nameRule('nameAr', 'Arabic group name', { required: true }),
  typeRule({ required: true }),
  ...common,
  validatorMiddleware,
];

exports.updateAccountParentGroupValidator = [
  idParam,
  nameRule('nameEn', 'English group name', { required: false }),
  nameRule('nameAr', 'Arabic group name', { required: false }),
  typeRule({ required: false }),
  check('isSystemDefault').not().exists().withMessage('The system-default flag cannot be changed'),
  ...common,
  validatorMiddleware,
];

exports.setAccountParentGroupStatusValidator = [
  idParam,
  check('isActive').exists({ checkNull: true }).withMessage('isActive is required').bail().isBoolean({ strict: true }).withMessage('isActive must be true or false'),
  validatorMiddleware,
];

exports.deleteAccountParentGroupValidator = [idParam, validatorMiddleware];
