const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCrmAccess } = require('../../middleware/crmAccess');
const quotationController = require('../../controller/crm/quotationController');

// Reservia CRM - Phase 2 "Quotations" (due 2026-12-10). Mounted at /api/v1/crm/quotations.
const router = express.Router();

router.use(authController.protect, requireCrmAccess);

router.route('/leads/:leadId').get(quotationController.listQuotationsForLead).post(quotationController.createQuotation);
router.post('/:id/send', quotationController.sendQuotation);
router.post('/:id/accept', quotationController.acceptQuotation);

module.exports = router;
