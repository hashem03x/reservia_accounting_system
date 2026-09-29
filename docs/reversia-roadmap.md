# Reversia Roadmap

Persistent source of truth for future Claude sessions working on Reversia. Read this **and**
[`reversia-business-logic.md`](reversia-business-logic.md) before touching any accounting/business
logic.

## Project objective

Reversia is a bilingual (Arabic/English) accounting and business management system, extracted from
an older Leopard e-commerce monorepo (see [`reversia-extraction.md`](reversia-extraction.md) for
the extraction history). The storefront, Shopify integration, and all customer-facing e-commerce
surface have been removed. What remains is a pure accounting/business backend: products, customers,
vendors, purchase orders, sales orders, inventory, payments, expenses, treasury, and financial
reports - all driven by real event/data flows, not a flat CRUD API.

Leopard's *data* is not migrated - Reversia starts from an empty database (see
[`database-initialization.md`](database-initialization.md)). Leopard's *business logic* (moving-
average cost, stock-per-warehouse, soft deletion, RBAC, etc.) is preserved wherever it was already
correct, and only changed where a phase's requirements explicitly call for it.

## Architectural principles

1. **Trace before touching.** Every entity's create/update/delete path must be traced end-to-end
   (route → controller → service → model → hooks → reports) before it is modified. See
   `reversia-business-logic.md` for what was found.
2. **One source of truth per calculation.** Don't duplicate a calculation across
   controller/service/report - reuse or refactor instead (e.g. the shared
   `businessPartnerSchemas.js` sub-schemas used by both Customer and Vendor; the shared
   `productTypeValidation.js` used by both create/update validators).
3. **Backend validation is mandatory.** Every rule enforced in the UI must also be enforced
   server-side (express-validator chains + Mongoose schema-level rules). The UI is a convenience,
   not the security boundary.
4. **Soft delete, not hard delete**, for anything with financial/relational history (Customer,
   Vendor, Product all use `isDeleted`, never a real `deleteOne`).
5. **No new infrastructure unless the existing pattern is actually safe to reuse.** Example: this
   phase needed an atomic sequence for customer numbers; the codebase's one existing "sequence"
   pattern (`countDocuments() + 1` in `utils/helper.js`) is not concurrency-safe, so a new
   `Counter` collection + atomic `findOneAndUpdate($inc)` was introduced rather than copying that
   pattern - see `reversia-business-logic.md`'s Customer section.
6. **Bilingual by construction.** No hardcoded English or Arabic strings in components - use the
   existing `useLanguage().translate(en, ar)` convention and `LocalizedEntity` constants maps
   (`utils/constants/*.ts`), never a new i18n library.

## Existing accounting/event flows (discovered, not assumed)

Full detail in `reversia-business-logic.md`. Summary of what actually happens today:

- **Product creation is NOT an inventory event.** Creating a Product never creates a Variant, never
  writes a `Movement`, never touches warehouse stock. Stock only exists once a Variant is
  explicitly created (`POST /products/:id/variants`).
- **The `movements` collection is vestigial.** PO receipt, sales-order fulfillment, and returns all
  mutate `Variant.stock` directly - none of them write a `Movement` document. Only a standalone
  manual-adjustment endpoint (`POST /api/v1/movements`) does. Do not assume `movements` reflects
  real stock history.
- **Customer is not a separate collection - it's `User` with `role: 'user'`.** Online customers
  (historical/legacy - self-registration was removed with the storefront) and offline customers
  (created via the admin Customers page) are the same model, distinguished by `type`.
- **Deletion is soft everywhere it matters** (`isDeleted` flag) on Product, Customer (User),
  Vendor.

## Current phase - Phase 1: Products / Services / Customers / Vendors

Implemented in this pass:

- **Product/Service split** on the existing `Product` model via a `type` field
  (`'product' | 'service'`), with conditional schema requirements, a validator shared between
  create/update, a model-level + controller-level guard preventing a service from ever acquiring
  inventory variants, and one analytics report fixed to exclude services from its
  availability/stock denominator. See [`entities/products.md`](entities/products.md).
- **Customer redesign**: tax info, bank info, six optional PDF documents, and a
  server-generated, atomically-unique, range-configurable Customer Number - added directly to the
  existing `User` model (not a new collection, since Customer already *is* User in this codebase).
  See [`entities/customers.md`](entities/customers.md).
