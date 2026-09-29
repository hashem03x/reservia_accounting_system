# Projects

New entity for Phase 2 (see [`../reversia-roadmap.md`](../reversia-roadmap.md) and
[`accounting.md`](accounting.md) for the accounting side). `models/project/projectModel.js`.

## Fields and source of truth

| Field | Source of truth | Notes |
|---|---|---|
| `projectNumber` | User-supplied at creation, required, unique | **Not** auto-generated (unlike `customerNumber`) - the master spec's Project Creation UX explicitly lists it as a field the user fills in, so no numbering-sequence infrastructure was added for it (matches the roadmap's "no new infrastructure unless actually needed" principle). Never accepted on `PATCH /projects/:id` - the update controller silently ignores it in the request body, same partial-update convention as `updateCustomer`. |
| `projectAmount` | User input, required, `min: 0.01` | Plain `Number` - matches this codebase's existing monetary convention everywhere else (`Product.price`, `PurchaseOrder.totalAmount`, `Payment.amountPaid` are all `Number`, not `Decimal128`). |
| `remainingMoney` | Derived, never accepted from a request body | `= projectAmount - confirmed Payment receipts`. See "Remaining money" below. |
| `executor` (المنفذ) | Ref `User` | Reuses the existing `User` model (staff accounts) rather than duplicating name/contact fields - same precedent as `createdBy: ref User` elsewhere in this codebase. |
| `contract` | Single optional subdocument (not an array) | `{ url, publicId, filename, mimeType, uploadedAt, uploadedBy }`. Reuses the existing PDF upload pipeline (`middleware/documentUploadMiddleware.js`, Cloudinary `resource_type: 'raw'`) built for Customer/Vendor documents in Phase 1, but as a single "current contract" slot with replace semantics rather than the `documents[]` typed-array shape (`businessPartnerSchemas.js`) - a project has one current contract, not several typed document categories. |
| `status` | User input | `active \| completed \| cancelled \| on_hold`. |
| `department` | User input, optional | `'Villa' \| 'Industrials' \| null`. See "Department" below. |
| `isDeleted` | Soft delete | Same convention as Customer/Vendor/Product - never a real `deleteOne`. |

## Department

Centralized in **one place per side** - `backend/server/utils/accountingConstants.js`'s
`ProjectDepartments` array (currently `['Villa', 'Industrials']`), mirrored in
`frontend/src/utils/constants/accounting.ts`'s `ProjectDepartments`. Adding a third department is a
one-line change in each of those two files - never hardcode a department string anywhere else
(model, validator, or a frontend form/table).

`department` is optional and **explicitly nullable in the schema's own enum** (`enum: {values:
[...ProjectDepartments, null]}`) rather than left to default via an absent key - this matters
specifically for clearing a previously-set department through `PATCH /projects/:id`: assigning
`undefined` to an existing Mongoose document path does not reliably unset it on `.save()` (Mongoose
treats `undefined` as "no change" when computing what to persist), but assigning `null` does. Both
`createProject` and `updateProject` normalize an empty/falsy incoming value to `null` before
touching the document for this reason. Projects created before this field existed simply have the
key absent, which reads identically to `null` everywhere it's used - no migration was run or
needed.

**No duplicate journal entries are created because of department**, and none of the automatic
project-creation accounting logic changed - `department` is a plain attribute of `Project` only.
The existing `JournalEntry.project` reference is sufficient for a future report to join through to
a project's department (e.g. "revenue by department"), so nothing needed to be denormalized onto
`JournalEntry` itself for this phase.

## Remaining money - how it's actually computed today

`Payment` (`models/vendor/paymentModel.js`) already existed as the de facto cash ledger in this
codebase (it mutates Warehouse/Vendor/Customer/PurchaseOrder/SalesOrder balances in its own
`pre('save')` hook), but had no concept of a Project. This phase adds an **optional**
`projectId` field to `Payment` (additive - every existing Payment flow is unaffected since nothing
sets it) and a new branch in `Payment`'s `pre('save')` hook that calls
`services/project/projectAccountingService.js#recalculateRemainingMoney` whenever a Payment does
carry a `projectId`.

**No project-payment UI exists yet** - nothing in this phase actually creates a `Payment` with a
`projectId` set. `remainingMoney` is initialized to the full `projectAmount` at project creation
and will only ever change once a future phase adds a way to record a payment against a project.
This was a deliberate choice per the master spec: "If the existing system does not yet have a
payment model capable of determining this, design the Project service so the calculation can be
extended later without changing the API contract" - the calculation is live and correct today
(remaining = full amount, since nothing is paid yet), and needs zero API changes when a future
payment-collection flow starts setting `Payment.projectId`.

## Project creation is a single transaction

`controller/project/projectController.js#createProject` wraps `Project.create()` and the automatic
journal entry (`projectAccountingService.js#createProjectCreationJournalEntry` - see
[`accounting.md`](accounting.md)) in one `mongoose.startSession()`/`withTransaction()` call, mirroring
`expenseController.js`'s pre-existing pattern. If the journal entry can't be created (e.g. the
required Accounts Receivable / Unearned Revenue accounts aren't seeded), the whole transaction
aborts and the Project document does not exist - there is no state where a Project exists without
its accounting entry. Verified in
`server/test/accounting/projectAccounting.test.js` (skipped on a non-replica-set local MongoDB -
see [`accounting.md`](accounting.md)'s note on this, works against the real Atlas cluster).

## Relationship to Journal Entries

`JournalEntry.project` (ref) + `JournalEntry.lines[].project`/`projectNumber` - a project's full
journal history is queryable via `GET /projects/:id/journal-entries` without duplicating any
journal data onto the Project document itself.
