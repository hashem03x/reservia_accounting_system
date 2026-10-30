const express = require('express');
const cors = require('cors');
const { PUBLIC_LEAD_ALLOWED_ORIGINS, isAllowedWebsiteOrigin } = require('../../utils/crm/publicLeadOrigins');
const publicLeadRateLimit = require('../../middleware/publicLeadRateLimit');
const { publicLeadValidators } = require('../../utils/validators/crm/publicLeadValidators');
const publicLeadController = require('../../controller/crm/publicLeadController');

// Reservia CRM - the public website's lead-capture call. Deliberately NOT behind
// authController.protect/requireCrmAccess (there is no logged-in user on the public marketing
// site) and deliberately NOT covered by app.js's global cors() allow-list (that one is
// `credentials: true` for the Central Portal frontend only - see its own header comment on why
// widening IT to a second origin would be a real risk). This route gets its OWN, separate CORS
// policy instead: no credentials (a public submission carries no cookies/auth), and an allow-list
// of the real marketing website's origins (utils/crm/publicLeadOrigins.js) - not a wildcard, so
// this endpoint cannot be scraped for mass submissions from an arbitrary third-party page's
// client-side JS (server-side/curl submissions are still possible regardless of CORS, which is a
// browser-only protection - that is what the rate limit and honeypot below are for).
console.log(`[STARTUP] CRM public lead intake - allowed website origins: ${PUBLIC_LEAD_ALLOWED_ORIGINS.join(', ')}`);

const router = express.Router();

router.use(
  cors({
    origin(origin, callback) {
      if (isAllowedWebsiteOrigin(origin)) return callback(null, true);
      console.warn(`[CORS] Rejected public lead submission from disallowed origin: ${origin}`);
      return callback(null, false);
    },
    credentials: false,
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key'],
  })
);

router.post('/leads', publicLeadRateLimit, publicLeadValidators, publicLeadController.submitPublicLead);

module.exports = router;
