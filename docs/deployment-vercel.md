# Deploying the backend to Vercel

How the backend runs as a Vercel serverless deployment, what was broken before this was written,
and what still needs verifying against the actual Vercel project (this document was written by
inspecting the code and testing locally - see "What was NOT verified" at the bottom).

## The problem this fixes

The backend at `https://reserviabackend.vercel.app` was returning `FUNCTION_INVOCATION_FAILED` for
**every** route, including `/` and a nonexistent path - proven by curling all four before touching
any code. That ruled out a per-route bug; the crash was happening at module load, before Express
ever got a chance to route anything. Two independent causes, found by reading the code:

1. **`backup.settings.js#getSettings()`** called `fs.writeFileSync()` to create
   `backend/settings.json` if missing. Vercel's deployed filesystem is read-only outside `/tmp`,
   and files only ever accessed via `fs.*` (not `require()`/`import`) aren't reliably included in
   Vercel's dependency-traced function bundle - so the file was likely absent on Vercel, forcing
   the write path, which throws `EROFS`. This ran unconditionally, at module scope, via
   `backupScheduler.init()` in the old `server.js`.
2. **`dbConnection()`** called `process.exit(1)` on a missing/unreachable `DB_URI`. Inside a Vercel
   serverless function, `process.exit()` kills the entire function invocation - turning a database
   problem into a total outage for routes that don't even touch the database.

Neither of these is a CORS problem. The browser's "No 'Access-Control-Allow-Origin' header" error
was a downstream symptom: Vercel's own platform-level error page (not Express) doesn't run any of
this app's middleware, so of course it had no CORS headers - the request never reached the `cors()`
middleware in the first place.

## Architecture

```text
Vercel request
    │
    ▼
vercel.json rewrite: "/(.*)"  →  "/api/index"
    │
    ▼
api/index.js  (Vercel serverless entry point - NOT app.listen())
    │  - loadEnv()
    │  - fire-and-forget connectDB() (does not block, does not crash on failure)
    │  - module.exports = app
    ▼
server/app.js  (pure Express app construction - shared by BOTH entry points)
    │  - cors() - explicit origin allow-list, credentials: true
    │  - compression, cookie-parser, json body parser, morgan, rate-limit, mongo-sanitize, xss
    │  - i18next
    │  - GET /              → 200, no DB dependency
    │  - GET /api/v1/health → 200, no DB dependency
    │  - mountRoutes(app)   → all /api/v1/* domain routes
    │  - 404 handler + global error handler
    ▼
Controllers → Models → MongoDB
```

Local development is unchanged in behavior:

```text
npm start / npm run dev
    │
    ▼
server.js  (local-dev entry point)
    │  - loadEnv()
    │  - connectDB().catch(() => process.exit(1))   ← still fatal locally, on purpose
    │  - backupScheduler.init()                      ← still runs locally, on purpose
    │  - app.listen(PORT)
    ▼
server/app.js  (same file as above - zero duplicated application logic)
```

## Files changed

| File | Change |
|---|---|
| `server/app.js` | **New.** Pure Express app construction, extracted from the old `server.js`. Adds `GET /` and `GET /api/v1/health`. Tightens CORS to an explicit origin allow-list (see below). |
| `server.js` | Rewritten to be the local-dev entry point only: `loadEnv()` → `connectDB()` (fatal on failure, same as before) → `backupScheduler.init()` → `app.listen()`. Imports `server/app.js` instead of configuring Express itself. |
| `api/index.js` | **New.** Vercel serverless entry point. Imports `server/app.js`, connects to the database without blocking or crashing the function on failure, never calls `app.listen()`. |
| `vercel.json` | **New.** Minimal rewrite (`/(.*)` → `/api/index`) so Express's own router handles every path internally, exactly like it does locally. Also includes `locales/**` in the function bundle (see "i18next" below). |
| `server/database/dbConnection.js` | No longer calls `process.exit()`. Returns a cached promise (reused across warm serverless invocations and repeated local calls) instead of a fire-and-forget void call. |
| `server/backup/backup.scheduler.js` | `init()` now no-ops (with a clear `[STARTUP]` log) when `process.env.VERCEL` is set - cron timers don't survive between serverless invocations, and this is also what stops the `settings.json` write from ever being attempted on Vercel. |
| `server/backup/backup.settings.js` | `fs.writeFileSync` calls wrapped so a read-only filesystem (a stray Vercel invocation of the admin backup routes, not the scheduler) logs and degrades to in-memory defaults instead of throwing. |
| `.env.example`, `docs/environment-variables.md` | Documented the new `FRONTEND_URL` variable and the platform-provided `VERCEL` variable. |

## Database

`DB_URI` must be set as an environment variable **in the Vercel project's own dashboard**
(Project → Settings → Environment Variables) - it has no access to this repo's `.env`/`config.env`,
which are gitignored and never deployed. `DB_URI is configured: ` **unknown from here** - I do not
have access to the Vercel project's environment variable configuration to confirm this; check the
dashboard, or watch the Runtime Logs for `[STARTUP] Database connection: OK` vs `FAILED` after
deploying.

