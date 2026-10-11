const mongoose = require('mongoose');
const Project = require('../../models/project/projectModel');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const { isPucAccountEligible } = require('../../utils/accountingConstants');
const { findCorrespondingPucAccount, deterministicSourceId } = require('../accounting/accountingEventService');
const { getNextJournalEntryNumber } = require('../accounting/journalEntryNumberService');
const { pucAccountsOf, pucCategoryOf } = require('./pucAccountService');
const C = require('../reports/reportCommon');

const { round2 } = C;

// Project costs - estimate vs actual, from the ledger. The single place both the PUC Estimated vs
// Actual report and the Project Profitability report read project cost figures from.
//
//   Estimate   a project's Average Cost lines (Project.averageCostLines: a cost-of-sales account and
//              its estimated amount). Each is paired with its PUC account by the same rule the cost
//              recognition entry (JV0011) uses (findCorrespondingPucAccount).
//   PUC lines  the ledger lines on the project's PUC accounts (posted, including entries later
//              reversed and their reversals - which follow the entry they reverse), split by kind:
//                recognized  PROJECT_COST_RECOGNITION: estimate x executed %, moved to cost of sales
//                adjustment  PUC_ADJUSTMENT: an end-of-project cost adjustment entry
//                actual      everything else: costs incurred (purchases, PUC transfers, manual
//                            entries), net of transfers out, returns and reversals
//   PUC balance = actual - recognized + adjustment (the account's ledger balance)
//   Remaining   = estimate - actual (negative = overrun)
// Nothing here posts anything; prepareCostAdjustment only creates a DRAFT entry on request.

const ADJUSTMENT_SOURCE = 'PUC_ADJUSTMENT';
const oid = id => new mongoose.Types.ObjectId(String(id));

/** Estimate lines of each project: Map projectId -> [{ costAccount, pucAccount|null, estimate }]. */
function estimatesOf(projects, accounts) {
  const eligible = [...accounts.values()].filter(isPucAccountEligible);
  const map = new Map();
  for (const p of projects) {
    map.set(
      String(p._id),
      (p.averageCostLines || []).map(line => {
        const costAccount = accounts.get(C.idOf(line.account)) || null;
        return { costAccount, pucAccount: costAccount ? findCorrespondingPucAccount(costAccount, eligible) : null, estimate: round2(line.amount || 0) };
      })
    );
  }
  return map;
}

/**
 * PUC ledger movements per project and PUC account, by kind, up to `end` (and from `start`, if
 * given): Map `${projectId}|${accountId}` -> { actual, recognized, adjustment }.
 */
async function pucMovements({ pucIds, projectIds = null, start = null, end }) {
  if (!pucIds.length) return new Map();
  const lineMatch = { 'lines.account': { $in: pucIds.map(oid) }, ...(projectIds ? { 'lines.project': { $in: projectIds.map(oid) } } : { 'lines.project': { $ne: null } }) };
  const rows = await JournalEntry.aggregate([
    { $match: C.ledgerMatch({ start, end }) },
    { $lookup: { from: 'journalentries', localField: 'reversalOfEntry', foreignField: '_id', as: 'original', pipeline: [{ $project: { accountingAction: 1, sourceType: 1 } }] } },
    {
      $addFields: {
        effAction: { $ifNull: [{ $first: '$original.accountingAction' }, '$accountingAction'] },
        effSource: { $ifNull: [{ $first: '$original.sourceType' }, '$sourceType'] },
      },
    },
    { $unwind: '$lines' },
    { $match: lineMatch },
    {
      $group: {
        _id: { project: '$lines.project', account: '$lines.account', kind: { $cond: [{ $eq: ['$effAction', 'PROJECT_COST_RECOGNITION'] }, 'recognized', { $cond: [{ $eq: ['$effSource', ADJUSTMENT_SOURCE] }, 'adjustment', 'actual'] }] } },
        net: { $sum: { $subtract: ['$lines.debit', '$lines.credit'] } },
      },
    },
  ]);
  const map = new Map();
  for (const r of rows) {
    const key = `${r._id.project}|${r._id.account}`;
    if (!map.has(key)) map.set(key, { actual: 0, recognized: 0, adjustment: 0 });
    const m = map.get(key);
    // recognized is shown as the (positive) amount moved out of PUC
    if (r._id.kind === 'recognized') m.recognized = round2(m.recognized - r.net);
    else m[r._id.kind] = round2(m[r._id.kind] + r.net);
  }
  return map;
}

/**
 * Rows per project and PUC account: estimate, actual, recognized, adjustments, PUC balance,
 * remaining (estimate - actual), and the adjustment that would clear the balance. A PUC account
 * with movements but no estimate, and an estimate with no matching PUC account, are both included.
 */
async function projectPucPositions({ projects, accounts, start = null, end }) {
  const pucAccounts = await pucAccountsOf(accounts);
  const pucIds = pucAccounts.map(a => String(a._id));
  const estimates = estimatesOf(projects, accounts);
  const movements = await pucMovements({ pucIds, projectIds: projects.map(p => String(p._id)), start, end });
  const result = new Map();
  for (const p of projects) {
    const rows = new Map();
    const lines = estimates.get(String(p._id)) || [];
    const rowFor = (pucAccount, costAccount) => {
      const key = pucAccount ? String(pucAccount._id) : `cost:${String(costAccount._id)}`;
      if (!rows.has(key)) rows.set(key, { pucAccount, costAccount: costAccount || null, estimate: 0, hasEstimate: false, actual: 0, recognized: 0, adjustment: 0 });
      return rows.get(key);
    };
    lines.forEach(l => {
      const row = rowFor(l.pucAccount, l.costAccount);
      row.estimate = round2(row.estimate + l.estimate);
      row.hasEstimate = true;
      if (!row.costAccount) row.costAccount = l.costAccount;
    });
    for (const a of pucAccounts) {
      const m = movements.get(`${p._id}|${a._id}`);
      if (m) Object.assign(rowFor(a, null), { actual: m.actual, recognized: m.recognized, adjustment: m.adjustment });
    }
    result.set(
      String(p._id),
      [...rows.values()].map(r => {
        const balance = round2(r.actual - r.recognized + r.adjustment);
        return {
          ...r,
          category: r.pucAccount ? pucCategoryOf(r.pucAccount) : null,
          balance,
          remaining: r.hasEstimate ? round2(r.estimate - r.actual) : null,
          overrun: r.hasEstimate && r.actual > r.estimate + 0.005,
        };
      })
    );
  }
  return { positions: result, pucAccounts };
}

