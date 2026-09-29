# Accounting Foundation (Chart of Accounts / Journal Entries / General Ledger)

Phase 2 of the Reversia rebuild (see [`../reversia-roadmap.md`](../reversia-roadmap.md)). Adds a
real double-entry accounting layer, which did not exist before this phase - see "What existed
before this phase" below.

## What existed before this phase

- **No Chart of Accounts, Journal Entry, or General Ledger model of any kind.**
- `financialStatementController.js`, `balanceSheetController.js`, `incomeStatementController.js`
  (three separate, overlapping implementations) computed financial statements by directly querying
  `PurchaseOrder`/`SalesOrder`/`Expense`/`Payment`/`FixedAsset`/`Vendor` at request time.
  `Vendor.type: 'current' | 'equity'` was being reused as a poor-man's account-category
  classification (`balanceSheetController.js` pattern-matches `Vendor.name === 'Capital'` /
  `'Retained Earnings'`). **These three report controllers were deliberately left untouched by
  this phase** - rewiring them to derive from the new Journal Entry ledger is future work, not
  done here, since it wasn't required and risked regressing existing reports.
- `models/fixedAssets.js` already existed (`FixedAsset` model, `fixed-assets` routes) - extended,
  not replaced, by this phase (see below).
- `models/transactionModel.js` (`Transaction`) already existed as a legacy payment-gateway record,
  unrelated to accounting - this is why the new ledger model is named `JournalEntry`, not
  `Transaction`.

## Chart of Accounts (`models/accounting/chartOfAccountModel.js`)

`code` (unique), `name`, `type` (`asset|liability|equity|revenue|expense`), optional
self-referencing `parentAccount` (this is also how a Journal Entry line's "Sub Account" works - a
sub-account is just another `ChartOfAccount` document whose `parentAccount` points at the main
account; no separate `SubAccount` model), `isActive` (deactivation, not hard delete - see "Safety"
in the roadmap), `isSystemDefault` (marks accounts the automatic project/fixed-asset entries
depend on, so they can't be casually deactivated).

### Starter accounts

`scripts/seedChartOfAccounts.js` (`npm run db:seed-accounts`) seeds seven accounts by code (Cash
`1000`, Accounts Receivable `1100`, Fixed Assets `1500`, Accounts Payable `2000`, Unearned Revenue
`2400`, Capital `3000`, Project Revenue `4000`) - additive/idempotent (`$setOnInsert`, never
overwrites an account an admin has already edited), safe to run against a database that already
has real data (unlike `db:init`/`db:reset`, it does **not** require an empty database). The exact
codes are centralized in `utils/accountingConstants.js`'s `DefaultAccountCodes` (env-overridable).

## Journal Entries (`models/accounting/journalEntryModel.js`)

Header + embedded `lines[]` (matches the codebase's existing line-item convention -
`PurchaseOrder.items`, `SalesOrder.items` - rather than introducing the app's only normalized
line-item collection). Each line: `account` (ref ChartOfAccount - "GA"/General Account),
`subAccount` (optional, ref ChartOfAccount), `project` (optional ref Project) + denormalized
`projectNumber` (display only, not the source of truth), `debit`/`credit` (exactly one must be
positive, enforced in a `pre('validate')` hook - not a single signed amount, and not a free-text
"DR/CR" field), `unearnedRevenue` (optional, populated only on lines that represent deferred
revenue).

- **Balance invariant**: `totalDebit`/`totalCredit` are recomputed from `lines` on every save; a
  document whose `status` is (or is being set to) `'posted'` must have `totalDebit === totalCredit`
  and at least 2 lines, or the save throws - enforced in the model's `pre('save')` hook (not just
  the controller), so nothing can post an unbalanced entry via any code path.
- **Draft vs Posted vs Reversed**: `status: 'draft' | 'posted' | 'reversed'`. Only a draft can be
  edited (`PATCH /journal-entries/:id`) or posted (`POST /journal-entries/:id/post`). A posted
  entry is never edited or hard-deleted; `POST /journal-entries/:id/reverse` creates a new, fully
  posted entry with every line's debit/credit swapped, linked both ways
  (`reversalOfEntry`/`reversedByEntry`), and flips the original to `status: 'reversed'`. The
  model's `pre('save')` hook also refuses any attempt to modify `lines` on an already-posted
  document directly (defense-in-depth beyond the controller's `status !== 'draft'` check).
- **Reversal date is admin-chosen, never defaulted.** `POST /journal-entries/:id/reverse` requires
  a `reversalDate` in the request body (`reverseJournalEntryValidators` in
  `utils/validators/journalEntryValidators.js` - `notEmpty().isISO8601()`) and uses it as the new
  reversal entry's `date`. It is **never** set to `new Date()` (today), and never copied from
  `original.date` - a confirmed requirement, since a reversal posted today may need to land on a
  specific accounting date (e.g. period-end) unrelated to either. The original entry's own `date`
  is never touched by a reversal. Frontend:
  `frontend/src/pages/admin/journal-entries/_components/reverse-journal-entry-modal.tsx` - shows
  the original entry number/date/total and requires the admin to pick the reversal date before the
  "Confirm Reversal" button is enabled.
- **Idempotency**: a partial unique index on `(sourceType, sourceId)` (only applies when `sourceId`
  is an ObjectId) means at most one system-generated entry can exist per source event - e.g. only
  one `PROJECT_CREATION` entry per project, even under a duplicated/retried request.
- **Numbering**: `entryNumber` via the same atomic-counter pattern as `customerNumber` (see
  `../entities/customers.md`) - `services/accounting/journalEntryNumberService.js`, a
  `findOneAndUpdate($inc)` against `models/config/counterModel.js`'s `Counter` collection, not the
  older race-prone `countDocuments()+1` pattern used elsewhere in this codebase.

## General Ledger (`services/accounting/generalLedgerService.js`)

No second, independently-maintained balance/ledger structure - `getAccountBalance` and
`getTrialBalance` are aggregation queries directly over posted `JournalEntry.lines`, computed at
read time. This is the "single source of truth" the master spec required: if it isn't a posted
journal line, it isn't in the ledger.

**Balance sign convention: `balance = debit - credit`, unconditionally, for every account
regardless of type.** An earlier version of `getAccountBalance` flipped the sign for
liability/equity/revenue accounts to show a "natural" positive balance (e.g. a liability with more
credits than debits displayed as positive); that was replaced with plain `debit - credit` per a
confirmed requirement with worked examples (an Unearned Revenue account carrying more credits than
debits must display as **negative**, e.g. `-100,000`). `getTrialBalance()`'s rows each carry this
same `balance` field. Draft/unposted entries are excluded from both (`{ $match: { status: 'posted'
} }` is the first aggregation stage in each).

**Journal Entry line `Balance` (UI-only) vs Chart of Accounts `Balance` (this service) are two
different numbers, not to be confused:**
- A journal entry *line's* Balance (`frontend/src/pages/admin/journal-entries/[id]/index.tsx`,
  column right after Credit) is `debit - credit` for **that one line only** - purely a display
  computation in the frontend, no backend field, no persistence.
