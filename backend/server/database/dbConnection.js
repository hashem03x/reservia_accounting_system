const mongoose = require('mongoose');

// Caches the in-flight/completed connection so repeated calls (warm serverless invocations, or
// multiple require()s of this module within one process) reuse the same connection instead of
// calling mongoose.connect() again - calling it while already connected/connecting throws.
//
// Deliberately does NOT call process.exit() on failure (unlike the previous version of this
// file) - inside a Vercel serverless function, process.exit() kills the entire function
// invocation, which is what was turning a "DB_URI missing/unreachable" problem into
// FUNCTION_INVOCATION_FAILED for every single route, not just the ones that touch the database.
// Callers decide what "connection failed" should mean for their environment - see server.js
// (local dev: fatal, exits the process - the previous, still-correct-for-that-context behavior)
// vs api/index.js (Vercel: logged, but the request is allowed to proceed so a route that doesn't
// need the database, like /api/v1/health, can still respond).
function connectDB() {
  if (!process.env.DB_URI) {
    return Promise.reject(
      new Error('DB_URI environment variable is required (checked config.env/.env locally, or the Vercel project\'s Environment Variables in production).')
    );
  }

  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);
  if (connectDB._pending) return connectDB._pending;

  connectDB._pending = mongoose
    .connect(process.env.DB_URI, { serverSelectionTimeoutMS: 10000 })
    .then(conn => {
      console.log(`[STARTUP] Database connection: OK (host: ${conn.connection.host}, db: ${conn.connection.name})`);
      return conn;
    })
    .catch(err => {
      connectDB._pending = null; // Don't cache a permanent failure - let the next call retry.
      // Deliberately does not log err.message: for a malformed URI, the MongoDB driver's own
      // parse-error message echoes the URI (credentials included) back verbatim. err.name/code
      // are safe - they never contain the connection string.
      console.error(`[STARTUP] Database connection: FAILED (${err.name}${err.code ? `, code ${err.code}` : ''})`);
      throw err;
    });

  return connectDB._pending;
}

module.exports = connectDB;
