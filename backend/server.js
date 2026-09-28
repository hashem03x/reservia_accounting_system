const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const kleur = require('kleur'); // Import kleur for colored logs
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const cors = require('cors');
const compression = require('compression');
// const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
// the i18next module is used to handle internationalization and localization in the application
const i18next = require('i18next');
// the i18next-fs-backend module is used to load translations
const Backend = require('i18next-fs-backend');
// the i18next-http-middleware module is used to handle internationalization and localization by detecting the language
const i18nextMiddleware = require('i18next-http-middleware');

const { loadEnv } = require('./server/config/env');
loadEnv();
const ApiError = require('./server/utils/apiError');
const globalError = require('./server/middleware/errorMiddleware');
const dbConnection = require('./server/database/dbConnection');
//  Routes
const mountRoutes = require('./server/routes');
const backupScheduler = require('./server/backup/backup.scheduler');

// Connect to db
dbConnection();

// express app
const app = express();

// Enable other domains to access your application
app.use(
  cors({
    origin: true,
    credentials: true,
    exposedHeaders: ['set-cookie', 'Content-Disposition'],
  }),
);
// Compress all responses
app.use(compression());
// HTTP security headers for express
// app.use(
//   helmet({
//     contentSecurityPolicy: false,
//   })
// );
app.use(cookieParser());

// Middlewares
app.use(express.json({ limit: '20mb' }));

// Define custom Morgan token for remote address
morgan.token('x-forwarded-for', req => {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
});

// Define custom Morgan format with Kleur
const morganFmt = (tokens, req, res) => {
  const remoteAddress = tokens['x-forwarded-for'](req);
  const requestTime = tokens.date(req, res, 'iso'); // ISO 8601 format
  return `===>>> ${kleur.magenta(requestTime)} | ${kleur.cyan(remoteAddress)}`;
};
app.use(morgan(morganFmt));
app.use(morgan('dev'));

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minutes
  max: 1000, // Limit each IP to 1000 requests
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
  },
});
app.use(mongoSanitize());
app.use(xss());

i18next
  .use(Backend)
  .use(i18nextMiddleware.LanguageDetector)
  .init({
    backend: {
      loadPath: path.join(__dirname, 'locales/{{lng}}/translation.json'),
      addPath: path.join(__dirname, 'locales/missing.json'),
    },
    fallbackLng: process.env.DEFAULT_LANGUAGE || 'en',
    saveMissing: true,
    detection: {
      order: ['header', 'cookie'],
      lookupHeader: 'accept-language',
      lookupCookie: 'accept-language',
      caches: ['cookie'],
    },
  });

app.use(i18nextMiddleware.handle(i18next));

app.use('/', limiter);

app.use('/', express.static(path.join(__dirname, 'uploads')));
// app.use('/', express.static(path.join(__dirname, 'uploads')));

// Mount Routes
mountRoutes(app);

// Auto-start the daily backup cron (loads time from settings.json)
backupScheduler.init();

app.all('*', (req, res, next) => {
  next(new ApiError(`Can't find this route: ${req.originalUrl}`, 404));
});

// Global error handling middleware for express
app.use(globalError);

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`App is running on port ${PORT}`);
});

// Increase timeout (e.g. 10 min = 600000 ms)
server.setTimeout(600000);

// Handling error ouside express

process.on('SIGINT', () => {
  console.log('👋 SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('💥 Server closed.');
    process.exit(1);
  });
});

process.on('unhandledRejection', err => {
  console.log('#'.repeat(33));
  console.error(`Unhandled Rejection Error: ${err.name} | ${err.message}`);
  server.close(() => {
    console.error('Shutting down....');
    process.exit(1);
  });
});
