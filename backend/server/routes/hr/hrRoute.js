const express = require('express');
const authController = require('../../controller/user/authController');
const { requireHrAccess } = require('../../middleware/hrAccess');
const c = require('../../controller/hr/hrController');

// Reservia HR Portal API (HR Portal Developer Spec). Every route needs a portal login and an active HR
// membership with one of the spec's roles; each action's role is checked in the services.
const router = express.Router();
router.use(authController.protect, requireHrAccess);

router.get('/state', c.state);
router.post('/settings', c.saveSettings);
router.get('/settings/history', c.settingsHistory);
router.get('/audit', c.audit);

router.post('/employees', c.createEmployee);
router.route('/employees/:id').patch(c.updateEmployee).delete(c.deleteEmployee);
router.put('/employees/:id/documents/:k', c.saveDocument);
router.put('/employees/:id/exit', c.saveExit);

router.post('/attendance/day', c.saveDay);
router.put('/attendance/:empId/:month', c.saveDays);
router.post('/attendance/:empId/:month/fill', c.fillBlanks);
router.post('/timesheets/:empId/:month/approve', c.approveTimesheet);
router.post('/timesheets/:empId/:month/reopen', c.reopenTimesheet);

router.post('/visits', c.saveVisit);
router.route('/visits/:id').patch(c.saveVisit).delete(c.deleteVisit);
router.post('/expenses', c.saveExpense);
router.route('/expenses/:id').patch(c.saveExpense).delete(c.deleteExpense);
router.post('/expenses/:id/decide', c.decideExpense);
router.post('/forms', c.saveForm);
router.route('/forms/:id').patch(c.saveForm).delete(c.deleteForm);
router.post('/forms/:id/decide', c.decideForm);
router.get('/sheets/:ft', c.formPdf);

router.put('/targets/:empId/:month', c.setTarget);
router.post('/adjustments', c.addAdjustment);
router.delete('/adjustments/:id', c.deleteAdjustment);

router.post('/records/:kind', c.saveRecord);
router.route('/records/:kind/:id').patch(c.saveRecord).delete(c.deleteRecord);
router.post('/candidates/:id/hire', c.hireCandidate);
router.route('/example').post(c.loadExample).delete(c.removeExample);

router.post('/payroll/:month/submit', c.submit);
router.post('/payroll/:month/approve', c.approve);
router.post('/payroll/:month/send-back', c.sendBack);
router.post('/payroll/:month/close', c.close);
router.post('/payroll/:month/reopen', c.reopen);
router.post('/payroll/:month/erp', c.postErp);
router.post('/payroll/:month/email', c.email);
router.get('/payroll/:month/email-log', c.emailLog);
router.get('/payroll/:month/payslips/:empId.pdf', c.payslipPdf);
router.get('/payroll/:month/register.pdf', c.registerPdf);
router.get('/payroll/:month/register.csv', c.registerCsv);
router.get('/payroll/:month/journal.json', c.journalJson);
router.get('/payroll/:month/journal.csv', c.journalCsv);
router.get('/exports/:kind.csv', c.exportCsv);

module.exports = router;
