const { check } = require('express-validator');
const Project = require('../../models/project/projectModel');
const User = require('../../models/userModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { ProjectStatuses, ProjectSectors } = require('../accountingConstants');

// Fast pre-check for Average Cost lines - the model's pre('validate') hook (projectModel.js) is
// the real backstop that re-verifies this no matter which code path writes to the document, but
// failing fast here gives a clean 400 before a save is even attempted. Shared by create/update
// since the rule is identical either way.
const averageCostLines = check('averageCostLines')
  .optional({ nullable: true })
  .isArray()
  .withMessage('averageCostLines must be an array')
  .custom(async lines => {
    if (!Array.isArray(lines) || lines.length === 0) return true;

    const accountIds = [];
    for (const line of lines) {
      if (!line || typeof line !== 'object' || !line.account) {
        throw new Error('Each Average Cost line must reference an account.');
      }
      if (typeof line.amount !== 'number' && isNaN(Number(line.amount))) {
        throw new Error('Each Average Cost line must have a numeric amount.');
      }
      if (Number(line.amount) <= 0) {
        throw new Error('Average Cost line amounts must be greater than 0.');
      }
      accountIds.push(String(line.account));
    }

    const uniqueIds = new Set(accountIds);
    if (uniqueIds.size !== accountIds.length) {
      throw new Error("Each account can only appear once in a project's Average Cost lines.");
    }

    const accounts = await ChartOfAccount.find({ _id: { $in: Array.from(uniqueIds) } }).lean();
    if (accounts.length !== uniqueIds.size) {
      throw new Error('One of the selected Average Cost accounts does not exist.');
    }
    const ineligible = accounts.find(a => a.type !== 'cogs');
    if (ineligible) {
      throw new Error(`Account "${ineligible.code} - ${ineligible.name}" is not eligible for Average Cost (must be a COGS account).`);
    }

    return true;
  });

const customerExistsCheck = value =>
  User.findById(value).then(user => {
    if (!user) return Promise.reject(new Error('Customer does not exist.'));
  });

// Required on create (docs section "Project UI" - the Advanced Payments feature depends on every
// new project having exactly one customer) - still optional on update so existing customer-less
// projects (e.g. the "V01" project created by the accounting CSV import, whose source data had no
// customer at all) remain readable/editable without being forced to backfill one immediately.
const customerRequired = check('customer')
  .notEmpty()
  .withMessage('Customer is required')
  .isMongoId()
  .withMessage('Invalid customer id')
  .custom(customerExistsCheck);

const customerOptional = check('customer').optional({ nullable: true }).isMongoId().withMessage('Invalid customer id').custom(customerExistsCheck);

// Shared by create/update - only meaningful when BOTH dates are present in the same request body.
// This is a fast, friendly pre-check; the model's own pre('validate') hook
// (models/project/projectModel.js) is the actual backstop for every case, including a partial
// update that only changes one of the two dates against the other's already-saved value, which
// this request-shape-only check cannot see.
const deliveryNotBeforeStart = check('deliveryDate').custom((value, { req }) => {
  if (!value || !req.body.startDate) return true;
  if (new Date(value) < new Date(req.body.startDate)) {
    throw new Error('Delivery date cannot be before the start date.');
  }
  return true;
});

const createProjectValidators = [
  check('projectNumber')
    .notEmpty()
    .withMessage('Project number is required')
    .isString()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Project number cannot exceed 50 characters')
    .custom(value =>
      Project.findOne({ projectNumber: value }).then(project => {
        if (project) return Promise.reject(new Error('Project number already exists.'));
      })
    ),

  check('name').optional().isString().trim().isLength({ max: 150 }),
  check('description').optional().isString().trim().isLength({ max: 1000 }),

  check('contractValue').notEmpty().withMessage('Contract value is required').isFloat({ min: 0.01 }).withMessage('Contract value must be greater than 0'),

  check('projectManager')
    .notEmpty()
    .withMessage('Project manager is required')
    .isMongoId()
    .withMessage('Invalid project manager id')
    .custom(value =>
      User.findById(value).then(user => {
        if (!user) return Promise.reject(new Error('Project manager does not exist.'));
      })
    ),

  check('startDate').notEmpty().withMessage('Start date is required').isISO8601().withMessage('Invalid start date'),
  check('deliveryDate').notEmpty().withMessage('Delivery date is required').isISO8601().withMessage('Invalid delivery date'),
  deliveryNotBeforeStart,

  customerRequired,
  averageCostLines,

  check('status').optional().isIn(ProjectStatuses),

  check('sector')
    .optional({ nullable: true })
    .isIn(ProjectSectors)
    .withMessage(`Sector must be one of: ${ProjectSectors.join(', ')}`),

  validatorMiddleware,
];

const updateProjectValidators = [
  // projectNumber is immutable through this endpoint on purpose - see projectController.js.
  check('name').optional().isString().trim().isLength({ max: 150 }),
  check('description').optional().isString().trim().isLength({ max: 1000 }),
  check('contractValue').optional().isFloat({ min: 0.01 }).withMessage('Contract value must be greater than 0'),
  check('projectManager')
    .optional()
    .isMongoId()
    .withMessage('Invalid project manager id')
    .custom(value =>
      User.findById(value).then(user => {
        if (!user) return Promise.reject(new Error('Project manager does not exist.'));
      })
    ),
  check('startDate').optional().isISO8601().withMessage('Invalid start date'),
  check('deliveryDate').optional().isISO8601().withMessage('Invalid delivery date'),
  deliveryNotBeforeStart,

  customerOptional,
  averageCostLines,

  check('status').optional().isIn(ProjectStatuses),

  check('sector')
    .optional({ nullable: true })
    .isIn(ProjectSectors)
    .withMessage(`Sector must be one of: ${ProjectSectors.join(', ')}`),

  validatorMiddleware,
];

module.exports = { createProjectValidators, updateProjectValidators };