MongoDB connection reuse: `dbConnection.js` caches the connection promise at module scope
(`mongoose.connection.readyState === 1` short-circuits; an in-flight connection attempt is also
cached). Combined with Vercel keeping a container warm between nearby invocations, this means most
warm invocations reuse the existing connection rather than reconnecting - the same well-known
pattern used for MongoDB-on-serverless generally. Cold starts still pay the connection cost once.

## Backup scheduler: local vs. Vercel

- **Locally**: `backupScheduler.init()` runs as before - reads `settings.json` (auto-creating it
  with defaults if missing, since the local filesystem is fully writable), schedules a daily
  `node-cron` job, keeps running for the lifetime of the `node server.js` process.
- **On Vercel**: skipped entirely. A scheduled cron job cannot work correctly in a serverless
  function anyway (the process is not kept alive between requests, so the timer would never fire),
  independent of the filesystem problem. The admin-triggered backup routes
  (`/api/v1/admin/backup/*`) are still mounted and reachable on Vercel, but will still fail for any
  operation that needs to write an actual backup archive to persistent disk - that's a real,
  separate limitation (would need external storage, e.g. S3) that this fix does not attempt to
  solve, since it's a feature gap, not a crash.

## CORS

`server/app.js` uses an explicit origin allow-list, not `origin: true` (dynamic reflect-any-origin,
the previous behavior) and not `'*'`:

```js
const allowedOrigins = [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000'];
```

This matters because auth uses cross-site cookies (`sameSite: 'none'`, `secure: true` in
production - see `server/utils/cookieOptions.js`), so `credentials: true` is genuinely required -
but combining `credentials: true` with "allow any origin" (whether via `origin: true` or `'*'`)
would let any website make authenticated, cookie-bearing requests on behalf of a logged-in user.
The allow-list closes that gap. **`FRONTEND_URL` must be set to `https://reserviafrontend.vercel.app`
(no trailing slash) in the Vercel project's environment variables** - without it, the app still
boots and serves `/` and `/api/v1/health`, but every cross-origin request from the real frontend
will be correctly rejected (verified locally - see below).

## Local verification actually performed

Ran `node server.js` locally (unchanged `npm start` entry point) against the real configured
`DB_URI`, and separately loaded `api/index.js` with `VERCEL=1` set to confirm the Vercel code path
initializes without error and skips the backup scheduler. Results:

| Test | Result |
|---|---|
| Local server boot | All `[STARTUP]` stages logged in order, no crash |
| `GET /` | `200 {"success":true,"message":"Reversia Accounting API is running"}` |
| `GET /api/v1/health` | `200 {"success":true,"status":"ok","uptime":...}` |
| `GET /this-route-does-not-exist` | `404`, proper Express JSON error (not a crash) |
| `OPTIONS /api/v1/auth/login` from `http://localhost:5173` (allowed) | `204`, `Access-Control-Allow-Origin: http://localhost:5173` present |
| `OPTIONS /api/v1/auth/login` from `https://evil.example.com` (not allowed) | `200`, **no** `Access-Control-Allow-Origin` header - correctly rejected |
| `OPTIONS /api/v1/auth/login` from `https://reserviafrontend.vercel.app` with `FRONTEND_URL` unset locally | Correctly rejected (proves the allow-list actually filters, not reflects-any-origin) |
| `POST /api/v1/auth/login` with deliberately wrong credentials | `401`, proper JSON error, `Access-Control-Allow-Origin` header present on the error response too |
| `api/index.js` loaded with `VERCEL=1` | Loads cleanly, exports a callable Express app, backup scheduler correctly skipped |
| `node --test server/test/*.test.js` | 26/26 pass (no regression) |

## What was NOT verified (needs the actual Vercel deployment)

I do not have Vercel CLI/dashboard access in this environment (no `.vercel` project link, no
authenticated session), so none of the following was tested against the real
`reserviabackend.vercel.app` deployment:

- Whether `DB_URI` is actually set in the Vercel project's environment variables.
- Whether this exact code, once pushed/deployed, actually resolves `FUNCTION_INVOCATION_FAILED` -
  the two causes found are strong, concrete matches for "every route crashes identically" (backed
  by reading the exact synchronous `fs`/`process.exit()` calls involved, not speculation), but I
  cannot rule out a third, still-undiscovered cause without seeing the real Vercel Runtime Logs for
  a specific failed invocation.
- Whether `locales/**` being included via `vercel.json`'s `includeFiles` actually resolves i18next
  correctly in Vercel's build - this is a reasonable, standard mechanism, but wasn't (and can't be,
  from here) exercised against a real deployment.
- The production CORS/login flow end-to-end at `https://reserviabackend.vercel.app`.

**Next step**: push this branch, let Vercel deploy it (or deploy manually), set `FRONTEND_URL` and
confirm `DB_URI` in the Vercel project's Environment Variables, then repeat the same test sequence
above against the real URL. If it still crashes, the Runtime Logs will now at minimum show which
`[STARTUP]` line was the last one printed before the failure, narrowing down the cause immediately
rather than requiring another round of guessing.
