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
// need the database, like /api/v1/health, can still respond) vs
// middleware/ensureDbConnected.js (every other route: awaited per-request, turned into a clean 503
// instead of the Mongoose query-buffering timeout this whole file exists to prevent).

// Registered exactly once per process - these fire on actual state *transitions* (rare: once at
// startup, and again only if the connection genuinely drops), not per request, so they stay useful
// signal in production logs instead of adding a line to every single request the way logging
// inside connectDB() itself on every cache-hit would.
let listenersRegistered = false;
function registerConnectionListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;
  mongoose.connection.on('connected', () => console.log(`[DB] MongoDB connected (readyState: ${mongoose.connection.readyState})`));
  mongoose.connection.on('disconnected', () => console.warn(`[DB] MongoDB disconnected (readyState: ${mongoose.connection.readyState})`));
  mongoose.connection.on('reconnected', () => console.log('[DB] MongoDB reconnected'));
  mongoose.connection.on('error', err => console.error(`[DB] MongoDB connection error (${err?.name || 'unknown'}${err?.code ? `, code ${err.code}` : ''})`));
}

// Turns a raw driver error into a safe, actionable hint - inspects err.name/err.code and a handful
// of fixed, credential-free substrings the MongoDB driver itself uses for these specific failure
// modes (DNS resolution, auth rejection, timeouts) - never the connection string, never anything
// user-supplied. This is what lets a production log answer "which of these is it: missing env var,
// bad URI, Atlas network access, bad credentials, DNS, or a plain timeout?" without ever printing
// anything sensitive.
function classifyConnectionError(err) {
  const name = err?.name || '';
  const message = String(err?.message || '');

  if (!process.env.DB_URI) return 'DB_URI environment variable is not set';
  if (name === 'MongoParseError') {
    return 'DB_URI is not a valid MongoDB connection string - check its format, and make sure any special characters in the username/password are URL-encoded';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return 'DNS resolution failed - the cluster hostname in DB_URI could not be resolved (check the hostname, and this environment\'s network/DNS access)';
  }
  if (/bad auth|authentication failed/i.test(message) || (name === 'MongoServerError' && err.code === 18)) {
    return 'authentication failed - the username/password in DB_URI were rejected (check they are correct and, if changed recently, that special characters are URL-encoded)';
  }
  if (/ServerSelectionError/i.test(name) || /server selection timed out|ETIMEDOUT|ECONNREFUSED|connection timed out/i.test(message)) {
    return 'could not reach the MongoDB server before the selection timeout - most likely MongoDB Atlas Network Access (IP allowlist) is blocking this environment\'s outbound IP, or a firewall/network issue';
  }
  return `${name || 'unknown error'} - not one of the classified cases above; the error's own name/code were logged, but its message was not (it may contain the connection string)`;
}

function connectDB() {
  registerConnectionListeners();

  if (!process.env.DB_URI) {
    console.error('[DB] MongoDB URI configured: false');
    return Promise.reject(
      new Error('DB_URI environment variable is required (checked config.env/.env locally, or the Vercel project\'s Environment Variables in production).')
    );
  }

  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);
  if (connectDB._pending) return connectDB._pending;

  console.log('[DB] MongoDB URI configured: true');
  console.log('[DB] Connecting to MongoDB...');

  connectDB._pending = mongoose
    .connect(process.env.DB_URI, {
      serverSelectionTimeoutMS: 15000, // secondary safety margin for a cold serverless start's DNS+TLS+auth round trip - NOT the fix for the buffering-timeout bug (see ensureDbConnected.js for that), just a bit more headroom now that queries correctly wait for this to finish instead of racing it.
    })
    .then(conn => {
      console.log(`[STARTUP] Database connection: OK (host: ${conn.connection.host}, db: ${conn.connection.name})`);
      return conn;
    })
    .catch(err => {
      connectDB._pending = null; // Don't cache a permanent failure - let the next call retry.
      // Deliberately does not log err.message directly (see classifyConnectionError's own
      // comment for the one case - a malformed URI - where the raw driver message can echo the
      // connection string back verbatim). err.name/err.code are always safe on their own.
      console.error(`[STARTUP] Database connection: FAILED (${err.name}${err.code ? `, code ${err.code}` : ''})`);
      console.error(`[DB] Diagnosis: ${classifyConnectionError(err)}`);
      throw err;
    });

  return connectDB._pending;
}

module.exports = connectDB;