- **Vendor redesign**: tax info, bank info (fixing a pre-existing gap where the frontend already
  sent `bankInfo` but the schema silently dropped it), six optional PDF documents. Deliberately did
  **not** add a vendor-number scheme - none was requested and none existed. See
  [`entities/vendors.md`](entities/vendors.md).
- **Shared document upload pipeline**: PDF-only (MIME + extension checked server-side, 10MB limit),
  Cloudinary `resource_type: 'raw'` storage, one small shared controller
  (`controller/documentController.js`) used by both Customer and Vendor routes.

## Phase 2 - Accounting foundation (Projects / Chart of Accounts / Fixed Assets / Journal Entries)

Implemented in this pass - full detail in [`entities/accounting.md`](entities/accounting.md) and
[`entities/projects.md`](entities/projects.md):

- **Chart of Accounts** (`ChartOfAccount`): real accounting hierarchy (`code`, `name`, `type`,
  self-referencing `parentAccount` for both account groups and "Sub Account under a General
  Account"), replacing the ad-hoc `Vendor.type: 'current'|'equity'` stand-in the report controllers
  used to lean on. A minimal starter set is seeded via `npm run db:seed-accounts`
  (additive/idempotent, safe against a non-empty/live database).
- **Journal Entries** (`JournalEntry`): double-entry engine - header + embedded lines, enforced
  debit=credit balance before posting (model-level, not just controller-level), draft/posted/
  reversed lifecycle, reversal-not-edit for posted entries, and a partial unique index on
  `(sourceType, sourceId)` that makes system-generated entries idempotent.
- **General Ledger**: `services/accounting/generalLedgerService.js` derives account
  balances/trial-balance directly from posted journal lines at read time - no second, independently
  maintained balance structure.
- **Projects** (`Project`): `projectNumber` (user-supplied, unique, effectively immutable),
  `projectAmount`, derived `remainingMoney`, `executor` (ref `User`), single-slot `contract`
  attachment (reusing the Phase 1 PDF upload pipeline). Creating a project **automatically posts** a
  journal entry (Dr Accounts Receivable / Cr Unearned Revenue) in the same database transaction as
  the Project document - confirmed accounting policy, not inferred (see `entities/accounting.md`).
- **Fixed Assets** (`FixedAsset`, pre-existing model): extended additively with `price`,
  `assetAccountId` (ref `ChartOfAccount`), `acquisitionDate`, `status`, `notes` - all optional at
  the schema level so existing documents stay valid. Optionally posts a journal entry on creation,
  only when both the asset and source-of-funds accounts are explicitly supplied (never invented).
- **Known local-dev limitation**: the transaction-dependent tests (Project creation atomicity,
  automatic-entry idempotency) skip themselves on a local, non-replica-set MongoDB rather than
  failing - see `entities/accounting.md`'s last section. Works against the real Atlas cluster.

## Future phases (placeholders - do not assume this list is final or start early)

```text
Phase 3  Orders and order lifecycle
Phase 4  Purchasing / vendor transactions
Phase 5  Inventory
Phase 6  Payments / expenses / financial transactions
Phase 7  Reports wired to the new General Ledger (balanceSheetController.js/
         incomeStatementController.js/financialStatementController.js still compute from raw
         PurchaseOrder/SalesOrder/Expense/Payment queries, NOT from JournalEntry - deliberately
         left alone in Phase 2, see entities/accounting.md)
Phase 8  Advanced accounting modules (depreciation, asset disposal/revaluation, revenue
         recognition over time for unearned revenue)
Phase 9  Final validation / production hardening
```

A concrete, currently-unresolved question for whichever phase touches Orders: **a service cannot
participate in a sales/purchase order under the current schema**, because `SalesOrder.items[]` and
`PurchaseOrder.items[]` reference `Variant`, not `Product`, and services deliberately have zero
variants. Phase 2/3 will need to decide whether service line items reference `Product` directly (a
schema change) or get a lightweight non-stock "virtual variant" - this was flagged, not decided, in
this phase (see `entities/products.md`).

## For future Claude sessions

1. Read this file and `reversia-business-logic.md` first.
2. When you discover a new business rule or event flow, implement it, then update both documents
   (and the relevant `entities/*.md` file) in the same change - don't let them drift from the code.
3. Never reintroduce Shopify, the storefront, or storefront-only infrastructure (see
   `reversia-extraction.md` §2-3 for the full removed-and-why list).
