# Reversia Business Logic Map

What triggers what, which fields are source-of-truth vs. derived, and which values must never be
manually edited. Read [`reversia-roadmap.md`](reversia-roadmap.md) first for the project-level
context. This document covers the areas touched or newly understood during Phase 1
(Products/Services/Customers/Vendors) - it is not (yet) a complete map of every module.

## Entity relationships

```text
User (role: 'user')  ──customerNumber (own sequence)
   │                 ──documents[] (own, embedded)
   │
   ├─ ref'd by SalesOrder.customer (required)
   └─ ref'd by Payment.customerId

Vendor
   │  ──documents[] (own, embedded)
   │
   ├─ ref'd by PurchaseOrder.vendor
   └─ ref'd by Payment.vendorId

Project (Phase 2 - see entities/projects.md)
   │  ──remainingMoney (derived from Payment.projectId, currently always = projectAmount since
   │                     no payment-collection UI sets projectId yet)
   │  ──contract (single subdocument, own PDF upload)
   │
   ├─ ref'd by JournalEntry.project (automatic entry posted on creation - see entities/accounting.md)
   └─ ref'd by Payment.projectId (optional, not yet used by any UI flow)

ChartOfAccount (Phase 2 - see entities/accounting.md)
   │  ──parentAccount (self-ref: account hierarchy AND "Sub Account" for journal lines)
   │
   ├─ ref'd by JournalEntry.lines[].account / .subAccount
   └─ ref'd by FixedAsset.assetAccountId (optional, Phase 2 addition)

JournalEntry (Phase 2 - see entities/accounting.md)
   │  ──lines[] (embedded, debit XOR credit per line, enforced balance before posting)
   │  ──sourceType + sourceId (partial-unique - idempotent automatic entries)
   │
   └─ source of truth for the General Ledger (services/accounting/generalLedgerService.js
      derives balances from posted lines at read time - no separate balance store)

Product (type: 'product' | 'service')
   │
   ├─ type: 'product' → variants[] (ref Variant, the ONLY place real stock lives)
   │                     └─ Variant.stock[{warehouse, quantity, starterQuantity}]
   │
   └─ type: 'service' → durationValue/durationUnit, NO variants ever (enforced twice - see below)

Variant
   ├─ ref'd by PurchaseOrder.items[].variantId
   └─ ref'd by SalesOrder.items[].variant
```

## Product / Service

### Fields and source of truth

| Field | Source of truth | Notes |
|---|---|---|
| `type` | Set once at creation, immutable in practice (UI never offers changing it after creation) | Drives every conditional rule below |
| `cost`, `category`, `subcategory` | User input, required only when `type: 'product'` | Meaningless for a service |
| `durationValue`, `durationUnit` | User input, required only when `type: 'service'` | Meaningless for a product |
| `price` | User input, required for both | Doubles as the service's selling price - there is no separate "service price" field, by design |
| `variants[]` | Populated exclusively via `POST /products/:id/variants` | **Never** populated for a service - guarded in three independent places (see below) |
| `totalSold` | Written only by `services/sales/salesOrderCreation.service.js` | Never manually editable |

### Events

- **Product created** (`POST /products`, `factory.createOne`): writes the Product document only.
  **Does not** create a Variant, write a Movement, or touch stock - this was true before Phase 1
  and remains true for both `type: 'product'` and `type: 'service'`.
- **Variant created** (`POST /products/:productId/variants`): the only place stock starts to exist.
  **Blocked entirely when the parent product's `type` is `'service'`** - enforced in
  `varaintController.js`'s `createVariant` and `updateVariant` (a clear `ApiError`, not a silent
  no-op) **and** defense-in-depth at the model layer (`productModel.js`'s `pre('save')` hook throws
  if a service document is ever saved with a non-empty `variants` array - this matters because
  `updateProduct` uses a raw `findByIdAndUpdate`, which does not run document middleware, so the
  validator-level check in `productValidator.js`'s `updateProductValidator` is the one that
  actually fires for updates; the model-level hook only fires on `.save()` calls).
- **Product deleted** (soft delete): cascades to zero-and-soft-delete every linked Variant. Only
  relevant to `type: 'product'` (a service has none to cascade to).

### Report impact (what was checked, what was changed)

| Report | Reads | Service impact | Action taken |
|---|---|---|---|
| `analyticsController.getProductAvailabilityAnalysis` | `Product.countDocuments` + `$lookup` on `variants` | Was counting every product (incl. services) toward `totalProducts`, depressing the reported availability % | Added `type: { $ne: 'service' }` filter |
| `productsReportController.js` (list + export) | `Product.aggregate` via shared `buildProductQuery` | Same denominator problem, plus would show services as "0 stock" rows in an inventory-status report | Added the same filter to `buildProductQuery` (single fix point for all four exported functions that share it) |
| `productPriceListReportController.js` | `Product.aggregate` | A service *does* have a legitimate price - showing it in a price list is correct, not a bug | **Not changed** - this is a pricing catalog, not an inventory report |
| `profitByProductReportController.js` | Joins `SalesOrder.items` | A service currently cannot appear in a sales order at all (no variants to reference) | **Not changed** - naturally zero rows, no code path to break |
| Variant/stock-specific reports (`variantStockReportController.js`, `inventorySummaryReportController.js`, etc.) | `Variant.aggregate` | A service has zero variants, so it's simply absent - correct behavior with no code change needed | **Not changed** |

### Open question for a future phase

`SalesOrder.items[].variant` and `PurchaseOrder.items[].variantId` both reference `Variant`, not
`Product`. Under the current schema **a service cannot be sold or purchased at all** - there is no
variant to reference. This was flagged, not resolved, in Phase 1 (see `reversia-roadmap.md`).
Whichever phase implements order line items for services will need to either add a
`Product`-referencing line-item path, or invent a non-stock placeholder - do not silently invent
one now.

