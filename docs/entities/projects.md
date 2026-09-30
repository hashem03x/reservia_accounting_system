# Projects

New entity for Phase 2 (see [`../reversia-roadmap.md`](../reversia-roadmap.md) and
[`accounting.md`](accounting.md) for the accounting side). `models/project/projectModel.js`.

**Field renames (post-launch, same phase, see "Field rename history" below):**
`projectAmount` -> `contractValue`, `executor` -> `projectManager`, `department` -> `sector`.
**Automatic journal-entry creation on project creation was removed** - see "No automatic
accounting" below. Both changes shipped together; if you're reading older code, tests, or
screenshots that mention the old names or an auto-created journal entry, they predate this.

## Fields and source of truth

| Field | Source of truth | Notes |
|---|---|---|
| `projectNumber` | User-supplied at creation, required, unique | **Not** auto-generated (unlike `customerNumber`) - the master spec's Project Creation UX explicitly lists it as a field the user fills in, so no numbering-sequence infrastructure was added for it. Never accepted on `PATCH /projects/:id` - the update controller silently ignores it in the request body, same partial-update convention as `updateCustomer`. |
| `contractValue` | User input, required, `min: 0.01` | The signed contract value. Plain `Number` - matches this codebase's existing monetary convention everywhere else (`Product.price`, `PurchaseOrder.totalAmount`, `Payment.amountPaid` are all `Number`, not `Decimal128`). |
| `remainingMoney` | Derived, never accepted from a request body | `= contractValue - confirmed Payment receipts`. See "Remaining money" below. |
| `projectManager` | Ref `User` | The person responsible for managing the project. Reuses the existing `User` model (staff accounts) rather than duplicating name/contact fields - same precedent as `createdBy: ref User` elsewhere in this codebase. |
| `startDate` | User input, required | Plain `Date`. |
| `deliveryDate` | User input, required | Plain `Date`. Must not be before `startDate` - enforced in the model's `pre('validate')` hook (covers every write path, including a partial `PATCH` that only changes one of the two dates against the other's already-saved value) and, as a faster/friendlier pre-check, in `projectValidators.js` for the common case where both are present in the same request body. |
| `contract` | Single optional subdocument (not an array) | `{ url, publicId, filename, mimeType, uploadedAt, uploadedBy }`. Reuses the existing PDF upload pipeline (`middleware/documentUploadMiddleware.js`, Cloudinary `resource_type: 'raw'`) built for Customer/Vendor documents in Phase 1, but as a single "current contract" slot with replace semantics rather than the `documents[]` typed-array shape (`businessPartnerSchemas.js`) - a project has one current contract, not several typed document categories. |
| `status` | User input | `active \| completed \| cancelled \| on_hold`. |
| `sector` | User input, optional | `'Villa' \| 'Industrials' \| null`. See "Sector" below. |
| `isDeleted` | Soft delete | Same convention as Customer/Vendor/Product - never a real `deleteOne`. |

## No automatic accounting

Creating a project **only ever creates the Project document** - no journal entry, no session/
transaction. An earlier version of this app automatically posted a `Dr Accounts Receivable / Cr
Unearned Revenue` journal entry on project creation (see [`accounting.md`](accounting.md) for that
history); that behavior was **deliberately removed** per a later requirement. Specifically removed:

- The `createProjectCreationJournalEntry` function (`services/project/projectAccountingService.js`)
  - deleted entirely, not left as dead code.
- The call to it, and the `mongoose.startSession()`/`withTransaction()` wrapper around
  `Project.create()`, in `controller/project/projectController.js#createProject` - a plain,
  non-transactional `Project.create()` now, since there's no longer a second write to keep atomic
  with it.

**What was deliberately NOT removed**, so existing historical data stays valid:
- `JournalEntrySources` (`utils/accountingConstants.js`) still includes `'project_creation'` -
  Mongoose re-validates every enum path on every `.save()`, including unmodified ones, so removing
  a value still present on old documents would break something as unrelated as reversing one of
  them.
- Any journal entries that a pre-existing project's automatic creation already posted are
  untouched - they remain exactly as they were, reversible like any other posted entry.

