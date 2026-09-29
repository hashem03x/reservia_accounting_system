# Database Initialization

How to stand up a fresh, empty Reversia database (MongoDB), and the one bootstrap admin account
needed to actually log into it. Neither step copies, migrates, or seeds any data from the old
Leopard database.

## Database technology

**MongoDB + Mongoose** (`mongoose ^7.8.3`), confirmed from `server/database/dbConnection.js`
(`mongoose.connect(process.env.DB_URI)`) and `package.json`. No other database
technology/ORM is used anywhere in the backend.

## Database name

Whatever database name is embedded in `DB_URI`'s path (e.g.
`mongodb://localhost:27017/reversia-accounting` → `reversia-accounting`). There is no separate
`DATABASE_NAME` variable in this codebase - Mongoose derives the database purely from the URI's
path segment. **Make sure your `DB_URI` includes an explicit database name** - a URI with no path
segment (e.g. `mongodb+srv://user:pass@cluster.mongodb.net` with nothing after the host) makes
the driver silently default to a database literally named `test`, which is almost never what you
want. `.env.example` documents this.

## Collections created by `npm run db:init`

Every collection below is created empty, with its current schema's indexes built, and **zero**
documents inserted. Names are the actual Mongoose-computed collection names (verified at
runtime via `Model.collection.name`, not guessed).

| Collection | Model | Purpose | Initial documents |
|---|---|---|---|
| brands | Brand | Product brand taxonomy | 0 |
| categories | Category | Top-level product category | 0 |
| subcategories | SubCategory | Product subcategory | 0 |
| coupons | Coupon | Sales-order discount coupons | 0 |
| governorates | Governorate | Shipping region / shipping cost | 0 |
| transactions | Transaction | Treasury/cash transactions | 0 |
| rolechangelogs | RoleChangeLog | Audit log of role/permission changes | 0 |
| users | User | Staff/admin accounts | 0 (see "Bootstrap admin account" below for the one exception) |
| roles | Role | RBAC role + permission definitions | 0 |
| fixedassets | FixedAsset | Company fixed-assets register | 0 |
| aboutusandsubcategories | AboutUsAndSubcategories | Site logo + barcode-sticker print settings | 0 |
| expenses | Expense | Recorded expenses | 0 |
| movements | Movement | Inventory movement log | 0 |
| products | Product | Product catalog | 0 |
| sizes | Size | Product size taxonomy | 0 |
| transfers | Transfer | Inter-warehouse inventory transfers | 0 |
| variants | Variant | Product variants (SKU/size/color/stock) | 0 |
| warehouses | Warehouse | Warehouse locations | 0 |
| salesorders | SalesOrder | Sales orders | 0 |
| salesorderreturns | SalesOrderReturn | Sales order returns | 0 |
| payments | Payment | Vendor/customer payments (treasury ledger) | 0 |
| purchaseorders | PurchaseOrder | Vendor purchase orders | 0 |
| purchaseorderreturns | PurchaseOrderReturn | Purchase order returns | 0 |
| vendors | Vendor | Vendor/supplier records | 0 |
| counters | Counter | Atomic sequence counters (currently: customer numbers) - see [`docs/entities/customers.md`](entities/customers.md) | 0 |

**25 collections total.**

### Models deliberately excluded

Four model files exist under `server/models/` but are **not** part of the running app and are
excluded from this list on purpose (see the comment at the top of
`server/scripts/lib/reversiaModels.js`):

- `server/models/vendor/invoiceModel.js` and `server/models/expense/budgetModel.js` - pre-existing
  dead code, never `require()`'d by any route/controller/service, and each would throw
  `ReferenceError: mongoose is not defined` if it were required (both destructure
  `{ Schema, model }` from `mongoose` but then reference a bare, unimported `mongoose` global
  elsewhere in the file). Not fixed here since nothing in the app would exercise the fix.
- `server/models/inventory/colorModel.js` and `server/models/inventory/imageModel.js` - load
  without error, but nothing requires them and no other schema `ref`s `'Color'` or `'Image'` -
  product/variant color and image data lives as embedded subdocuments on `Product`/`Variant`
  instead. Including them would create two collections the app never reads from or writes to.

## Commands

```bash
npm run db:init
```

