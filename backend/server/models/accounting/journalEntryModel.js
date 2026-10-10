const { Schema, model } = require('mongoose');
const ApiError = require('../../utils/apiError');
const { JournalEntryStatus, JournalEntrySources, AccountingActions, AccountingModules } = require('../../utils/accountingConstants');

// Explicit requires (not just string `ref:` names) for every model this schema's pre(/^find/)
// hook populates - mirrors paymentModel.js's existing convention of requiring its ref'd models at
// the top. Without this, any code path that touches JournalEntry without having separately
// required ChartOfAccount/Project/User first would hit Mongoose's "Schema hasn't been registered
// for model" error the moment a query tried to populate one of those paths.
require('./chartOfAccountModel');
require('../project/projectModel');
require('../userModel');
require('../sales/salesOrderModel');

// A single debit-or-credit line. Embedded (not a separate collection) - matches this codebase's
// existing convention for line items (PurchaseOrder.items, SalesOrder.items) rather than
// introducing the only normalized line-item collection in the app.
const journalLineSchema = new Schema(
  {
    // "GA" (General Account) in the business terminology this spec was written against maps
    // directly onto a Chart of Accounts entry - see docs/entities/accounting.md.
    account: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: [true, 'Account (GA) is required for every journal line'] },
    // Optional child of `account` (e.g. account 1100 Accounts Receivable -> sub-account "Project
    // #123 receivable"). Not a separate SubAccount model - see chartOfAccountModel.js.
    subAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
    // The resolved Customer/Vendor Number for THIS specific line (docs section "Sub Account
    // behavior") - set only on the one control-account line of an automatic entry that actually
    // represents a business party (e.g. the Suppliers line of a Purchase Order entry, the
    // Accounts Receivable - Projects line of a Sales Order entry) - never on every line of the
    // entry (later automatic entries stamp it on every line - see PartyOnEveryLineModules). Written once at creation time by the automatic accounting engine
    // (accountingEventService.js) - a real, immutable historical snapshot, not a value re-derived
    // from a live Vendor/Customer lookup on every read (which would incorrectly go blank if that
    // vendor/customer is later soft-deleted). `partyType` disambiguates which control account
    // (Customer AR/Advance vs Vendor Payable/Advance) the number belongs to, since both display as
    // the same "Sub Account" UI column. On manual entries it is the line's Sub Account chosen in the
    // Journal Entry form, validated by services/accounting/journalLinePartyService.js.
    partyNumber: { type: Number, default: null },
    partyType: { type: String, enum: { values: ['customer', 'vendor', 'shareholder', null], message: '{VALUE} is not a valid party type' }, default: null },
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    // Denormalized so the Journal Entries UI table can render "Project Number" per line without a
    // populate - the project reference above remains the source of truth/relational key.
    projectNumber: { type: String, trim: true, default: null },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    // Audit-trail only - debit/credit above always hold the local-currency amount (every existing
    // balance/report calculation keeps assuming a single reporting currency). These two fields
    // just preserve the original foreign-currency amount/rate when a line was imported from a
    // multi-currency source, e.g. the CSV accounting import.
    currency: { type: String, trim: true, default: null },
    exchangeRate: { type: Number, default: null },
    description: { type: String, trim: true },
    // Populated only for lines that represent unearned/deferred revenue (e.g. the Cr line of the
    // automatic project-creation entry) - see projectAccountingService.js.
    unearnedRevenue: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

journalLineSchema.pre('validate', function (next) {
  const hasDebit = this.debit > 0;
  const hasCredit = this.credit > 0;
  if (hasDebit === hasCredit) {
    return next(new Error('Each journal line must have either a debit or a credit amount, not both and not neither.'));
  }
  next();
});

const journalEntrySchema = new Schema(
  {
    entryNumber: {
      type: Number,
      required: true,
      unique: true,
      immutable: true,
    },
    date: { type: Date, required: true, default: Date.now },
    description: { type: String, trim: true },
    source: {
      type: String,
      enum: { values: JournalEntrySources, message: '{VALUE} is not a valid journal entry source' },
      default: 'manual',
    },
    // Together with sourceId (and accountingAction below), this is the idempotency key for
    // system-generated entries (e.g. PROJECT_CREATION + a project's _id) - see the partial unique
    // index below. Free-text/manual entries never set these.
    sourceType: { type: String, trim: true, default: null },
    sourceId: { type: Schema.Types.ObjectId, default: null },
    // Which specific automatic accounting action this entry represents (see
    // accountingConstants.js#AccountingActions / services/accounting/accountingEventService.js).
    // A single business event (one sourceType+sourceId) can legitimately produce MORE than one
    // JournalEntry - e.g. a Purchase Order receipt produces both a PO_INVENTORY_RECEIPT entry and
    // a separate PO_INVENTORY_TO_WIP entry. `accountingAction` is what distinguishes them, so the
    // idempotency index below (sourceType+sourceId+accountingAction) allows exactly one JE per
    // *action*, not per source document. Never set on manual entries or on the two legacy
    // automatic flows (project_creation, fixed_asset_purchase), which still only ever produce one
    // JE each and so never needed this disambiguator.
    accountingAction: {
      type: String,
      enum: { values: [...AccountingActions, null], message: '{VALUE} is not a valid accounting action' },
      default: null,
    },
    reference: { type: String, trim: true },
    // The originating business module (docs section "Module field") - normalized through
    // AccountingModules/AccountingModuleByAction (accountingConstants.js), never a free-text
    // variation. Automatic entries get this set explicitly by postAutomaticJournalEntry
    // (accountingEventService.js); manual entries default to 'Manual' in the pre('save') hook
    // below, so every entry - old or new - always has a non-null value to display.
    module: {
      type: String,
      enum: { values: [...AccountingModules, null], message: '{VALUE} is not a valid accounting module' },
      default: null,
    },
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    // Additive, optional link from a PROJECT_REVENUE_RECOGNITION/PROJECT_COST_RECOGNITION entry
    // back to the specific Sales Order whose creation/cancellation/return pushed the project's
    // executedPercentage up and triggered this entry (docs section "Sales Order Source Link").
    // These two actions' real `sourceId` is a deterministic project+percentage hash (see
    // accountingEventService.js#deterministicSourceId), not a real document id, so it can never
    // itself point back at a Sales Order - this field exists specifically to fill that gap without
    // disturbing the existing idempotency key. `null` for every other entry, including historical
    // recognition entries created before this field existed (never backfilled/guessed).
    triggeredBySalesOrder: { type: Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
    // The Advanced Payment this entry belongs to - set by the automatic accounting engine on the
    // advance's own creation entry (ADVANCE_PAYMENT_RECEIVED_CUSTOMER/ADVANCE_PAYMENT_PAID_VENDOR)
    // and on every entry that CONSUMED it (SO_CUSTOMER_ADVANCE_APPLIED, PO_SUPPLIER_ADVANCE_APPLIED,
    // PAYMENT_*_ADVANCE_APPLIED). Powers the "Journal Entries" section of the Advanced Payment
    // details page (journalEntryController.js#getJournalEntriesForAdvancedPayment). Null on every
    // other entry; historical entries created before this field existed are still found there
    // through their own persisted source references (sourceType/sourceId + usageHistory).
    advancedPayment: { type: Schema.Types.ObjectId, ref: 'AdvancedPayment', default: null },
    status: {
      type: String,
      enum: { values: JournalEntryStatus, message: '{VALUE} is not a valid journal entry status' },
      default: 'draft',
    },
    lines: {
      type: [journalLineSchema],
      default: [],
    },
    totalDebit: { type: Number, default: 0, min: 0 },
    totalCredit: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    postedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    postedAt: { type: Date, default: null },
    reversedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reversedAt: { type: Date, default: null },
    // Set on the reversal entry, pointing back at the entry it reverses.
    reversalOfEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    // Set on the original entry once a reversal has been posted against it, so the UI can
    // navigate either direction without a query.
    reversedByEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  },
  { timestamps: true }
);

journalEntrySchema.index({ date: 1 });
journalEntrySchema.index({ project: 1 });
journalEntrySchema.index({ status: 1 });
journalEntrySchema.index({ source: 1 });
journalEntrySchema.index({ advancedPayment: 1 });
// Idempotency, legacy single-JE-per-source flows (project_creation, fixed_asset_purchase): at most
// one journal entry per (sourceType, sourceId) pair when no accountingAction is set. Partial so
// manual entries (sourceId: null) never collide with each other, and so it never conflicts with the
// newer per-action index below (which only applies once accountingAction is actually set).
journalEntrySchema.index(
  { sourceType: 1, sourceId: 1 },
  { unique: true, partialFilterExpression: { sourceId: { $type: 'objectId' }, accountingAction: null } }
);
// Idempotency, the automatic accounting engine (docs section "One business event may create
// multiple automatic journal entries"): at most one journal entry per (sourceType, sourceId,
// accountingAction) triple. This is what allows a single business event (one sourceId) to
// legitimately produce several JEs - one per distinct accountingAction - while still blocking a
// genuine duplicate of the *same* action (e.g. processing the same Purchase Order receipt twice
// must not create two PO_INVENTORY_RECEIPT entries, but creating both PO_INVENTORY_RECEIPT and
// PO_INVENTORY_TO_WIP for that same receipt is exactly the intended behavior).
journalEntrySchema.index(
  { sourceType: 1, sourceId: 1, accountingAction: 1 },
  { unique: true, partialFilterExpression: { sourceId: { $type: 'objectId' }, accountingAction: { $type: 'string' } } }
);

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

journalEntrySchema.methods.isBalanced = function () {
  return round2(this.totalDebit) === round2(this.totalCredit);
};

journalEntrySchema.pre('save', async function (next) {
  try {
    // Closed accounting periods (services/accounting/accountingPeriodService.js): an entry can never
    // be created, edited, posted or re-dated into a closed month, nor moved out of one. Every write
    // path - manual entries, reversals, every automatic entry, imports - passes through here. Marking
    // an entry 'reversed' (status only) does not change its month's figures, so it is allowed.
    const touchesLedger = this.isNew || this.isModified('date') || this.isModified('lines') || (this.isModified('status') && this.status === 'posted');
    if (touchesLedger) {
      const dates = [this.date];
      if (!this.isNew && this.isModified('date')) {
        const stored = await this.constructor.collection.findOne({ _id: this._id }, { projection: { date: 1 } });
        if (stored?.date) dates.push(stored.date);
      }
      // eslint-disable-next-line global-require
      await require('../../services/accounting/accountingPeriodService').assertPeriodsOpen(dates, this.$session());
    }

    // Defense-in-depth: a posted entry's lines must never change in place. The controller is the
    // primary gate (a PATCH is rejected once status !== 'draft'), this catches any other code
    // path that might call .save() directly.
    if (!this.isNew && this.isModified('lines')) {
      // Raw collection access (not this.constructor.findById) - bypasses the pre(/^find/) hook's
      // populate() calls entirely, which is both unnecessary overhead for a single status check
      // and avoids a hard dependency on every populated model (e.g. Project) being registered on
      // this connection at the time this hook runs.
      const original = await this.constructor.collection.findOne({ _id: this._id }, { projection: { status: 1 } });
      if (original && original.status === 'posted') {
        throw new Error('Posted journal entries cannot have their lines modified. Post a reversal entry instead.');
      }
    }

    // RULE 2: a manually-created journal entry (the Journal Entries module's own create
    // form/endpoint - source 'manual') must reference a project. Two kinds of system-generated
    // entries are deliberately exempt from this, both pre-existing features this rule must not
    // regress:
    //   - Reversal entries (`reversalOfEntry` set) - mirrors of an existing entry, which already
    //     copies the original's own `project` verbatim, including `null` for a historical entry
    //     that predates this rule. Reversing must keep working for every existing entry.
    //   - The Fixed Asset purchase auto-entry (source 'fixed_asset_purchase', see
    //     fixedAssetController.js#createFixedAsset) - an unrelated existing feature with no
    //     concept of a project at all; retrofitting it to require one is out of scope here.
    if (this.isNew && !this.reversalOfEntry && this.source === 'manual' && !this.project) {
      throw new Error('Project is required when creating a journal entry.');
    }
    // Every entry always has a Module value to display (docs section "Module field") - automatic
    // entries get theirs set explicitly by postAutomaticJournalEntry; a manual entry (and any other
    // write path that never set one) falls back to 'Manual' here rather than staying null.
    if (this.isNew && !this.module) {
      this.module = this.source === 'manual' ? 'Manual' : null;
    }
    if (this.isNew && this.project) {
      const Project = this.model('Project');
      const projectExists = await Project.exists({ _id: this.project }).session(this.$session() || null);
      if (!projectExists) {
        throw new Error('The selected project does not exist.');
      }
    }

    // RULE 3: a project-related entry carries its Project on EVERY line - the parent entry having a
    // project is not enough. Checked whenever an entry is created, its lines/project change, or a
    // draft is posted; historical entries are never re-validated just for being touched (e.g. a
    // posted entry being marked 'reversed'). Builders fill the lines through
    // services/accounting/journalEntryProjectService.js; this is the backstop that refuses to
    // persist anything else. Reversal entries mirror a historical entry, so a reversal line may keep
    // a different project of its own - but never a missing one.
    const projectRuleApplies = this.isNew || this.isModified('lines') || this.isModified('project') || (this.isModified('status') && this.status === 'posted');
    if (this.project && projectRuleApplies) {
      const Project = this.model('Project');
      const project = await Project.findById(this.project).select('projectNumber').session(this.$session() || null).lean();
      if (!project) throw new Error('The selected project does not exist.');
      const entryProjectId = String(this.project?._id || this.project);
      const describe = (line, index) => `Journal line ${index + 1} (${line.debit > 0 ? `debit ${line.debit}` : `credit ${line.credit}`})`;
      this.lines.forEach((line, index) => {
        const lineProjectId = line.project ? String(line.project._id || line.project) : null;
        if (!lineProjectId) {
          throw new Error(`${describe(line, index)} is missing the Project of its journal entry (Project ${project.projectNumber}). Every line of a project-related journal entry must carry the same Project and Project Number.`);
        }
        if (!line.projectNumber) {
          throw new Error(`${describe(line, index)} is missing the Project Number of its journal entry's Project (${project.projectNumber}).`);
        }
        if (lineProjectId !== entryProjectId) {
          if (!this.reversalOfEntry) {
            throw new Error(`${describe(line, index)} references a different Project than its journal entry (Project ${project.projectNumber}).`);
          }
        } else if (line.projectNumber !== project.projectNumber) {
          throw new Error(`${describe(line, index)} has Project Number "${line.projectNumber}", but its Project's number is "${project.projectNumber}".`);
        }
      });
    }

    // RULE 4: every line has a description. A manual entry's lines must each be described by the
    // user; a system-generated line without one takes its entry's description - the same explicit
    // rule the automatic engine applies (journalEntryProjectService / applyEntryDescriptionAndParty).
    // RULE 5: a manual line's Sub Account (customer / vendor / shareholder number) must exist and fit
    // its account - customer and vendor control accounts require one
    // (services/accounting/journalLinePartyService.js). Historical imports are flagged explicitly.
    if (this.isNew || this.isModified('lines')) {
      const isManual = this.source === 'manual' && !this.reversalOfEntry;
      const historicalImport = this.$locals?.historicalImport === true;
      this.lines.forEach((line, index) => {
        if (line.description && line.description.trim()) return;
        if (isManual && !historicalImport) throw new ApiError(`Journal line ${index + 1}: a description is required.`, 400);
        if (!this.description || !this.description.trim()) throw new ApiError(`Journal line ${index + 1}: a description is required.`, 400);
        line.description = this.description.trim();
      });
      if (isManual && !historicalImport) {
        // eslint-disable-next-line global-require
        await require('../../services/accounting/journalLinePartyService').validateLineParties(this.lines, this.$session());
      }
    }

    this.totalDebit = round2(this.lines.reduce((sum, line) => sum + (line.debit || 0), 0));
    this.totalCredit = round2(this.lines.reduce((sum, line) => sum + (line.credit || 0), 0));

    // RULE 1: total debit must equal total credit - unconditionally, for every status, including
    // `draft`. There is deliberately no `if (status === 'draft') skip...` exception here (see
    // docs section "Journal Entry Lines Must Always Balance to Zero" - a draft is still a
    // persisted accounting record, not a scratchpad, and must never be allowed to go unbalanced).
    if (!this.lines || this.lines.length === 0) {
      throw new Error('A journal entry must have at least one line.');
    }
    if (!this.isBalanced()) {
      throw new Error('Journal entry is not balanced. Total debit must equal total credit.');
    }

    // Stricter than plain balance (a single line could theoretically net to zero-difference only
    // if its debit/credit were both 0, which the line-level pre('validate') hook above already
    // forbids) - kept as an explicit, clearer error specifically for posting.
    if (this.status === 'posted') {
      if (this.lines.length < 2) {
        throw new Error('A journal entry must have at least two lines to be posted.');
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

journalEntrySchema.pre(/^find/, function (next) {
  this.populate({ path: 'lines.account', select: 'code name type' })
    .populate({ path: 'lines.subAccount', select: 'code name type' })
    // Per-line project (distinct from the entry-level `project` below) - was never populated
    // before, so any reader had to fall back to the denormalized `lines.projectNumber` string
    // (historical automatic entries lack it - see RULE 3 in pre('save') and
    // scripts/backfillJournalLineProjects.js). Purely additive/read-only - no business logic
    // depends on this path being populated vs. raw.
    .populate({ path: 'lines.project', select: 'projectNumber name' })
    .populate({ path: 'project', select: 'projectNumber name' })
    .populate({ path: 'triggeredBySalesOrder', select: 'code' })
    .populate({ path: 'createdBy', select: 'name' })
    .populate({ path: 'postedBy', select: 'name' });
  next();
});

module.exports = model('JournalEntry', journalEntrySchema);