Manual journal entries are completely unaffected - `POST /journal-entries` and the rest of the
Journal Entries module (`controller/accounting/journalEntryController.js`) don't know or care that
this removal happened. A project can still have journal entries linked to it
(`JournalEntry.project`); nothing creates them automatically anymore.

## Field rename history

| Old name | New name | Why |
|---|---|---|
| `projectAmount` | `contractValue` | Names the field for what it actually represents - the value of the signed contract. |
| `executor` (المنفذ) | `projectManager` | Clearer English label; same `ref: User` relationship, unchanged. |
| `department` | `sector` | Same optional enum concept; the constant list was renamed too - `ProjectDepartments` -> `ProjectSectors` (`utils/accountingConstants.js`, mirrored in `frontend/src/utils/constants/accounting.ts`). Values (`Villa`, `Industrials`) are unchanged. |

**Migration for existing data**: `scripts/migrateProjectFieldRenames.js` (`npm run
db:migrate-project-fields`, `--dry-run` supported) renames the three fields on any existing
`projects` documents via MongoDB's native `$rename` (raw collection access, not the Mongoose
model - the model only knows the new names) - preserves every value and relationship (e.g.
`executor`'s `User` ObjectId ref becomes `projectManager` with the exact same value), touches
nothing else, and is idempotent (safe to re-run; `$rename` silently skips a field that doesn't
exist on a given document). Must be run once against any database created before this rename - see
the script's own header comment for full detail. **Does not** backfill `startDate`/`deliveryDate`
(see below - those are new fields, not renames).

## Sector

Centralized in **one place per side** - `backend/server/utils/accountingConstants.js`'s
`ProjectSectors` array (currently `['Villa', 'Industrials']`), mirrored in
`frontend/src/utils/constants/accounting.ts`'s `ProjectSectors`. Adding a third sector is a
one-line change in each of those two files - never hardcode a sector string anywhere else (model,
validator, or a frontend form/table).

`sector` is optional and **explicitly nullable in the schema's own enum** (`enum: {values:
[...ProjectSectors, null]}`) rather than left to default via an absent key - this matters
specifically for clearing a previously-set sector through `PATCH /projects/:id`: assigning
`undefined` to an existing Mongoose document path does not reliably unset it on `.save()` (Mongoose
treats `undefined` as "no change" when computing what to persist), but assigning `null` does. Both
`createProject` and `updateProject` normalize an empty/falsy incoming value to `null` before
touching the document for this reason. Projects created before this field existed (or before the
department->sector rename ran) simply have the key absent, which reads identically to `null`
everywhere it's used.

## Remaining money - how it's actually computed today

`Payment` (`models/vendor/paymentModel.js`) already existed as the de facto cash ledger in this
codebase (it mutates Warehouse/Vendor/Customer/PurchaseOrder/SalesOrder balances in its own
`pre('save')` hook), but had no concept of a Project. An optional `projectId` field on `Payment`
(additive - every existing Payment flow is unaffected since nothing sets it) plus a branch in
`Payment`'s `pre('save')` hook calls `services/project/projectAccountingService.js#recalculateRemainingMoney`
whenever a Payment does carry a `projectId`.

**No project-payment UI exists yet** - nothing creates a `Payment` with a `projectId` set today.
`remainingMoney` is initialized to the full `contractValue` at project creation and will only ever
change once a future phase adds a way to record a payment against a project - the calculation is
already live and correct (remaining = full amount, since nothing is paid yet), and needs zero API
changes when that happens.

## New required date fields and existing data

`startDate`/`deliveryDate` are `required: true` in the schema, but Mongoose's `required` only runs
on write (create/save), never retroactively on read - so a project that existed before this change
(and therefore has neither field) remains fully readable; it simply shows no dates until someone
edits it and supplies them. This is not a migration gap to "fix" - there is no old field these two
were renamed from, so there's nothing for `migrateProjectFieldRenames.js` to backfill, and doing so
with a fabricated date would misrepresent real project data.

## Relationship to Journal Entries

`JournalEntry.project` (ref) + `JournalEntry.lines[].project`/`projectNumber` - a project's full
journal history (now exclusively from manually-created entries, see "No automatic accounting"
above) is queryable via `GET /projects/:id/journal-entries` without duplicating any journal data
onto the Project document itself.
