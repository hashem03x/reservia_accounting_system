const { check } = require('express-validator');
const Project = require('../../models/project/projectModel');
const User = require('../../models/userModel');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { ProjectStatuses } = require('../accountingConstants');

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

  check('projectAmount').notEmpty().withMessage('Project amount is required').isFloat({ min: 0.01 }).withMessage('Project amount must be greater than 0'),

  check('executor')
    .notEmpty()
    .withMessage('Executor is required')
    .isMongoId()
    .withMessage('Invalid executor id')
    .custom(value =>
      User.findById(value).then(user => {
        if (!user) return Promise.reject(new Error('Executor does not exist.'));
      })
    ),

  check('status').optional().isIn(ProjectStatuses),

  validatorMiddleware,
];

const updateProjectValidators = [
  // projectNumber is immutable through this endpoint on purpose - see projectController.js.
  check('name').optional().isString().trim().isLength({ max: 150 }),
  check('description').optional().isString().trim().isLength({ max: 1000 }),
  check('projectAmount').optional().isFloat({ min: 0.01 }).withMessage('Project amount must be greater than 0'),
  check('executor')
    .optional()
    .isMongoId()
    .withMessage('Invalid executor id')
    .custom(value =>
      User.findById(value).then(user => {
        if (!user) return Promise.reject(new Error('Executor does not exist.'));
      })
    ),
  check('status').optional().isIn(ProjectStatuses),

  validatorMiddleware,
];

module.exports = { createProjectValidators, updateProjectValidators };
