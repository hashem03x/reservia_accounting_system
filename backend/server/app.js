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

console.log('[STARTUP] Building Express application...');

// Cross-origin requests carry cookies (JWT access/refresh tokens - see utils/cookieOptions.js,
// sameSite: 'none' because frontend and backend are different origins), so this can never be a
// bare `credentials: true` with a wildcard/reflect-any-origin policy - browsers reject
// `Access-Control-Allow-Origin: *` alongside credentials anyway, and reflecting every origin back
// would let ANY website make authenticated, cookie-bearing requests on a logged-in user's behalf.
// FRONTEND_URL is the one production origin that must be allowed; local dev origins are added
// unconditionally since they only ever originate from a developer's own machine.
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];
const productionOrigin = process.env.FRONTEND_URL?.replace(/\/$/, ''); // trailing slash would never match a real Origin header
const allowedOrigins = [...(productionOrigin ? [productionOrigin] : []), ...DEV_ORIGINS];

console.log(`[STARTUP] CORS allowed origins: ${allowedOrigins.join(', ')}${productionOrigin ? '' : ' (FRONTEND_URL is not set - production frontend origin will be REJECTED)'}`);

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
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['set-cookie', 'Content-Disposition'],
  })
);

app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '20mb' }));

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
