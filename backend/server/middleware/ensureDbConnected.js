const connectDB = require('../database/dbConnection');
const ApiError = require('../utils/apiError');

// THE fix for "Operation `users.findOne()` buffering timed out after 10000ms": on Vercel,
// api/index.js kicks off connectDB() at module load but deliberately does NOT await it (so
// GET / and GET /api/v1/health can still respond even if the database is unreachable - see that
// file's comment). That means, without this middleware, the very first request into a cold
// serverless invocation reaches its route handler (e.g. POST /api/v1/auth/login -> User.findOne())
// before mongoose has finished connecting. Mongoose's query buffering then queues that operation
// silently instead of failing fast, and if the connection doesn't finish within
// bufferTimeoutMS (10000ms, Mongoose's default - not something this fix touches), the query itself
// times out with exactly that "buffering timed out" error - which looks like a slow/broken query,
// when the actual problem is that no connection existed yet when the query was issued.
//
// Mounted in app.js AFTER the two DB-independent health-check routes and BEFORE mountRoutes(app),
// so every route that can actually touch the database now guarantees:
//
//   request -> ensureDbConnected (awaits the connection) -> route handler -> User.findOne()
//
// instead of racing the connection attempt. connectDB() is the same cached
// singleton dbConnection.js already provides - on a warm invocation, or under the traditional
// server.js entry point (where connectDB() already resolved before app.listen() was ever called),
// this resolves immediately (mongoose.connection.readyState is already 1) and adds no meaningful
// latency; it only actually waits when a connection genuinely needs to be established.
module.exports = async function ensureDbConnected(req, res, next) {
  try {
    await connectDB();
    next();
  } catch (err) {
    // Same non-fatal handling as api/index.js's own catch - never crash the process/invocation
    // over a DB outage, just fail this one request cleanly. dbConnection.js already logged the
    // safe (credential-free) diagnostic for `err`; nothing further to log here.
    next(new ApiError('Database connection is currently unavailable. Please try again shortly.', 503));
  }
};
