const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCommercialAccess } = require('../../middleware/commercialAccess');
const handoffController = require('../../controller/commercial/handoffController');

// Mounted at /api/v1/commercial/handoff - read-only view of the CRM -> Commercial sync for a deal.
// (The sync itself is triggered by the CRM stage change; retries are on the CRM lead:
// POST /api/v1/crm/leads/:id/commercial-sync.)
const router = express.Router();

router.use(authController.protect, requireCommercialAccess);
router.get('/:projectId/sync-events', handoffController.getProjectSyncEvents);

module.exports = router;
