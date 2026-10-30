const rateLimit = require('express-rate-limit');

// Reservia CRM - a dedicated, stricter rate limit for the PUBLIC lead-intake endpoint, on top of
// (not instead of) app.js's existing global limiter (1000 req/min, shared across the whole API).
// A real visitor submits a quote form once, maybe twice after fixing a typo; this limit is sized
// for that, not for a marketing campaign's traffic volume - it gates REPEATED submissions from the
// same source, not page views or form opens (which this endpoint never sees).
//
// Configurable via PUBLIC_LEAD_RATE_LIMIT_MAX / PUBLIC_LEAD_RATE_LIMIT_WINDOW_MIN (minutes) so it
// can be tuned post-launch without a code change; sane defaults otherwise.
const windowMinutes = Math.max(1, Number(process.env.PUBLIC_LEAD_RATE_LIMIT_WINDOW_MIN) || 10);
const max = Math.max(1, Number(process.env.PUBLIC_LEAD_RATE_LIMIT_MAX) || 8);

module.exports = rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many submissions. Please try again later.' },
});
