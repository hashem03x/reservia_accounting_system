// Builds and configures the Express application - pure app construction, no side effects like
// starting a listener, connecting to the database, or scheduling cron jobs. Both entry points
// import this single module so the actual application logic is never duplicated:
//   - server.js    (local dev / traditional persistent server: app.listen())
//   - api/index.js (Vercel serverless: exports this app directly, no listen())
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const kleur = require('kleur');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const i18nextMiddleware = require('i18next-http-middleware');

const ApiError = require('./utils/apiError');
const globalError = require('./middleware/errorMiddleware');
const ensureDbConnected = require('./middleware/ensureDbConnected');
const mountRoutes = require('./routes');
const { WEBSITE_PRODUCTION_ORIGINS } = require('./utils/crm/publicLeadOrigins');

console.log('[STARTUP] Building Express application...');

// Cross-origin requests carry cookies (JWT access/refresh tokens - see utils/cookieOptions.js,
// sameSite: 'none' because frontend and backend are different origins), so this can never be a
// bare `credentials: true` with a wildcard/reflect-any-origin policy - browsers reject
// `Access-Control-Allow-Origin: *` alongside credentials anyway, and reflecting every origin back
// would let ANY website make authenticated, cookie-bearing requests on a logged-in user's behalf.
// FRONTEND_URL is the one production origin that must be allowed; local dev origins are added
// unconditionally since they only ever originate from a developer's own machine.
// 5173 = the Vite dev server (frontend/vite.config.ts), reachable as localhost or 127.0.0.1.
//
// The real reservia-energy.com marketing website (apex + www - utils/crm/publicLeadOrigins.js's
// own WEBSITE_PRODUCTION_ORIGINS, so the two CORS boundaries never list that domain differently)
// is ALSO allowed here, on top of FRONTEND_URL: its own quote form calls the CRM's authenticated
// /api/v1/crm/leads with an `Idempotency-Key` header (see leadRoute.js), and a disallowed origin
// fails the browser's preflight before the request ever reaches that route's own auth check.
// Allowing the origin only lets the preflight succeed and, if the site's own fetch ever opts in
// with `credentials: 'include'`, lets the browser attach cookies - it does NOT grant access by
// itself; requireCrmAccess/authController.protect still reject any request without a valid staff
// session exactly as before. This is a deliberate, informed trust decision for Reservia's own
// first-party domain, not a wildcard.
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'];
// Falls back to the real, known Central Portal (ERP/CRM) frontend domain when FRONTEND_URL isn't
// set in the deployment's own environment variables - mirrors WEBSITE_PRODUCTION_ORIGINS' own
// "work correctly out of the box, override only if the real domain changes" reasoning, so a
// missing/misconfigured env var (e.g. PROD_URL being set instead, which is a wholly unrelated
// variable - see controller/inventory/productController.js, used for product/brand image URLs,
// not CORS) can no longer silently lock the ERP/CRM frontend itself out of its own API. An
// explicit FRONTEND_URL still always wins.
const DEFAULT_FRONTEND_ORIGIN = 'https://reserviafrontend.vercel.app';
const productionOrigin = (process.env.FRONTEND_URL?.replace(/\/$/, '')) || DEFAULT_FRONTEND_ORIGIN;
const allowedOrigins = [productionOrigin, ...WEBSITE_PRODUCTION_ORIGINS, ...DEV_ORIGINS];

console.log(
  `[STARTUP] CORS allowed origins: ${allowedOrigins.join(', ')}${process.env.FRONTEND_URL ? '' : ` (FRONTEND_URL is not set - defaulting the ERP/CRM frontend origin to ${DEFAULT_FRONTEND_ORIGIN})`}`
);

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      // Requests with no Origin header (curl, server-to-server, same-origin navigation) aren't
      // subject to CORS in the first place - only a browser cross-origin fetch sends one.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      console.warn(`[CORS] Rejected request from disallowed origin: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Idempotency-Key: the website's quote form sends this (src/services/leadService.ts) so a
    // retried submission is never processed twice - must be explicitly allowed, exactly like
    // Content-Type/Authorization, or the browser blocks the request at the preflight stage before
    // it ever reaches the server.
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    exposedHeaders: ['set-cookie', 'Content-Disposition'],
  })
);

app.use(compression());
app.use(cookieParser());
// `verify` stashes the exact raw bytes on req.rawBody - needed by the WhatsApp webhook
// (routes/crm/whatsappRoute.js) to check Meta's HMAC payload signature, which must be computed
// over the untouched body, not a re-serialization of the parsed JSON. Every other route ignores
// req.rawBody; capturing it here costs one buffer reference per request and avoids mounting a
// second, path-conditional body parser just for one webhook.
app.use(express.json({ limit: '20mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

morgan.token('x-forwarded-for', req => req.headers['x-forwarded-for'] || req.socket.remoteAddress);
const morganFmt = (tokens, req, res) => {
  const remoteAddress = tokens['x-forwarded-for'](req);
  const requestTime = tokens.date(req, res, 'iso');
  return `===>>> ${kleur.magenta(requestTime)} | ${kleur.cyan(remoteAddress)}`;
};
app.use(morgan(morganFmt));
app.use(morgan('dev'));

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' },
});
app.use(mongoSanitize());
app.use(xss());

i18next
  .use(Backend)
  .use(i18nextMiddleware.LanguageDetector)
  .init({
    backend: {
      loadPath: path.join(__dirname, '../locales/{{lng}}/translation.json'),
      addPath: path.join(__dirname, '../locales/missing.json'),
    },
    fallbackLng: process.env.DEFAULT_LANGUAGE || 'en',
    // saveMissing writes discovered-missing keys to locales/missing.json via fs - useful for local
    // development, but another write-to-a-non-tmp-path-on-a-read-only-filesystem risk on Vercel
    // (same class of bug as backup.settings.js's settings.json write - see backup.scheduler.js's
    // comment). Disabled there; this file/directory being missing from the deployed bundle
    // entirely (fs-accessed files aren't reliably included in Vercel's dependency trace - see
    // vercel.json's `includeFiles`) would otherwise risk the same crash pattern.
    saveMissing: !process.env.VERCEL,
    detection: {
      order: ['header', 'cookie'],
      lookupHeader: 'accept-language',
      lookupCookie: 'accept-language',
      caches: ['cookie'],
    },
  });
app.use(i18nextMiddleware.handle(i18next));

app.use('/', limiter);

app.use('/', express.static(path.join(__dirname, '../uploads')));

// Proves the app itself is up without depending on the database - see docs/entities or the
// Vercel deployment notes for why these two are checked FIRST when diagnosing a cold-start crash.
app.get('/', (req, res) => {
  res.status(200).json({ success: true, message: 'Reversia Accounting API is running' });
});
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({ success: true, status: 'ok', uptime: process.uptime() });
});

// Every route below this point can touch the database, so every route below this point waits for
// a real connection first - see middleware/ensureDbConnected.js for exactly what problem this
// fixes and why it's mounted here specifically (after the two health checks above, which must keep
// working even when the database is down).
app.use(ensureDbConnected);

mountRoutes(app);

console.log('[STARTUP] Routes registered.');

app.all('*', (req, res, next) => {
  next(new ApiError(`Can't find this route: ${req.originalUrl}`, 404));
});

app.use(globalError);

console.log('[STARTUP] Express application ready.');

module.exports = app;