- An *account's* Balance (this service, and the Chart of Accounts page) is the sum of `debit -
  credit` across **every posted line that touches that account**, i.e. the actual running ledger
  balance.

**Total ledger balance is always 0 for internally-consistent data**, because every individual
posted entry is required to be balanced before it can be posted (see above) - summing
`debit - credit` across every account therefore telescopes to `totalDebits - totalCredits` across
the whole ledger, which is 0 by construction. The Chart of Accounts page
(`frontend/src/pages/admin/accounts/index.tsx`) and the Trial Balance modal both compute and
display this sum explicitly (green if zero, red with a warning if not) rather than hiding a
potential imbalance - it should never be non-zero in practice, and if it ever is, that is a real
bug or a direct database write bypassing this app, not something to silently paper over.

## Automatic accounting entry on Project creation

**Confirmed accounting policy for this phase** (this was NOT inferable from the pre-existing
codebase - there was no Project/contract-revenue concept anywhere before this phase, so the policy
was asked for explicitly rather than invented):

```
Dr Accounts Receivable    projectAmount
Cr Unearned Revenue       projectAmount
```

Posted immediately (not left as a draft) - also a confirmed choice for this phase, not a default.
Implemented in `services/project/projectAccountingService.js#createProjectCreationJournalEntry`,
called from `controller/project/projectController.js#createProject` inside the same
`mongoose.startSession()`/transaction that creates the `Project` document - see
[`projects.md`](projects.md) for the transaction-atomicity detail.

If a future phase changes the revenue-recognition policy (e.g. earning unearned revenue over time,
milestone billing), extend `projectAccountingService.js` rather than hardcoding a second policy
elsewhere - it is the one place this decision is made.

## Fixed Assets - extended, not replaced

`models/fixedAssets.js` already existed with `name`, `bookValue`, `fairValue`, `warehouseId`,
`createdBy` (used by the pre-existing `sellFixedAsset`/`loseValue` virtual - both untouched). This
phase adds, additively and all optional at the schema level (so pre-existing production documents
stay valid): `price` (acquisition value - distinct from `bookValue`, which keeps its original
meaning for the sell flow), `assetAccountId` (ref ChartOfAccount - a real relationship, not a
string code), `acquisitionDate`, `status`, `notes`. `fixedAssetValidators.js` requires
`assetAccountId` to reference an existing, active account **only when supplied** - it is required
by the frontend form for new creates, not by the schema, to avoid breaking any other caller.

`createFixedAsset` optionally posts a journal entry (`Dr assetAccountId / Cr sourceAccountId`) -
**only when the caller supplies both accounts explicitly**. Per the master spec's instruction not
to invent a credit/source-of-funds account, omitting either field leaves the asset exactly as it
behaved before this phase (Fixed Asset + Payment only, no journal entry). The whole operation
(FixedAsset + Payment + optional JournalEntry) now runs inside one `mongoose` session/transaction,
mirroring `expenseController.js`'s existing pattern - a modest safety upgrade to a flow that
previously had no atomicity at all.

## Permissions

Three new `Resources` entries (`projects`, `accounts`, `journalEntries`) in
`utils/appConstant.js` / `frontend/src/utils/constants/resources.ts`, granted to
admin/moderator/operator (not to `userPermission`/`defaultPermissions` - accounting is staff-only).
**`fixedAssetRoute.js` was deliberately left on its pre-existing `Resources.expenses` permission
check** rather than switched to a new `fixedAssets` resource, to avoid silently revoking access
from any already-configured role/permission data in the live database.

## Known local-dev limitation: transactions

Multi-document transactions (used by Project creation, Journal Entry reversal, and now Fixed Asset
creation) require a replica set. The real deployment (`DB_URI=mongodb+srv://...` on Atlas) always
is one. A bare local `mongod` Windows service, as used for `npm test` against
`127.0.0.1:27017`, is **not** a replica set by default, so those specific tests skip themselves
with a clear message (`server/test/accounting/projectAccounting.test.js`) rather than failing - the
code is correct and exercised against a real transactional database in production; it's the local
dev database that lacks the capability. Confirmed with the project owner: intentionally left as-is
rather than reconfiguring the shared local MongoDB service.
