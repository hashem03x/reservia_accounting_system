// Vercel serverless entry point. Vercel's Node.js runtime treats a file under /api that exports
// an Express app (or any (req, res) => void handler) as the request handler for whatever path
// vercel.json's rewrite routes to this file - see ../vercel.json, which sends every path to here
// so Express's own router (server/app.js) does all the real routing internally, exactly as it
// does locally. This file intentionally does NOT call app.listen() - Vercel owns the HTTP server;
// calling listen() here would do nothing useful and is the wrong mental model for a serverless
// function (one invocation per request, not a long-lived process).
const { loadEnv } = require('../server/config/env');
loadEnv();

console.log('[STARTUP] Configuration loaded (Vercel).');

const connectDB = require('../server/database/dbConnection');
const app = require('../server/app');

// Fire-and-forget, not awaited: GET / and GET /api/v1/health must respond even if the database is
// unreachable, so cold-start diagnosis can tell "Express didn't boot" apart from "Express is fine,
// the database is the problem" (see docs/entities or the deploy notes - this was the entire point
// of splitting dbConnection.js's failure handling out of a fatal process.exit()). Any route that
// actually needs the database will get mongoose's own connection error surfaced normally through
// the app's existing error-handling middleware, as a proper JSON error response, not a function
// crash.
connectDB().catch(err => {
  console.error(`[STARTUP] Database connection failed (${err.name || err.message}). Non-database routes will still work; anything touching the DB will return an error until this is fixed.`);
});

console.log('[STARTUP] Application ready (Vercel).');

module.exports = app;
