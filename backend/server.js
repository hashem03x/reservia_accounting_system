// Local-dev / traditional-server entry point. NOT used on Vercel - see api/index.js, which
// imports server/app.js directly and never calls app.listen(). Keeping this file's job narrow
// (connect DB, start the backup scheduler, listen on a port, wire process signal handlers) is
// what makes server/app.js safely reusable by both entry points without duplicating the actual
// application logic.
const { loadEnv } = require('./server/config/env');
loadEnv();

console.log('[STARTUP] Configuration loaded.');

const connectDB = require('./server/database/dbConnection');
const backupScheduler = require('./server/backup/backup.scheduler');
const app = require('./server/app');

console.log('[STARTUP] Database configuration loaded.');

// Local/traditional-server behavior: a bad or missing DB_URI is fatal at boot, same as before this
// file was split - this is intentionally NOT the behavior of api/index.js (Vercel), where killing
// the whole process on a DB error would take down every route, including ones that don't need the
// database (see server/database/dbConnection.js's comment for why process.exit() was removed from
// the shared connection logic itself).
connectDB().catch(err => {
  console.error(`[STARTUP] Fatal: database connection failed (${err.name || err.message}). Exiting.`);
  process.exit(1);
});

// Cron/fs-based background jobs only make sense on a persistent process - see
// server/backup/backup.scheduler.js for why this is skipped entirely on Vercel.
backupScheduler.init();

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`[STARTUP] Application ready - listening on port ${PORT}`);
});

// Increase timeout (e.g. 10 min = 600000 ms) - meaningless on Vercel (which enforces its own
// per-invocation limit), only relevant to this persistent-server entry point.
server.setTimeout(600000);

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