/** The adjustment that would clear a completed project's PUC balances, line by line - not posted. */
async function costAdjustmentPreview(projectId, { end = new Date() } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(projectId))) throw new ApiError('Invalid project id', 400);
  const project = await Project.findById(projectId).lean();
  if (!project) throw new ApiError('Project not found', 404);
  const accounts = await C.loadAccounts();
  const { positions } = await projectPucPositions({ projects: [project], accounts, end });
  const rows = positions.get(String(project._id)) || [];
  const lines = [];
  const unmapped = [];
  for (const r of rows) {
    if (!r.pucAccount || Math.abs(r.balance) < 0.005) continue;
    if (!r.costAccount) {
      unmapped.push({ pucAccount: { _id: r.pucAccount._id, code: r.pucAccount.code, name: r.pucAccount.name }, balance: r.balance });
      continue;
    }
    // A debit balance left in PUC is actual cost above what was recognized: Dr cost of sales / Cr PUC.
    // A credit balance is cost recognized above actual: Dr PUC / Cr cost of sales.
    const amount = Math.abs(r.balance);
    lines.push({
      pucAccount: { _id: r.pucAccount._id, code: r.pucAccount.code, name: r.pucAccount.name },
      costAccount: { _id: r.costAccount._id, code: r.costAccount.code, name: r.costAccount.name },
      balance: r.balance,
      debit: r.balance > 0 ? { account: r.costAccount._id, amount } : { account: r.pucAccount._id, amount },
      credit: r.balance > 0 ? { account: r.pucAccount._id, amount } : { account: r.costAccount._id, amount },
    });
  }
  const completed = project.status === 'completed' || (project.executedPercentage || 0) >= 100;
  // An adjustment drafted but not posted yet - it is not in the balances above until it is posted.
  const pendingDraft = await JournalEntry.findOne({ sourceType: ADJUSTMENT_SOURCE, project: project._id, status: 'draft' }).select('entryNumber date').lean();
  return { project: { _id: project._id, projectNumber: project.projectNumber, name: project.name || null, status: project.status, executedPercentage: project.executedPercentage || 0 }, completed, lines, unmapped, pendingDraft };
}

/**
 * Creates the cost adjustment as a DRAFT journal entry (it is then reviewed and posted through the
 * normal Journal Entries workflow - period, balance and project rules all apply). Only for a
 * completed project, never while another adjustment draft for it is pending, and never twice for
 * the same request (the entry's source key is per project and adjustment number).
 */
async function prepareCostAdjustment(projectId, { date, userId }, session) {
  const preview = await costAdjustmentPreview(projectId);
  if (!preview.completed) throw new ApiError(`Project ${preview.project.projectNumber} is not completed (executed ${preview.project.executedPercentage}%). The PUC cost adjustment is prepared at the end of a project.`, 400);
  if (!preview.lines.length) throw new ApiError('Nothing to adjust: every PUC balance of this project with a matching cost account is zero.', 400);
  const existing = await JournalEntry.find({ sourceType: ADJUSTMENT_SOURCE, project: preview.project._id }).select('status entryNumber').session(session || null).lean();
  const pending = existing.find(e => e.status === 'draft');
  if (pending) throw new ApiError(`A cost adjustment draft already exists for this project (entry ${pending.entryNumber}). Post or edit it first.`, 409);

  const entryDate = date ? new Date(date) : new Date();
  if (Number.isNaN(entryDate.getTime())) throw new ApiError('Invalid date.', 400);
  const description = `PUC cost adjustment - project ${preview.project.projectNumber}`;
  const lines = preview.lines.flatMap(l => [
    { account: l.debit.account, debit: l.debit.amount, credit: 0, project: preview.project._id, projectNumber: preview.project.projectNumber, description: `${description} - ${l.pucAccount.code}` },
    { account: l.credit.account, debit: 0, credit: l.credit.amount, project: preview.project._id, projectNumber: preview.project.projectNumber, description: `${description} - ${l.pucAccount.code}` },
  ]);
  const [entry] = await JournalEntry.create(
    [
      {
        entryNumber: await getNextJournalEntryNumber(session),
        date: entryDate,
        description,
        reference: `PUC-ADJ-${preview.project.projectNumber}-${existing.length + 1}`,
        source: 'manual',
        status: 'draft',
        project: preview.project._id,
        sourceType: ADJUSTMENT_SOURCE,
        sourceId: deterministicSourceId(`${ADJUSTMENT_SOURCE}:${preview.project._id}:${existing.length + 1}`),
        lines,
        createdBy: userId,
      },
    ],
    { session }
  );
  return entry;
}

module.exports = { estimatesOf, pucMovements, projectPucPositions, costAdjustmentPreview, prepareCostAdjustment, ADJUSTMENT_SOURCE };
