const express = require('express');
const rateLimit = require('express-rate-limit');
const { getPublicSite } = require('../../controller/website/publicSiteController');

// Website Management - the PUBLIC, read-only content feed (GET /api/v1/website/public/site).
// Deliberately NOT behind authController.protect/requireWebsiteAccess: the website's build
// (Reservia_Website scripts/build-site.mjs) fetches it server-to-server with no user. It only ever
// serves already-published content (see publicSiteController.js), and only GET. Not opened to
// browser cross-origin reads beyond app.js's global CORS policy - nothing in a visitor's browser
// needs it; the website ships the content inside its own build.
const router = express.Router();

// A build reads this once; a small per-source limit on top of app.js's global limiter keeps the
// one unauthenticated read endpoint from being used to hammer the database.
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
  }),
);

router.get('/site', getPublicSite);

module.exports = router;
