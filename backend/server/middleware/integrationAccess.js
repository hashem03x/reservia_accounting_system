const rateLimit = require('express-rate-limit');
const ApiError = require('../utils/apiError');
const { INTEGRATION_CHANNEL_IDS } = require('../utils/crm/constants');
const { verifyKey, presentedKeyFrom } = require('../services/crm/integrationKeyService');

// Reservia CRM - gates for the external lead-intake endpoints (Change Request 2, item 6).

/** Rejects an unknown :channel before any key lookup. */
exports.requireKnownChannel = (req, res, next) => {
  if (!INTEGRATION_CHANNEL_IDS.includes(req.params.channel)) {
    return next(new ApiError(`Unknown integration channel. Use one of: ${INTEGRATION_CHANNEL_IDS.join(', ')}.`, 404));
  }
  return next();
};

/**
 * Requires a valid, active API key FOR THIS CHANNEL (X-Api-Key or Authorization: Bearer). Every
 * failure answers the same 401 - a caller can't learn whether the key exists, is revoked, or
 * belongs to another channel. The key itself is never logged.
 */
exports.requireIntegrationKey = async (req, res, next) => {
  try {
    const record = await verifyKey(presentedKeyFrom(req), req.params.channel);
    if (!record) {
      console.warn(`[CRM intake] rejected request for channel=${req.params.channel}: missing or invalid API key`);
      return next(new ApiError('Missing or invalid API key for this channel.', 401));
    }
    req.integrationKey = { id: record._id, channel: record.channel };
    return next();
  } catch (err) {
    return next(err);
  }
};

// Per channel + caller. Generous for real webhook bursts (a campaign launch), tight enough to stop
// a runaway retry loop or a leaked key being used to flood the pipeline. Tunable without a deploy.
const windowMinutes = Math.max(1, Number(process.env.CRM_INTEGRATION_RATE_LIMIT_WINDOW_MIN) || 1);
const max = Math.max(1, Number(process.env.CRM_INTEGRATION_RATE_LIMIT_MAX) || 120);

exports.integrationRateLimit = rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `${req.params.channel || req.path}:${req.ip}`,
  message: { success: false, message: 'Too many lead submissions from this source. Slow down and retry later.' },
});
