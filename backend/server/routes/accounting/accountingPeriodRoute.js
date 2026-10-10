const express = require('express');
const { check } = require('express-validator');
const authController = require('../../controller/user/authController');
const validatorMiddleware = require('../../middleware/validatorMiddleware');
const { getAccountingPeriods, closeAccountingPeriod, reopenAccountingPeriod } = require('../../controller/accounting/accountingPeriodController');

const router = express.Router();

// Closing and reopening accounting periods is an administrator control (like Sectors). Signed-in
// staff may read the list so the UI can show which months are closed.
router.use(authController.protect);

const periodValidators = [
  check('period').matches(/^\d{4}-(0[1-9]|1[0-2])$/).withMessage('The accounting period must be in YYYY-MM format.'),
  check('note').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  validatorMiddleware,
];

router.get('/', getAccountingPeriods);
router.post('/:period/close', authController.allowedTo('admin'), periodValidators, closeAccountingPeriod);
router.post('/:period/reopen', authController.allowedTo('admin'), periodValidators, reopenAccountingPeriod);

module.exports = router;
