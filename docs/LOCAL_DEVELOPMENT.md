# Running Reservia locally

How to run the backend (Express + MongoDB) and the frontend (Vite + React) on a development machine
after cloning the repository. Every variable, port, and command below comes from the code and the
`package.json` files. The full variable reference is in
[environment-variables.md](environment-variables.md).

```text
Browser ─► http://localhost:5173  (Vite dev server, frontend/)
              │  every API call goes to ${VITE_API_URL}/<path>
              ▼
           http://localhost:5000/api/v1  (Express, backend/)
              │  DB_URI
              ▼
           MongoDB (replica set: local single-node, or Atlas)
```

## Prerequisites

| Tool | Version | Source |
|---|---|---|
| Node.js | **24.x** declared (`backend/package.json` → `engines.node`). The frontend declares none. Node 22 was also verified to build, test, and run both apps. | `backend/package.json` |
| npm | Comes with Node. Both apps use npm (`package-lock.json` in each). | lock files |
| MongoDB | A **replica set** is required. Sales/Purchase Order creation, Add Payment, Advanced Payments, and journal reversals run in MongoDB transactions, which a standalone `mongod` rejects. Use **MongoDB Atlas** (always a replica set) or a **local single-node replica set** (below). | `services/sales/salesOrderCreation.service.js`, `controller/PO/*.js` |

### Option A: MongoDB Atlas (or an existing development database)

Use a connection string that includes a **database name**, for example
`mongodb+srv://<user>:<password>@<cluster-host>/reversia-accounting?retryWrites=true&w=majority`.
Add your machine's IP under Atlas → Network Access. Do **not** point local development at the
production database.

### Option B: local MongoDB as a single-node replica set

1. Install MongoDB Community Server, plus `mongosh` (MongoDB Shell).
2. Start it with a replica-set name, using a data folder that already exists (PowerShell):

   ```powershell
   New-Item -ItemType Directory -Force C:\data\reservia-db
   mongod --dbpath C:\data\reservia-db --port 27017 --bind_ip 127.0.0.1 --replSet rs0
   ```

   If MongoDB runs as a Windows service instead, add `replication:` / `replSetName: rs0` to
   `mongod.cfg` and restart the service.
3. One time only, in another terminal:

   ```powershell
   mongosh --eval "rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] })"
   ```

4. Then use `DB_URI=mongodb://127.0.0.1:27017/reversia-accounting`.

## 1. Backend setup (`backend/`)

```powershell
cd backend
npm install
Copy-Item .env.example config.env      # CMD: copy .env.example config.env
```

Edit `backend/config.env`. Only three values have to change for a local run:

| Variable | What to set |
|---|---|
| `DB_URI` | Your MongoDB connection string (Option A or B above), including the database name. |
| `JWT_SECRET_KEY` | Any long random string. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `REFRESH_TOKEN_SECRET_KEY` | A **different** long random string. |

Everything else already has a working local value in the template (`NODE_ENV=development`,
`PORT=5000`, `BASE_URL`/`DEV_URL=http://localhost:5000`). `CLOUDINARY_URL` and `SMTP_*` are only
needed for document/contract uploads and password-reset or backup emails.

> The config file name: `server/config/env.js` loads `config.env`, then `.env` (with `.env` taking
> precedence). Both work for the server and every `npm run db:*` script. A few legacy one-off
> maintenance scripts read only `config.env`, so `config.env` is the recommended name. Both are
> gitignored.

### First-time database setup (fresh, empty database)

```powershell
npm run db:init                 # creates every collection and index, inserts no documents; refuses a non-empty DB
npm run db:seed-accounts        # optional: a small default Chart of Accounts (only adds missing codes)
npm run db:seed-sectors         # Project Sector options (Villa, Industrials) - only adds missing ones
npm run db:create-admin -- --email you@example.com --name "Your Name"
```

`db:create-admin` prints a generated password once (or pass `--password "..."`). Use it to log in,
then change it from the Profile page.

