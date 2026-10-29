const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const whatsappService = require('../../services/crm/whatsappService');

// GET /webhook - Meta's one-time subscription handshake. Must respond with the raw challenge
// string (not JSON) on success, and a plain 403 on any mismatch - this exact contract is Meta's
// own requirement, not this codebase's convention.
exports.verifyWebhook = (req, res) => {
  const challenge = whatsappService.verifySubscription({
    mode: req.query['hub.mode'],
    token: req.query['hub.verify_token'],
    challenge: req.query['hub.challenge'],
  });
  if (challenge === null) return res.status(403).send('Verification failed.');
  return res.status(200).send(challenge);
};

// POST /webhook - the actual message/status delivery. Always 200s quickly once the signature
// checks out (Meta retries aggressively on anything else), and processing itself is idempotent
// (services/crm/leadService.js's whatsappMessageId unique index), so a retried delivery is safe.
exports.receiveWebhook = asyncHandler(async (req, res, next) => {
  const signature = req.header('X-Hub-Signature-256');
  if (!whatsappService.verifySignature(req.rawBody, signature)) {
    return next(new ApiError('Invalid webhook signature.', 403));
  }
  await whatsappService.processWebhookPayload(req.body);
  return res.status(200).send('EVENT_RECEIVED');
});