Creates all 24 collections above with their indexes, inserts nothing. **Idempotent** - safe to
run again against an already-initialized (still-empty) database; it's a no-op on collections
that already exist.

```bash
npm run db:create-admin -- --email you@example.com --name "Your Name"
```

Creates exactly one `role: "admin"` user - see "Bootstrap admin account" below. Not part of
`db:init` (that command must always insert zero documents) - a deliberate, separate, explicit
step.

```bash
npm run db:reset -- --yes
```

**Development-only, deletes data.** Drops every collection listed above, then recreates them
empty (equivalent to running `db:init` again). Requires the explicit `--yes` flag; refuses if
`NODE_ENV=production`. See "Safety" below for what else it refuses on.

## Bootstrap admin account

`db:init` never inserts documents - by design, there's no way to log into a freshly initialized
database until at least one user exists. `npm run db:create-admin` creates exactly one:

- `role: "admin"`, which `server/middleware/hasPermission.js`'s `checkUserPermissions` grants
  **unconditional full access to every resource/action** regardless of the `permissions` array
  (`if (isAdmin) return next();` - checked before the array is even consulted). "All privileges."
- If `--password` isn't passed, a random 24-character password is generated with
  `crypto.randomBytes` and printed to the console **once** - it is never written to any file or
  log. Copy it immediately and change it after your first login.
- Refuses if a user with that email already exists, unless `--force` is passed (which resets
  that user to `role: "admin"` with a freshly generated password instead of creating a duplicate).
- Uses the exact same password-hashing call (`bcrypt.hash(password, 5)`) as the app's own
  `userController.js#createUser`, so the resulting login credential is guaranteed to work with
  the real `/api/v1/auth/login` endpoint - this was verified by actually logging the hash through
  `bcrypt.compare()` before considering the script correct, not assumed.

This is the one credential deliberately created outside of `db:init`'s "zero business data"
guarantee - it's a login, not business data (no customer/order/product/expense records exist).

## Environment variables

See [`environment-variables.md`](environment-variables.md) for the full audit. The only variable
these scripts need is `DB_URI` (see `.env.example`). `npm run db:create-admin` additionally reads
its `--email`/`--name`/`--password`/`--force` from the command line, not the environment.

**Environment loading**: `server.js`, `initDb.js`, `resetDb.js`, and `createAdminUser.js` all
load configuration through the single shared `server/config/env.js#loadEnv()` - it loads
`config.env` first (the long-documented convention), then a plain `.env` if present, with `.env`
taking precedence when both exist. This was a real, live bug fixed during this work: `server.js`
previously loaded only `config.env` via a hardcoded `dotenv.config({ path: 'config.env' })` call,
so a real deployment's actual values living in `.env` were never read, and the server crashed on
boot with `MongooseError: The uri parameter to openUri() must be a string, got "undefined"`. See
"Bugs found and fixed" below.

## Safety: how these scripts protect against the wrong database

All three scripts share `server/scripts/lib/dbSafety.js`. None of them ever logs the connection
string - the database name used in every check and log line comes from the **connected driver's**
`connection.db.databaseName`, never from parsing the raw URI string (a malformed or unusual URI
can otherwise make naive string-splitting capture the `user:password@host` authority section
instead of a database name - this was caught and fixed during this work, see below).

1. **`DB_URI` must be set.** No attempt is made to guess or default it.
2. **The connected database's name must not look like a Leopard database** (`/leopard/i` test on
   `connection.db.databaseName`).
3. **No Leopard/Shopify-only collection may exist in the target database.** The exact list -
   `carts`, `reviews`, `slides`, `herosections`, `orderdetails`, `discounts`, and all
   `shopify*mappings`/`shopify*runs`/`shopify*jobs`/`shopify*logs`/`shopifywebhookevents` (their
   Mongoose-computed collection names, not hand-typed guesses - see
   `LEOPARD_MARKER_MODEL_NAMES` in `reversiaModels.js`) - comes straight from the models that
   were deleted during the Leopard/Shopify extraction (`docs/reversia-extraction.md`). A database
   can be renamed to hide its origin, but it can't hide the collections the old integration
   actually wrote. This check has no override flag, in either `db:init` or `db:reset`.