To load the real Chart of Accounts / journal-entry dataset instead, use
`npm run db:import-accounting-data -- --dry-run` first. It **replaces** the ChartOfAccount,
JournalEntry, and Project collections, needs the `csv_files/` folder (gitignored, not in the
repository), and only writes when you pass `--yes`.

### Start the backend

```powershell
npm run dev        # nodemon, forces NODE_ENV=development, restarts on file changes
# or
npm start          # plain `node server.js`, NODE_ENV comes from config.env
```

Expected log lines:

```text
[STARTUP] CORS allowed origins: http://localhost:5173, http://127.0.0.1:5173, http://localhost:3000 (FRONTEND_URL is not set - ...)
[STARTUP] Application ready - listening on port 5000
[STARTUP] Database connection: OK (host: 127.0.0.1, db: reversia-accounting)
```

The `FRONTEND_URL is not set` note is expected locally, because the local origins above are always
allowed. If the database can't be reached, the server exits and prints a `[DB] Diagnosis:` line
(bad URI, DNS, Atlas IP allowlist, wrong credentials) without printing the connection string.

## 2. Frontend setup (`frontend/`)

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local      # CMD: copy .env.example .env.local
npm run dev
```

The template's `VITE_API_URL=http://localhost:5000/api/v1` already points at the local backend.
Change it only if you changed the backend `PORT`. Restart `npm run dev` after editing any `VITE_*`
value, because Vite reads them at startup.

`VITE_ABOUT_ID` is only needed by **Customization → About** (logo and barcode-sticker settings).
A fresh database has no About document, and the rest of the app works without it.
`VITE_GOOGLE_CLIENT_ID` is only needed for the Google sign-in button. Email/password login works
without it.

## 3. Local URLs

| What | URL | Configured by |
|---|---|---|
| Frontend | http://localhost:5173 | `frontend/vite.config.ts` (`server.port: 5173`, `host: 0.0.0.0`) |
| Backend API base | http://localhost:5000/api/v1 | `backend/config.env` `PORT` (default 5000 in `server.js`) |
| Health check (no DB needed) | http://localhost:5000/api/v1/health | `server/app.js` |
| Root ping | http://localhost:5000/ | `server/app.js` |

Open the app as **http://localhost:5173**, not `127.0.0.1`. The refresh-token cookie is
`SameSite=Lax` locally, and `localhost:5173` → `localhost:5000` counts as the same site, so the
cookie is sent. `127.0.0.1` → `localhost` does not count as the same site, so the "stay logged in"
refresh would fail.

## How local auth works (and why it needs nothing extra)

- `POST /api/v1/auth/login` returns a JWT in the response body. The frontend sends it as
  `Authorization: Bearer ...` on every protected request. This needs only `JWT_SECRET_KEY`.
- The same response sets `access_token`/`refresh_token` cookies, used by
  `GET /api/v1/auth/refresh-token` (restoring a session after a reload) and by logout. This needs
  `REFRESH_TOKEN_SECRET_KEY`.
- Cookie flags (`server/utils/cookieOptions.js`):
  - With `NODE_ENV=development`: `SameSite=Lax`, not `Secure`, which works over plain http.
  - Any other `NODE_ENV` (production on Vercel): `SameSite=None; Secure`, unchanged.
- CORS (`server/app.js`) allows credentialed requests only from `FRONTEND_URL` plus the fixed local
  origins `http://localhost:5173`, `http://127.0.0.1:5173`, and `http://localhost:3000`. It never
  uses `*`.

## Scripts reference

**Backend** (`backend/package.json`)

