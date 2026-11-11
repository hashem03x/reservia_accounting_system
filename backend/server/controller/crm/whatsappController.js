const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const whatsappService = require('../../services/crm/whatsappService');
const settings = require('../../services/crm/integrationSettingsService');

// WhatsApp Business (Cloud API) webhook. The verify token and app secret come from the Integrations
// page (encrypted) or the WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET environment variables.

// GET /webhook - Meta's one-time subscription handshake. Must respond with the raw challenge
// string (not JSON) on success, and a plain 403 on any mismatch - Meta's own contract.
exports.verifyWebhook = asyncHandler(async (req, res) => {
  if (!(await settings.isEnabled('whatsapp'))) return res.status(403).send('Integration disabled.');
  const expected = await settings.getValue('whatsapp', 'verifyToken');
  const challenge = whatsappService.verifySubscription(
    { mode: req.query['hub.mode'], token: req.query['hub.verify_token'], challenge: req.query['hub.challenge'] },
    expected
  );
  if (challenge === null) return res.status(403).send('Verification failed.');
  await settings.recordWebhookVerified('whatsapp');
  return res.status(200).send(challenge);
});

// POST /webhook - message delivery. Signature first (X-Hub-Signature-256 over the raw body);
// processing is idempotent on the WhatsApp message id, so Meta's retries are safe. A processing
// failure answers 500 so Meta redelivers (no message is lost to a transient DB error).
exports.receiveWebhook = asyncHandler(async (req, res, next) => {
  if (!(await settings.isEnabled('whatsapp'))) return res.status(200).send('IGNORED_DISABLED');
  const secret = await settings.getValue('whatsapp', 'appSecret');
  if (!whatsappService.verifySignature(req.rawBody, req.header('X-Hub-Signature-256'), secret)) {
    return next(new ApiError('Invalid webhook signature.', 403));
  }
  try {
    await whatsappService.processWebhookPayload(req.body);
  } catch (err) {
    await settings.recordDeliveryError('whatsapp', `Webhook processing failed: ${err.message}`);
    throw err;
  }
  return res.status(200).send('EVENT_RECEIVED');
});
