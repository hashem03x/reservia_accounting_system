const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCrmAccess, requireCrmRole } = require('../../middleware/crmAccess');
const { requireKnownChannel, requireIntegrationKey, integrationRateLimit } = require('../../middleware/integrationAccess');
const controller = require('../../controller/crm/integrationController');
const { unifiedLeadValidators, createKeyValidators, keyIdValidator } = require('../../utils/validators/crm/integrationValidators');

// Reservia CRM - lead intake integrations (Change Request 2, section 4: "the five doors into the
// CRM"), mounted at /api/v1/crm/integrations.
//
//   Machine-to-machine (no user session - authorized by a per-channel key or a provider signature):
//     GET  /meta/webhook                Meta verification handshake (META_VERIFY_TOKEN)
//     POST /meta/webhook                Meta Lead Ads deliveries (X-Hub-Signature-256, META_APP_SECRET)
//     POST /google_ads/webhook          Google Ads lead form (google_key = a google_ads API key)
//     POST /:channel/leads              unified intake, any channel (X-Api-Key = that channel's key)
//   (The WhatsApp Cloud API webhook stays at /api/v1/crm/whatsapp/webhook, where Meta is already
//   pointed; the website form stays at /api/v1/crm/public/leads.)
//
//   Staff (CRM session): status/events for MD + Admin; creating/revoking keys is MD-only.

const router = express.Router();

router.get('/meta/webhook', controller.verifyMetaWebhook);
router.post('/meta/webhook', controller.receiveMetaWebhook);
router.post('/google_ads/webhook', integrationRateLimit, controller.receiveGoogleAdsWebhook);

const staff = [authController.protect, requireCrmAccess];
router.get('/status', ...staff, requireCrmRole('md', 'admin'), controller.getStatus);
router.get('/events', ...staff, requireCrmRole('md', 'admin'), controller.listEvents);
router.get('/keys', ...staff, requireCrmRole('md', 'admin'), controller.listKeys);
// CRM C6 - credentials (encrypted, never echoed), enable/disable, real connection tests, retries.
const knownSettingsChannel = (req, res, next) =>
  (['whatsapp', 'meta', 'tiktok', 'google_ads'].includes(req.params.channel) ? next() : res.status(404).json({ success: false, message: 'Unknown integration.' }));
router.put('/settings/:channel', ...staff, requireCrmRole('md'), knownSettingsChannel, controller.saveSettings);
router.patch('/settings/:channel/enabled', ...staff, requireCrmRole('md'), knownSettingsChannel, controller.setEnabled);
router.post('/settings/:channel/test', ...staff, requireCrmRole('md', 'admin'), knownSettingsChannel, controller.testSettings);
router.post('/events/:id/retry', ...staff, requireCrmRole('md', 'admin'), controller.retryEvent);
router.get('/google_ads/offline-conversions.csv', ...staff, requireCrmRole('md', 'admin'), controller.exportGoogleAdsConversions);
router.post('/keys', ...staff, requireCrmRole('md'), createKeyValidators, controller.createKey);
router.patch('/keys/:id/revoke', ...staff, requireCrmRole('md'), keyIdValidator, controller.revokeKey);

router.post('/:channel/leads', requireKnownChannel, integrationRateLimit, requireIntegrationKey, unifiedLeadValidators, controller.receiveUnifiedLead);

module.exports = router;
