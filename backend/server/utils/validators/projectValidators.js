const { check } = require('express-validator');
const Project = require('../../models/project/projectModel');
const User = require('../../models/userModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { ProjectStatuses, ProjectSectors } = require('../accountingConstants');

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

  check('status').optional().isIn(ProjectStatuses),

  check('sector')
    .optional({ nullable: true })
    .isIn(ProjectSectors)
    .withMessage(`Sector must be one of: ${ProjectSectors.join(', ')}`),

  validatorMiddleware,
];

module.exports = { createProjectValidators, updateProjectValidators };
