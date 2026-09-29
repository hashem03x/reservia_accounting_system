const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const Payment = require('../../models/vendor/paymentModel');
const ApiError = require('../../utils/apiError');
const { getNextJournalEntryNumber } = require('../accounting/journalEntryNumberService');
const { DefaultAccountCodes, JournalEntrySourceTypes } = require('../../utils/accountingConstants');
const { logAccountingEvent, logAccountingError } = require('../../utils/accountingLogger');

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Automatic accounting treatment for project creation, per the accounting policy confirmed for
 * this phase (see docs/entities/accounting.md):
 *
 *   Dr Accounts Receivable         projectAmount
 *   Cr Unearned Revenue            projectAmount
 *
 * The contract is signed (so a receivable exists) but no revenue has been earned yet (so the
 * matching credit is a liability, not revenue) - this was a deliberate choice, not inferred from
 * the codebase, since no Project/contract-revenue concept existed anywhere before this phase (see
 * reversia-roadmap.md's Phase-2 notes). Posted immediately (also a confirmed choice, not a
 * default).
 *
 * Must be called with the same `session` the Project document is created under - see
 * projectController.js#createProject. Idempotent via JournalEntry's partial unique index on
 * (sourceType, sourceId): a retried/duplicated request for the same project throws a clean 11000
 * rather than creating a second entry.
 */
async function createProjectCreationJournalEntry(project, session, userId) {
  const [arAccount, unearnedRevenueAccount] = await Promise.all([
    ChartOfAccount.findOne({ code: DefaultAccountCodes.accountsReceivable, isActive: true }).session(session),
    ChartOfAccount.findOne({ code: DefaultAccountCodes.unearnedRevenue, isActive: true }).session(session),
  ]);

  if (!arAccount || !unearnedRevenueAccount) {
    logAccountingError('PROJECT_ACCOUNTING_ENTRY_FAILED', new Error('Required default accounts missing from Chart of Accounts'), {
      projectId: project._id,
      projectNumber: project.projectNumber,
      accountsReceivableCode: DefaultAccountCodes.accountsReceivable,
      unearnedRevenueCode: DefaultAccountCodes.unearnedRevenue,
    });
    throw new ApiError(
      'Project could not be completed because its accounting entry could not be created: the required Accounts Receivable / Unearned Revenue accounts are missing from the Chart of Accounts. Run the Chart of Accounts seed or create them manually, then try again.',
      400
    );
  }

  const entryNumber = await getNextJournalEntryNumber(session);

  const [entry] = await JournalEntry.create(
    [
      {
        entryNumber,
        date: project.createdAt || new Date(),
        description: `Automatic entry for project ${project.projectNumber} creation`,
        source: 'project_creation',
        sourceType: JournalEntrySourceTypes.PROJECT_CREATION,
        sourceId: project._id,
        project: project._id,
        status: 'posted',
        lines: [
          {
            account: arAccount._id,
            project: project._id,
            projectNumber: project.projectNumber,
            debit: project.projectAmount,
            credit: 0,
            description: `Accounts Receivable - project ${project.projectNumber}`,
          },
          {
            account: unearnedRevenueAccount._id,
            project: project._id,
            projectNumber: project.projectNumber,
            debit: 0,
            credit: project.projectAmount,
            unearnedRevenue: project.projectAmount,
            description: `Unearned Revenue - project ${project.projectNumber}`,
          },
        ],
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
      },
    ],
    { session }
  );

  logAccountingEvent('PROJECT_ACCOUNTING_ENTRY_CREATED', { projectId: project._id, projectNumber: project.projectNumber, journalEntryId: entry._id, entryNumber: entry.entryNumber });

  return entry;
}

/**
 * Recomputes Project.remainingMoney = projectAmount - (confirmed Payment receipts linked to this
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

  project.remainingMoney = round2(project.projectAmount - (inTotal - outTotal));
  await project.save({ session });
}

module.exports = { createProjectCreationJournalEntry, recalculateRemainingMoney };