| Script | What it does | Needs |
|---|---|---|
| `npm run dev` | nodemon + `NODE_ENV=development` | `DB_URI`, JWT secrets |
| `npm start` | `node server.js` | same |
| `npm test` | `node --test` over `server/test/**`. Each file uses its own throw-away DB at `mongodb://127.0.0.1:27017/reversia_test_*` and **drops it**. Transaction tests need the local replica set. | local MongoDB (leave `TEST_DB_URI` unset) |
| `npm run db:init` | create collections and indexes on an **empty** DB | `DB_URI` |
| `npm run db:seed-accounts` | add a minimal default Chart of Accounts (non-destructive) | `DB_URI` |
| `npm run db:seed-industrial-categories` | seed product categories | `DB_URI` |
| `npm run db:seed-sectors` (`-- --dry-run` to report only) | create Project Sector records for Villa/Industrials and every sector already used by a project (additive, idempotent) | `DB_URI` |
| `npm run db:create-admin -- --email ... --name ...` | create the first admin user | `DB_URI` |
| `npm run db:import-accounting-data -- --dry-run` / `--yes` | **replaces** the ChartOfAccount, JournalEntry, and Project collections from `csv_files/` | `DB_URI`, `csv_files/` |
| `npm run db:migrate-project-fields` / `db:migrate-variants-to-products` | one-off data migrations | `DB_URI` |
| `npm run db:recalculate-project-remaining` (report) / `-- --yes` (apply) | re-derives the stored `remainingMoney` of existing projects as Contract Value − Executed Amount (writes only that field, only where it differs) | `DB_URI` |
| `npm run db:backfill-journal-line-projects` (report) / `-- --yes` (apply) | fills missing Project / Project Number on the lines of journal entries whose entry has a Project (from that Project's own number; never guesses, never touches amounts) | `DB_URI` |
| `npm run db:reset -- --yes` | **deletes all data** in every Reservia collection (refuses when `NODE_ENV=production`) | `DB_URI` |
| `npm run pm2:*` / `npm run prod` / `npm run staging` | process-manager and production-style starts (not needed locally) | — |

All `db:*` scripts refuse to run against a database that looks like the old Leopard store, and
never print the connection string.

**Frontend** (`frontend/package.json`)

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run preview` | serve the production build locally |
| `npm run lint` | ESLint |

## Local vs production

| Setting | Local | Production (Vercel) |
|---|---|---|
| Backend env source | `backend/config.env` / `.env` | Vercel project → Environment Variables (local files are never read) |
| Backend entry | `server.js` (`app.listen`, backup cron) | `api/index.js` (serverless, no listen, no cron; `VERCEL` is set by the platform) |
| `NODE_ENV` | `development` | `production` |
| `FRONTEND_URL` | empty (local origins are built in) | the deployed frontend origin, e.g. `https://reserviafrontend.vercel.app` |
| `BASE_URL` / product-image URL | `http://localhost:5000` (`DEV_URL`) | the deployed backend URL (`BASE_URL`, `PROD_URL`) |
| Frontend env source | `frontend/.env.local` | Vercel project → Environment Variables (baked in at build time) |
| `VITE_API_URL` | `http://localhost:5000/api/v1` | the deployed backend, e.g. `https://reserviabackend.vercel.app/api/v1` |

No production URL is hard-coded in the frontend. The API base always comes from `VITE_API_URL`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Backend exits with `DB_URI environment variable is required` | `backend/config.env` is missing or not in `backend/`. |
| `[DB] Diagnosis: could not reach the MongoDB server ...` | `mongod` not running, wrong port, or the Atlas IP allowlist. |
| Order / payment creation fails with `Transaction numbers are only allowed on a replica set member or mongos` | Local `mongod` was started without `--replSet`; see Option B. |
| Login: `secretOrPrivateKey must have a value` | `JWT_SECRET_KEY` / `REFRESH_TOKEN_SECRET_KEY` are empty. |
| Every request: "Oops! Something went wrong while connecting." | Backend not running, or `VITE_API_URL` is wrong. Restart Vite after changing it. |
| Browser console: CORS error | The page was opened from an origin other than `http://localhost:5173` / `http://127.0.0.1:5173` / `http://localhost:3000`, or the Vite port changed. |
| Logged out after every page reload | The app was opened via `127.0.0.1` instead of `localhost` (see Local URLs). |
| Purchasing a service fails with `has no PUC account configured` | Edit the service and select its PUC Account (Products → service). |
