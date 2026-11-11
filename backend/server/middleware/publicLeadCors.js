const cors = require('cors');
const { isAllowedWebsiteOrigin } = require('../utils/crm/publicLeadOrigins');

// The CORS policy of the PUBLIC website lead-intake route (/api/v1/crm/public/*): no credentials (a
// public submission carries no cookies/auth) and an allow-list of the real marketing website origins
// (utils/crm/publicLeadOrigins.js, WEBSITE_ALLOWED_ORIGINS) - never a wildcard. One instance, used
// in two places:
//   - app.js applies it EARLY (where the global policy runs) so a preflight is answered before
//     ensureDbConnected - an OPTIONS request never needs the database;
//   - routes/crm/publicLeadRoute.js applies it again for the actual POST (idempotent headers).
module.exports = cors({
  origin(origin, callback) {
    if (isAllowedWebsiteOrigin(origin)) return callback(null, true);
    console.warn(`[CORS] Rejected public lead submission from disallowed origin: ${origin}`);
    return callback(null, false);
  },
  credentials: false,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Idempotency-Key'],
});
