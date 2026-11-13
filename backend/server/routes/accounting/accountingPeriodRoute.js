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

// ERP CHG-09: year-end close / reopen (administrators; a reopen needs a reason). Declared before
// /:period so "years" is never read as a period.
const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const yearEnd = require('../../services/accounting/yearEndCloseService');
const { logAccountingEvent } = require('../../utils/accountingLogger');

router.get('/years', asyncHandler(async (req, res) => res.status(200).json(apiResponse('Years', true, await yearEnd.listYears()))));
router.get('/years/:year/preview', authController.allowedTo('admin'), asyncHandler(async (req, res) => res.status(200).json(apiResponse('Year-end close preview', true, await yearEnd.previewClose(req.params.year)))));
router.post(
  '/years/:year/close',
  authController.allowedTo('admin'),
  asyncHandler(async (req, res) => {
    const doc = await yearEnd.closeYear(req.params.year, req.user, req.body?.note);
    logAccountingEvent('FISCAL_YEAR_CLOSED', { year: doc.year, profit: doc.profit, userId: req.user._id, requestId: req.id });
    res.status(200).json(apiResponse(`${doc.year} closed`, true, doc));
  })
);
router.post(
  '/years/:year/reopen',
  authController.allowedTo('admin'),
  asyncHandler(async (req, res) => {
    const doc = await yearEnd.reopenYear(req.params.year, req.user, req.body?.note);
    logAccountingEvent('FISCAL_YEAR_REOPENED', { year: doc.year, userId: req.user._id, requestId: req.id });
    res.status(200).json(apiResponse(`${doc.year} reopened`, true, doc));
  })
);

router.get('/', getAccountingPeriods);
router.post('/:period/close', authController.allowedTo('admin'), periodValidators, closeAccountingPeriod);
router.post('/:period/reopen', authController.allowedTo('admin'), periodValidators, reopenAccountingPeriod);

module.exports = router;
