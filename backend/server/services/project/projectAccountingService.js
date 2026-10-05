const Payment = require('../../models/vendor/paymentModel');

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// NOTE: This service used to also export `createProjectCreationJournalEntry`, which automatically
// posted a Dr Accounts Receivable / Cr Unearned Revenue journal entry whenever a project was
// created. That automatic-accounting behavior was deliberately removed (see
// docs/entities/projects.md) - creating a project now only ever creates the Project document.
// Manual journal entry creation (controller/accounting/journalEntryController.js) is untouched and
// unaffected by this removal; a project's journal entries can still be created/linked by hand.

/**
 * Recomputes Project.remainingMoney = contractValue - (confirmed Payment receipts linked to this
 * project). See paymentModel.js's pre('save') hook, which calls this whenever a Payment carries a
 * projectId - no project-payment UI exists yet, but the calculation is already live so a future
 * one needs no API contract change (per master spec's "REMAINING MONEY" section).
 */
async function recalculateRemainingMoney(projectId, session) {
  const Project = require('../../models/project/projectModel'); // eslint-disable-line global-require

  const project = await Project.findById(projectId).session(session);
  if (!project) return;

  // A project created before the projectAmount->contractValue rename, and not yet run through
  // scripts/migrateProjectFieldRenames.js, has no contractValue at all - `undefined - x` is NaN,
  // which would otherwise get written straight into remainingMoney. Skip the recompute rather than
  // persist a NaN; there is nothing correct to calculate until that project's data is migrated.
  if (typeof project.contractValue !== 'number') return;

  const totals = await Payment.aggregate([{ $match: { projectId: project._id } }, { $group: { _id: '$type', total: { $sum: '$amountPaid' } } }]).session(session);
  const inTotal = totals.find(t => t._id === 'in')?.total || 0;
  const outTotal = totals.find(t => t._id === 'out')?.total || 0;

  project.remainingMoney = round2(project.contractValue - (inTotal - outTotal));
  await project.save({ session });
}

/**
 * Recomputes Project.executedPercentage = Σ(SalesOrder.totalAmount for this project, excluding
 * canceled orders) / contractValue × 100 (docs section "Project Executed % Calculation"). Uses
 * `totalAmount` (the sales amount BEFORE VAT/withholding tax - see salesOrderModel.js's pre('save')
 * hook) rather than `grandTotal`, so taxes never affect the result. Clamped to [0, 100] - an
 * over-sold project (sales exceeding contractValue) still reports 100%, never a value the schema's
 * own `max: 100` validator would reject. Falls back to 0% (never NaN/Infinity) when contractValue
 * is missing/zero/negative.
 *
 * Called after any event that changes a project's Sales Order totals (creation, cancellation,
 * returns - see salesOrderCreation.service.js / salesOrderController.js / salesOrderReturnController.js)
 * or its contractValue (see projectController.js#updateProject). Mirrors
 * recalculateRemainingMoney's session-optional pattern above - deliberately never starts its own
 * transaction, so it can safely run both inside an existing one (passed via `session`) and as a
 * plain standalone call.
 *
 * Whenever the recomputed percentage increases, this also posts PROJECT_REVENUE_RECOGNITION/
 * PROJECT_COST_RECOGNITION the exact same way the old manual-entry path used to (see
 * accountingEventService.js#postProjectExecutionRecognitionJEs) - only the trigger moved (from an
 * admin manually typing a percentage, to Sales Orders actually being created against the project),
 * the recognition accounting itself is completely untouched.
 */
async function recalculateExecutedPercentage(projectId, session) {
  const Project = require('../../models/project/projectModel'); // eslint-disable-line global-require
  const SalesOrder = require('../../models/sales/salesOrderModel'); // eslint-disable-line global-require
  const { postProjectExecutionRecognitionJEs } = require('../accounting/accountingEventService'); // eslint-disable-line global-require

  const project = await Project.findById(projectId).session(session);
  if (!project) return;

  let newPct = 0;
  if (typeof project.contractValue === 'number' && project.contractValue > 0) {
    const totals = await SalesOrder.aggregate([
      { $match: { project: project._id, orderStatus: { $ne: 'canceled' } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]).session(session);
    const salesAmount = totals[0]?.total || 0;
    newPct = Math.min(100, Math.max(0, round2((salesAmount / project.contractValue) * 100)));
  }

  if (newPct === project.executedPercentage) return;

  project.executedPercentage = newPct;
  await project.save({ session });
  await postProjectExecutionRecognitionJEs(project, session);
  await project.save({ session });
}

module.exports = { recalculateRemainingMoney, recalculateExecutedPercentage };
