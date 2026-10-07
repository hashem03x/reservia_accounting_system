# Environment Variable Reference

Audit of every environment variable actually read by the codebase (backend `process.env.*`,
frontend `import.meta.env.VITE_*`), as of the Reversia extraction + Shopify-removal pass. No real
values are reproduced anywhere in this document — only variable names, types, and where they're
used. Real secrets live only in the gitignored `backend/config.env` and `frontend/.env`, never in
git.

**Setting up a new machine?** Follow [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) - it walks through exactly which of these to set locally.

Templates: [`backend/.env.example`](../backend/.env.example) · [`frontend/.env.example`](../frontend/.env.example)

## Backend (`backend/`, Node/Express, loaded via `dotenv` from `config.env` then `.env`)

`server/config/env.js` loads `backend/config.env` first, then `backend/.env` (`.env` wins on conflicts) - used by `server.js`, `api/index.js` and every `npm run db:*` script. A few legacy one-off maintenance scripts (`server/scripts/import*.js`, `update*.js`, `cleanCorruptedTags.js`) read only `config.env`. Vercel reads neither file - production values live in the Vercel project settings.

| Variable | Required | Secret? | Purpose | Source |
|---|---|---|---|---|
| `NODE_ENV` | Required | No | `development` locally / `production` on Vercel. Drives auth-cookie flags (`development` → `SameSite=Lax`, not `Secure`, so cookies work over local http; otherwise `SameSite=None; Secure`), the error-response format, the product-image base URL choice (`DEV_URL` vs `PROD_URL`), and blocks `db:reset` when `production` | `server/utils/cookieOptions.js`, `server/middleware/errorMiddleware.js`, `server/controller/inventory/productController.js`, `server/scripts/resetDb.js` |
| `PORT` | Optional (defaults 5000) | No | HTTP port the server listens on | `server.js` |
| `DB_URI` | Required | **Secret** | MongoDB connection string, including the database name. Must be a **replica set** (Atlas, or a local single-node replica set) - order/payment/advance creation use transactions | `server/database/dbConnection.js`, every `server/scripts/*` |
| `BASE_URL` | Required | No | This server's own public URL; used to build absolute asset URLs (brand/category/subcategory/logo images) | `server/models/brandModel.js`, `categoryModel.js`, `subCategoryModel.js` |
| `FRONTEND_URL` | Required in production; optional locally | No | The exact deployed frontend origin (no trailing slash) - the one production origin CORS allows for cross-origin, credentialed requests. Must be set in the Vercel project's own dashboard for production; local dev origins are always allowed in addition, unconditionally | `server/app.js` |
| `VERCEL` | N/A - platform-provided, never set manually | No | Set automatically to `"1"` by the Vercel runtime/build. Used to skip the cron-based backup scheduler (which cannot work in a serverless environment) and to disable i18next's `saveMissing` filesystem write - see `docs/deployment-vercel.md` | `server/backup/backup.scheduler.js`, `server/app.js` |
| `JWT_SECRET_KEY` | Required | **Secret** | Signs access-token JWTs | `server/utils/createToken.js`, `server/controller/user/authController.js` |
| `JWT_EXPIRES_IN` | Optional | No | Access-token TTL | `server/utils/createToken.js` |
| `REFRESH_TOKEN_SECRET_KEY` | Required | **Secret** | Signs refresh-token JWTs | `server/utils/createToken.js`, `server/controller/user/authController.js` |
| `REFRESH_TOKEN_EXPIRES_IN` | Optional | No | Refresh-token TTL | `server/utils/createToken.js` |
| `DEFAULT_LANGUAGE` | Optional (defaults `en`) | No | i18next fallback language, default locale for i18n model fields | `server/app.js`, several models |
| `DEFAULT_LOCALE` | Optional | No | Locale used for localized color-name lookups | `server/models/inventory/colorModel.js` |
| `CLOUDINARY_URL` | Required (if image uploads used) | **Secret** (embeds API key/secret) | Cloudinary image storage for product/category/brand/vendor/logo images | `server/middleware/fileUploadMiddleware.js` |
| `IMAGE_QUALITY` | Optional | No | Output quality for processed logo image | `server/controller/aboutUsController.js` |
| `SMTP_HOST` | Required (for email) | No | Outbound SMTP host | `server/utils/sendEmail.js`, `server/backup/backup.notifier.js` |
| `SMTP_PORT` | Required (for email) | No | Outbound SMTP port | same |
| `SMTP_USERNAME` | Required (for email) | **Secret**-ish (credential identity) | SMTP auth username / "from" address | same |
| `SMTP_PASSWORD` | Required (for email) | **Secret** | SMTP auth password | same |
| `SMTP_NAME` | Optional (defaults `Reversia`) | No | Display name on outbound emails | same |
| `DEV_URL` | Conditional (`NODE_ENV=development`) | No | Base URL put in front of uploaded **product** image paths - must be the **backend** (it serves `/products/...` from `uploads/`), e.g. `http://localhost:5000` | `server/controller/inventory/productController.js` |
| `PROD_URL` | Conditional (any other `NODE_ENV`) | No | Same as `DEV_URL`, for production | same |
| `DB_URL` | Optional, likely obsolete | **Secret** if set (connection string) | Only read by the standalone `GET /api/v1/bahrain-db-health` ping endpoint - unrelated to the main `DB_URI` connection. (Earlier versions of this document and `.env.example` called it `Bahrain_DB`; the code has always read `process.env.DB_URL`.) | `server/routes/databaseHealth.js` |
| `CUSTOMER_NUMBER_RANGE_START` | Optional (defaults 1000) | No | Seeds the atomic customer-number counter's minimum, the first time it's ever created | `server/services/customer/customerNumberService.js` |
| `CUSTOMER_NUMBER_RANGE_END` | Optional (defaults 999999) | No | Seeds the atomic customer-number counter's maximum, the first time it's ever created - see `docs/entities/customers.md` for how to widen it later without redeploying | same |
| `JOURNAL_ENTRY_NUMBER_RANGE_START` / `_END` | Optional (defaults 100000 / 999999999) | No | Seed range of the atomic journal-entry-number counter (first creation only) | `server/services/accounting/journalEntryNumberService.js` |
| `ACCOUNT_CODE_ACCOUNTS_RECEIVABLE`, `_UNEARNED_REVENUE`, `_CASH`, `_PROJECT_REVENUE`, `_FIXED_ASSETS`, `_ACCOUNTS_PAYABLE`, `_CAPITAL` | Optional (defaults 1100, 2400, 1000, 4000, 1500, 2000, 3000) | No | Lookup codes for the legacy fixed-asset / project-creation entries (`DefaultAccountCodes`). The automatic accounting engine uses its own fixed codes (`AutomaticJournalAccountCodes`) | `server/utils/accountingConstants.js` |
| `TEST_DB_URI` | Optional - leave unset | **Secret** if it pointed at a real DB (never do that) | Overrides every test file's throw-away DB (default `mongodb://127.0.0.1:27017/reversia_test_<name>`) - tests **drop** this database | `server/test/**` |

