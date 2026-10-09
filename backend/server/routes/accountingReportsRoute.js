const express = require('express');
const { check } = require('express-validator');

const authController = require('../controller/user/authController');
const { checkUserPermissions } = require('../middleware/hasPermission');
const validatorMiddleware = require('../middleware/validatorMiddleware');
const { Resources, Actions } = require('../utils/appConstant');
const {
  getCatalog,
  getReport,
  exportReport,
  getDisclosureNotes,
  createDisclosureNote,
  updateDisclosureNote,
  deleteDisclosureNote,
} = require('../controller/reports/accountingReportsController');

const router = express.Router();

// Same access as the existing Reports module: signed in + the `reports` permission.
router.use(authController.protect);
router.use(checkUserPermissions({ resource: Resources.reports, action: Actions.read }));

const noteValidators = (creating) => [
  ...(creating ? [check('title').notEmpty().withMessage('Title is required'), check('body').notEmpty().withMessage('Text is required')] : []),
  check('title').optional().isString().trim().isLength({ max: 200 }),
  check('titleAr').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  check('body').optional().isString().trim().isLength({ max: 10000 }),
  check('bodyAr').optional({ nullable: true }).isString().trim().isLength({ max: 10000 }),
  check('sortOrder').optional().isInt().withMessage('Order must be a whole number'),
  check('isActive').optional().isBoolean(),
  validatorMiddleware,
];

// Registered before '/:key' so they are never matched as a report key ('notes' is not one).
router.get('/', getCatalog);
router
  .route('/notes')
  .get(getDisclosureNotes)
  .post(checkUserPermissions({ resource: Resources.reports, action: Actions.create }), noteValidators(true), createDisclosureNote);
router
  .route('/notes/:id')
  .patch(checkUserPermissions({ resource: Resources.reports, action: Actions.update }), noteValidators(false), updateDisclosureNote)
  .delete(checkUserPermissions({ resource: Resources.reports, action: Actions.delete }), deleteDisclosureNote);

router.get('/:key', getReport);
router.get('/:key/export', exportReport);

module.exports = router;
