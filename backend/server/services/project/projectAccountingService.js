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

  const totals = await Payment.aggregate([{ $match: { projectId: project._id } }, { $group: { _id: '$type', total: { $sum: '$amountPaid' } } }]).session(session);
  const inTotal = totals.find(t => t._id === 'in')?.total || 0;
  const outTotal = totals.find(t => t._id === 'out')?.total || 0;

  project.remainingMoney = round2(project.contractValue - (inTotal - outTotal));
  await project.save({ session });
}

module.exports = { recalculateRemainingMoney };