**No longer read:** `VENDOR_NUMBER_RANGE_START` / `VENDOR_NUMBER_RANGE_END` - vendor numbers start at 2000 and increment by one (2000-2999), a fixed business rule in `server/services/vendor/vendorNumberService.js`. Existing vendors keep their numbers.

**Removed in the Shopify-removal pass** (previously documented here, no longer read by any code):
`SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_API_ACCESS_TOKEN`, `SHOPIFY_API_VERSION`,
`SHOPIFY_WEBHOOK_SECRET`, `SHOPIFY_DEFAULT_LOCATION_ID`, `SHOPIFY_DEFAULT_VENDOR`,
`SHOPIFY_SYSTEM_USER_ID`, `SHOPIFY_QUEUE_*` (5 variables), `SHOPIFY_SYNC_BATCH_SIZE`,
`SHOPIFY_NIGHTLY_SYNC_LOCK_STALE_MINUTES`, `PERMANENT_ERROR_MAX_ATTEMPTS`,
`CLEAR_QUEUE_ON_START`, `DEFAULT_WAREHOUSE_ID`. The entire Shopify integration (config, services,
models, routes, middleware, scripts, the `server.js` bootstrap call) was deleted - see
`docs/reversia-extraction.md`. **The Reversia backend now starts and runs with zero Shopify
credentials configured.**