4. **`db:init` additionally refuses if the database already contains any document at all**, in
   any collection - the whole point of this command is "zero business data," so this has no
   override flag either. (`db:reset` intentionally does not use this check - deleting data is its
   entire purpose - but it still runs checks 1-3 first.)
5. **`db:reset` additionally refuses without `--yes`, and refuses if `NODE_ENV=production`.**

If a raw MongoDB driver error occurs (e.g. a malformed URI, or a network failure), the scripts
print only the error's `name` plus a generic hint - never `err.message`, since some driver errors
(e.g. `MongoParseError` on a malformed URI) echo the connection string, credentials included,
back into their own message text.

## Bugs found and fixed during this work

Two real, pre-existing (not introduced by this task) bugs were found and fixed because they
directly blocked verifying `db:init`/`db:create-admin`:

1. **`server.js` never loaded `.env`, only `config.env`** - the reported startup crash
   (`MongooseError: uri parameter... got "undefined"`) traced to this: `DB_URI` and every other
   real value lived in `.env`, which nothing loaded. Fixed by extracting a single shared
   `loadEnv()` into `server/config/env.js`, used by `server.js` and all three db scripts, that
   loads both files (`.env` taking precedence). `server/database/dbConnection.js` also now
   validates `DB_URI` is set before calling `mongoose.connect()` (previously: no check, and the
   `.catch()` was commented out, so a failed connection produced an unhandled rejection instead of
   a clear message) - it now logs `Database connection: OK/FAILED` without ever logging the URI.
2. **`userModel.js`'s unique index on `{ email, type }` used `partialFilterExpression: { email: {
   $exists: true, $ne: null }, type: 'online' }`** - MongoDB's partial-index filter only supports
   `$exists`/`$eq`/`$gt(e)`/`$lt(e)`/`$type`/top-level `$and`, not `$ne`/`$not`. This made
   `Model.init()` (and therefore `db:init`) fail outright on the `User` model with
   `Expression not supported in partial index: $not`. Fixed by dropping `$ne: null` - `$exists:
   true` alone already achieves the intended behavior for this app's actual data shape (offline/
   legacy users are created with no `email` field at all, never an explicit `null`).

One more thing was noticed but **not** fixed, since nothing in the running app depends on it:
`userModel.js`'s `pre('save')` hook re-hashes `this.password` via `bcrypt.hash(this.password, 5)`
without `await`-ing it. Empirically this has zero effect on any real code path - every actual
password-setting controller (`createUser`, `resetPassword`, `updateUserPassword`,
`updateLoggedUserPassword`) already pre-hashes the password itself before it ever reaches this
hook (verified: created a user through the exact controller pattern, then confirmed
`bcrypt.compare()` against the stored hash succeeds). Documented here as a latent-but-inert bug
rather than silently fixed, per "do not modify business logic beyond what's necessary."

## Verification actually performed

- **Local MongoDB** (`mongodb://localhost:27017/...`, a disposable database created and dropped
  for this purpose): one full clean `npm run db:init` run - 24/24 collections created, all
  indexes built, 0 documents. Re-ran it a second time against the same (still-empty) database to
  confirm idempotency. Verified each safety refusal fires correctly: a Leopard-named database, a
  database containing a Leopard/Shopify marker collection (`carts`), and a non-empty database were
  each tested and correctly refused. `npm run db:reset -- --yes` was tested end-to-end (drops +
  recreates all 24, verified 0 documents after); confirmed it refuses without `--yes` and refuses
  under `NODE_ENV=production`.
- **The real configured database** (`DB_URI` in the project's own `.env`): `npm run db:init`
  reached all 24 collections (across a few retries - see below), `npm run db:create-admin`
  created the real bootstrap admin account, and `node server.js` was confirmed to boot and log
  `Database connection: OK`.
- **Environment-specific note**: from this particular sandboxed environment, sustained sequences
  of MongoDB admin commands (`createCollection`/`createIndexes`) against the real (Atlas-hosted)
  cluster intermittently hit `MongoNetworkError`/`MongoPoolClearedError` partway through a run -
  confirmed via a raw TLS error (`SSL alert number 80`) to be a network/connection-pool issue
  between this environment and that specific host, not a bug in the script (the exact same
  sequence completed cleanly and repeatably against the local database). `db:init` is idempotent
  and safe to simply re-run if this happens again in your environment - it never re-processes a
  collection that already exists and is empty.
