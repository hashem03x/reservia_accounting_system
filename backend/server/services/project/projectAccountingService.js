const { computeProjectExecution } = require('../../utils/projectExecution');

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// NOTE: This service used to also export `createProjectCreationJournalEntry`, which automatically
// posted a Dr Accounts Receivable / Cr Unearned Revenue journal entry whenever a project was
// created. That automatic-accounting behavior was deliberately removed (see
// docs/entities/projects.md) - creating a project now only ever creates the Project document.
// Manual journal entry creation (controller/accounting/journalEntryController.js) is untouched and
// unaffected by this removal; a project's journal entries can still be created/linked by hand.

/**
 * Re-derives and persists Project.remainingMoney = contractValue − (contractValue ×
 * executedPercentage / 100) - the single calculation in utils/projectExecution.js, applied by the
 * Project model's own pre('validate') hook on save. Remaining Amount is driven by the project's
 * execution, not by Payments: this used to compute contractValue − net Payment receipts linked via
 * Payment.projectId, which nothing in the app sets, so Remaining never moved when Executed %
 * changed. Kept (same name/signature) for its existing callers (paymentModel.js,
 * projectController.js#updateProject).
 */
async function recalculateRemainingMoney(projectId, session) {
  const Project = require('../../models/project/projectModel'); // eslint-disable-line global-require

  const project = await Project.findById(projectId).session(session);
  if (!project) return;

  // A project without a usable contractValue (e.g. one created before the projectAmount ->
  // contractValue rename and not yet migrated) has nothing correct to calculate - its stored value
  // is left untouched rather than overwritten.
  const execution = computeProjectExecution(project);
  if (!execution || execution.remainingMoney === project.remainingMoney) return;

  project.remainingMoney = execution.remainingMoney;
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
 * Whenever the recomputed percentage increases, this also posts PROJECT_REVENUE_RECOGNITION the
 * exact same way the old manual-entry path used to (see
 * accountingEventService.js#postProjectExecutionRecognitionJEs) - only the trigger moved (from an
 * admin manually typing a percentage, to Sales Orders actually being created against the project),
 * the recognition accounting itself is completely untouched.
 */
async function recalculateExecutedPercentage(projectId, session, triggeringSalesOrderId = null) {
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
  await postProjectExecutionRecognitionJEs(project, session, triggeringSalesOrderId);
  await project.save({ session });
}

module.exports = { recalculateRemainingMoney, recalculateExecutedPercentage };