## Frontend (`frontend/`, Vite/React, `import.meta.env.VITE_*`)

Every Vite `VITE_`-prefixed variable is bundled into the built JS and is visible to anyone who
opens browser dev tools — **never put a true secret in any of these**.

| Variable | Required | Public/Safe? | Purpose | Source |
|---|---|---|---|---|
| `VITE_API_URL` | **Required** (no fallback - requests break without it) | Public | Base URL of the backend API | `src/utils/helpers/api-request.ts` |
| `VITE_ABOUT_ID` | Required only for Customization → About (no fallback; a fresh DB has no About document yet) | Public (it's a Mongo `_id`, not a secret) | The single "About" document's id - needed to GET/PUT the site logo + barcode-sticker settings | `src/pages/admin/customization/components/about-section/about-form.tsx` |
| `VITE_GOOGLE_CLIENT_ID` | Optional (Google login breaks without it, rest of the app is unaffected) | **Public / safe to expose** - OAuth *client IDs* (unlike client *secrets*) are designed to be public | Google OAuth login button | `src/index.tsx` |
| `VITE_PRODUCTS_PER_PAGE` | Optional (defaults to `DEFAULT_ITEMS_PER_PAGE = 25`) | Public | Admin Products table page size | `src/pages/admin/home/products/index.tsx` |
| `VITE_VENDORS_PER_PAGE` | Optional (same default) | Public | Admin Vendors table page size | `src/pages/admin/home/vendors/index.tsx` |
| `VITE_PURCHASE_ORDERS_PER_PAGE` | Optional (same default) | Public | Admin Purchase Orders table page size | `src/pages/admin/home/purchase-orders/index.tsx` |
| `VITE_SALES_ORDERS_PER_PAGE` | Optional (same default) | Public | Admin Sales Orders table page size | `src/pages/admin/home/sales-orders/index.tsx` |
| `VITE_CUSTOMERS_PER_PAGE` | Optional (same default) | Public | Admin Customers table page size | `src/pages/admin/home/customers/index.tsx` |
| `VITE_EXPENSES_PER_PAGE` | Optional (same default) | Public | Admin Expenses table page size | `src/pages/admin/home/expenses/index.tsx` |
| `VITE_TRANSFERS_PER_PAGE` | Optional (same default) | Public | Admin Transfers table page size | `src/pages/admin/home/transfers/index.tsx` |
| `VITE_COUPONS_PER_PAGE` | Optional (same default) | Public | Admin Coupons table page size | `src/pages/admin/coupons/index.tsx` |
| `VITE_PAYMENTS_PER_PAGE` | Optional (same default) | Public | Admin Cash/Payments table page size | `src/pages/admin/cash/index.tsx` |
| `VITE_TRANSACTIONS_PER_PAGE` | Optional (same default) | Public | Admin Transactions table page size | `src/pages/admin/transactions/index.tsx` |
| `VITE_USERS_PER_PAGE` | Optional (same default) | Public | Admin Users table page size | `src/pages/admin/users/index.tsx` |
| `VITE_ITEMS_PER_PAGE` | Optional (same default) | Public | Page size for Fixed Assets, Journal Entries, Projects and Advanced Payments tables | `src/pages/admin/{fixed-assets,journal-entries,projects,advanced-payments}/index.tsx` |

No frontend variable was found holding anything that should have been a server-only secret -
`VITE_GOOGLE_CLIENT_ID` looked suspicious at a glance but is a public OAuth client identifier by
design, not a secret. The frontend never had any Shopify-related variable.

## Config-file / non-`process.env` settings

- `backend/settings.json` — gitignored, holds `{ backupTime, timezone, maxFiles }` for the backup
  scheduler (`server/backup/backup.scheduler.js`). Not `process.env`-based, but functions the same
  way as environment configuration and is worth knowing about.
- No schema-validation library (Zod/Joi/Yup/envalid/envsafe) is used by either app — environment
  variables are read directly via `process.env.X` / `import.meta.env.VITE_X` with ad-hoc
  `|| default` fallbacks, no central validated config object.

## Security review

- **No hardcoded credentials found** in tracked source of either app (checked for `mongodb://`
  URIs, Stripe-style `sk_live_`/`sk_test_` keys, Google `AIza...` keys, PEM private key blocks,
  and generic `password/secret/apiKey/token = "..."` literals). The only `mongodb://` literals
  present are `localhost` dev-fallback defaults in one-off maintenance scripts, not real
  credentials.
- **SECURITY WARNING (fixed during extraction):** `frontend/src/index.tsx` had a **hardcoded
  PostHog API key** (`phc_FBb...`) belonging to the original Leopard company's analytics project,
  wired to fire on every page view including inside this internal admin tool. Removed entirely
  along with the `posthog-js` dependency.
- **SECURITY WARNING (fixed):** `frontend/index.html` had Leopard's real Google Tag Manager
  (`GTM-MKDPL9TD`), Google Analytics (`G-L30LPRBNGQ`), and Meta/Facebook Pixel (`1347137033128682`)
  tracking snippets hardcoded, plus a hardcoded Google Sign-In `client_id` in a stray
  `backend/index.html` test page. All removed - see `docs/reversia-extraction.md`.
- `.gitignore` correctly excludes `backend/config.env` (and `config copy.env`) and
  `frontend/.env`/`*.local`. Verified via `git ls-files` that no `.env`/`config.env` file is
  actually tracked in either repo's git history on the `reversia-extraction` branch.
- The Shopify integration credentials (Admin API token, webhook secret) that used to live in
  `config.env` are no longer read by any code - if a real deployment's `config.env` still has
  `SHOPIFY_*` values set, they're inert and can be deleted.

## Missing documentation (used in code, not previously in any `.env.example`)

Before this audit, `backend/config.env` (the real, gitignored file) only documented the Shopify
variables (now removed) — every other variable in the table above (`DB_URI`, `JWT_SECRET_KEY`,
`BASE_URL`, SMTP, `DB_URL`, etc.) was read by code but undocumented anywhere. The frontend had
**no `.env.example` at all**. Both gaps are closed by the two `.env.example` files this audit
produced.

## Potentially obsolete

- `DB_URL` (formerly documented as `Bahrain_DB`) — name of its route suggests a secondary/legacy database health check unrelated to the main
  accounting database; only one route (`/api/v1/bahrain-db-health`) reads it. Kept as-is per
  instructions not to remove things without confirming they're unused - if nothing currently pings
  that route, it's a candidate for removal in a later cleanup pass, not this one.

## Reversia classification

| Variable | Classification |
|---|---|
| `NODE_ENV`, `PORT`, `DB_URI`, `BASE_URL`, `JWT_*`, `REFRESH_TOKEN_*`, `DEFAULT_LANGUAGE`, `DEFAULT_LOCALE`, `CLOUDINARY_URL`, `IMAGE_QUALITY`, `SMTP_*`, `DEV_URL`, `PROD_URL` | **RETAIN** - required by the accounting backend as extracted |
| `VITE_API_URL`, `VITE_ABOUT_ID`, `VITE_GOOGLE_CLIENT_ID`, all `VITE_*_PER_PAGE` | **RETAIN** - required by the accounting dashboard as extracted |
| `DB_URL` (health-check only) | **UNCERTAIN** - unclear original purpose, not obviously Leopard-storefront-specific, not obviously needed either; see "Potentially obsolete" |
| all `SHOPIFY_*`, `DEFAULT_WAREHOUSE_ID` | **REMOVED** - the entire Shopify integration was deleted per explicit follow-up instruction; these variables are no longer read by any code path and were removed from `.env.example` |
| *(previously removed in the earlier storefront-extraction pass)* `STRIPE_SECRET`, `PAYMOB_*`, `DISCORD_WEBHOOK_*`, `CLIENT_URL` | **LEOPARD-SPECIFIC** - storefront checkout/notification-bot only; their backing code was deleted, so these variables are no longer read by any code path |
| *(removed)* hardcoded PostHog key, GTM/gtag/Meta Pixel IDs, Google Sign-in test page `client_id` | **LEOPARD-SPECIFIC** - not environment variables (hardcoded literals), removed entirely, see Security review above |

No variable currently in either `.env.example` is Shopify- or storefront-specific. Every remaining
variable is required by the accounting dashboard/backend on its own merits.