## Customer (User, `role: 'user'`)

### Why this lives on `User`, not a new collection

There is no standalone Customer model. "Customer" in this codebase is a `User` document with
`role: 'user'` - confirmed by `controller/user/customerController.js` operating entirely on the
`User` model, and by the existing precedent of customer-only fields (`balance`, `offlineAddress`,
`isGuest`, `isMerged`) already living directly on the `User` schema before this phase. The new
fields (`customerNumber`, `taxInfo`, `bankInfo`, `documents`) follow that same precedent rather than
forking a new collection, which would have split "customer" identity from the online/offline
merge logic that already exists (`combineCustomers`).

### Customer Number - generation and safety

- **Storage**: a dedicated `counters` collection (`models/config/counterModel.js`), one document
  per named sequence (`_id: 'customerNumber'`), holding `{ seq, min, max }`.
- **Generation**: `services/customer/customerNumberService.js#getNextCustomerNumber()`. The
  increment is a single `findOneAndUpdate({ _id, $expr: { $lt: ['$seq', '$max'] } }, { $inc: { seq:
  1 } })` - MongoDB serializes writes to one document, so this is safe under concurrent
  `createCustomer` calls (verified in `server/test/customerNumberService.test.js` by firing 25
  concurrent allocations and asserting every number is unique and the sequence has no gaps).
- **Range exhaustion**: once `seq` reaches `max`, the guarded update matches nothing and the call
  throws a clear `ApiError` - it does **not** wrap around and reissue an old number, and does not
  silently reset. The range is configurable via `CUSTOMER_NUMBER_RANGE_START`/`_END` (used only to
  *seed* the counter document the first time it's created - after that, an administrator can widen
  the range by editing the stored `max` directly, without redeploying).
- **Assignment point**: a `pre('save')` hook on `User` (not the controller), so it applies to *any*
  future path that creates a `role: 'user'` document (bulk import, a future self-signup), not just
  today's `createCustomer`. **Unconditional on `isNew`** - a client-supplied `customerNumber` in the
  request body is always overwritten, never trusted (this was caught by
  `customerNumberService.test.js` during development: an earlier version of the hook only assigned
  a number "if not already set," which let a spoofed value survive; fixed to always assign for new
  `role: 'user'` documents).
- **Immutability**: the schema field is `immutable: true` - once set, no later `.save()`-based
  update can change it. (Controllers never touch it after creation, but this is the same
  belt-and-suspenders approach used for the "not trusted from frontend input" requirement.)
- **Never assigned to staff accounts** (`moderator`/`operator`/`admin`) - the hook's `role !==
  'user'` guard.

### Tax/Bank info and Documents - partial-update semantics

`updateCustomer` merges `taxInfo`/`bankInfo` field-by-field onto the existing subdocument (not a
wholesale replace), so a PUT that only sends one changed bank field never wipes the others -
mirrors the pre-existing pattern already used for `offlineAddress`. Documents are managed via their
own endpoints entirely separate from the main update body, so a customer edit can never
accidentally drop an uploaded document.

## Vendor

Same `taxInfo`/`bankInfo`/`documents` shape as Customer, via the same shared sub-schemas
(`models/shared/businessPartnerSchemas.js`) - kept as one source of truth rather than two parallel
definitions. Two things worth flagging:

- **`bankInfo` existed in the frontend before it existed in the backend schema.** The vendor
  modal already had a "Bank Info" section and captured the values into component state, but the
  field was never in `models/vendor/vendor.js` - Mongoose's default `strict` mode silently dropped
  it on every save, **and** the frontend's submit handler never even included `bankInfo` in the
  request payload in the first place (a second, independent bug). Both are fixed in this phase:
  the schema field now exists, and the payload actually sends it.
- **No vendor-number scheme was added.** The task only specified a *customer* number requirement;
  inventing a parallel vendor numbering scheme would have been scope creep with no requirement
  behind it (see `reversia-roadmap.md`'s architectural principles).

Vendor deletion remains a soft delete (`isDeleted`) exactly as before - unchanged.

## File / document upload architecture

Two pre-existing upload stacks coexist: `uploadImageMiddleware.js` (multer memory storage, no
mimetype restriction, used ad hoc) and `fileUploadMiddleware.js` (multer + Cloudinary, used for
product/category images). Neither restricts to a single file type or applies a size limit suitable
for arbitrary business documents. A third, PDF-specific stack was added -
`middleware/documentUploadMiddleware.js` - rather than bending either existing one:

- Cloudinary `resource_type: 'raw'` (not `'image'`/`'auto'`) - a PDF pushed through the image
  pipeline gets image transformations applied that make no sense for a document.
- Belt-and-suspenders validation: both MIME type (`application/pdf`) and file extension (`.pdf`)
  must agree, checked in a pure, unit-tested function (`isPdfFile`,
  `server/test/documentUpload.test.js`) - client-supplied MIME types are trivially spoofable, so
  neither check alone is trusted.
- 10MB size limit, enforced by multer and translated to a clean `ApiError` (not multer's raw error).
- **No generic Document/File model** - metadata (`documentType`, `url`, `publicId`, `filename`,
  `mimeType`, `uploadedAt`) is embedded directly on the owning Customer/Vendor document, following
  this codebase's existing convention (e.g. `productImageSchema` embedded on `Product`) rather than
  a normalized, separately-queried collection.
- One shared controller (`controller/documentController.js#createDocumentHandlers`) generates the
  upload/delete handlers for both Customer and Vendor, instead of duplicating the logic - uploading
  a document of a type that already exists **replaces** it (destroys the old Cloudinary asset
  first), which is the "Replace" action in the UI.
