const express = require('express');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { getPublicSite, getPublicPreview } = require('../../controller/website/publicSiteController');
const { isAllowedWebsiteOrigin } = require('../../utils/crm/publicLeadOrigins');
const { getVisualPreview } = require('../../controller/website/visualController');

// Website Management - the PUBLIC, read-only endpoints (no authController.protect):
//   GET /site            - the published-content feed the website BUILD reads server-to-server;
//   GET /preview/:token  - one page's draft for a signed, short-lived preview link (the website's
//                          /<lang>/__preview page reads it from the browser - its own GET-only,
//                          no-credentials CORS policy for the website's origins; app.js skips the
//                          global credentialed policy for this prefix).
const router = express.Router();

const limiter = max =>
  rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
  });

const extraPreviewOrigins = () =>
  [process.env.WEBSITE_PUBLIC_URL, ...(process.env.WEBSITE_PREVIEW_ORIGINS || '').split(',')]
    .map(o => String(o || '').trim().replace(/\/+$/, ''))
    .filter(Boolean);

const previewCors = cors({
  origin(origin, callback) {
    if (!origin || isAllowedWebsiteOrigin(origin) || extraPreviewOrigins().includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: false,
  methods: ['GET', 'OPTIONS'],
});

router.get('/site', limiter(30), getPublicSite);
router.options('/preview/:token', previewCors);
router.get('/preview/:token', previewCors, limiter(60), getPublicPreview);
// The Visual Editor iframe / draft design preview reads the DRAFT design with a signed token.
router.options('/visual-preview/:token', previewCors);
router.get('/visual-preview/:token', previewCors, limiter(120), getVisualPreview);

module.exports = router;
