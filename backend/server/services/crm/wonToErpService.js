'use strict';

const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const CommercialProposal = require('../../models/commercial/commercialProposalModel');
const Lead = require('../../models/crm/leadModel');
const Activity = require('../../models/crm/activityModel');
const Project = require('../../models/project/projectModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { loadMatchingContext, matchLineToProduct } = require('../commercial/boqProductMatchingService');
const { findOrCreateCustomer } = require('../customer/sharedCustomerService');
const { getNextProjectNumber } = require('../project/projectNumberService');
const { resolveProjectSector } = require('../project/sectorService');
const pricingConfigService = require('../commercial/pricingConfigService');

// Won to ERP Handover, Changes Required (19 Nov 2026), W6-W14. The ERP project page already has
// the right place for a budget (Average Cost) and a BOQ comparison (Raw Materials, BOQ Price vs
// Purchase Cost) - confirmed by reading projectModel.js, not assumed. This service fills those
// EXISTING fields from the locked, Won revision; it does not add a new budget module.
//
// Architectural note, stated plainly rather than silently approximated: this codebase's existing
// CRM<->Commercial boundary (commercialHandoffService.js#onStageChanged) runs AFTER the CRM stage
// change has already committed, and deliberately never fails that commit - a sync problem is
// recorded on the lead and retried from there (see that file's own header comment). This service
// follows the SAME, already-established pattern: ERP project creation is its OWN all-or-nothing
// transaction (Project.create + the CommercialProject/Lead write-back + the CRM timeline entry all
// succeed together or none of them do), but a failure here does not, and architecturally cannot
// without a much larger change to how CRM stage changes work today, revert the CRM lead's stage
// back out of Won. What IS guaranteed: nothing partial is ever left behind (no ERP project without
// its CommercialProject link, no link without the real project), the failure is recorded with its
// real error, and retrying is safe and idempotent.

// ---------------------------------------------------------------- W11: Average Cost mapping

// Reservia Commercial - the SAME BOQ cost-grouping commercialHandoffService.js#erpBudgetFromRevision
// already uses for its internal (Deal-Engine-only) snapshot - reused here, not reinvented, so a
// line is grouped identically whether or not it ever reaches the real ERP.
const BOQ_GROUP_TO_ACCOUNT_NAME = [
  [/^(installation)/i, 'Labour Wages'],
  [/^(transportation)/i, 'Fuel & Logistics'],
];

/** Finds a REAL, active, cogs-type ChartOfAccount by name (case-insensitive) - never creates one. */
async function findCogsAccountByName(name, session) {
  const account = await ChartOfAccount.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), isActive: { $ne: false } })
    .select('_id name type')
    .session(session || null)
    .lean();
  if (!account || account.type !== 'cogs') return null;
  return account;
}

/**
 * W11: builds Project.averageCostLines from the locked revision's BOQ + pricing levers.
 * - Raw Materials / Labour Wages / Fuel & Logistics / Engineering & Design: looked up BY NAME -
 *   the Won to ERP document's own evidence (a real existing project, AGR-0000002) is that these
 *   already exist in the live Chart of Accounts; never invented here if they don't.
 * - Overhead / Contingency / Sales Bonus / Engineering Incentive: each needs its OWN account per
 *   the document (W11/W14); only written when Finance has set a real code for it on the Pricing
 *   Policy page (pricingConfigService's erpCostAccountCodes) - skipped, with a clear warning
 *   naming the gap, when not yet configured. Never invented.
 * - Profit and category addition are explicitly NOT cost (W11) - never included here.
 * @returns {{lines: {account, amount}[], warnings: string[]}}
 */
async function buildAverageCostLines(revision, config, session) {
  const warnings = [];
  const lines = [];
  // `byName`: the three fixed, document-evidenced accounts - always looked up by name, never by a
  // configured code. `byConfiguredCode`: the four new lever accounts - ONLY written when Finance
  // has set a real code for this exact lever (erpCostAccountCodes); a missing code skips the line,
  // it is never guessed by matching the lever's own label against the Chart of Accounts by name.
  const add = async (accountName, amount, { mode = 'byName', code = null } = {}) => {
    if (!(amount > 0)) return;
    let account = null;
    if (mode === 'byConfiguredCode') {
      if (!code) {
        warnings.push(`"${accountName}" has no ERP account code configured on the Pricing Policy page - this Average Cost line (EGP ${Math.round(amount).toLocaleString()}) was NOT written. Finance must confirm the account, then this can be added.`);
        return;
      }
      account = await ChartOfAccount.findOne({ code }).select('_id name type').session(session || null).lean();
      if (account && account.type !== 'cogs') account = null;
      if (!account) {
        warnings.push(`The configured ERP account code "${code}" for "${accountName}" was not found as a COGS account - this Average Cost line (EGP ${Math.round(amount).toLocaleString()}) was NOT written.`);
        return;
      }
    } else {
      account = await findCogsAccountByName(accountName, session);
      if (!account) {
        warnings.push(`"${accountName}" has no matching COGS account in the Chart of Accounts - this Average Cost line (EGP ${Math.round(amount).toLocaleString()}) was NOT written. Finance must confirm the account, then this can be added.`);
        return;
      }
    }
    const existing = lines.find(l => String(l.account) === String(account._id));
    if (existing) existing.amount = Math.round((existing.amount + amount) * 100) / 100;
    else lines.push({ account: account._id, amount: Math.round(amount * 100) / 100 });
  };

  // Raw Materials: every BOQ line that isn't Installation/Transportation (those map to their own
  // named accounts below) - the equipment/materials cost of the BOQ.
  let rawMaterialsTotal = 0;
  for (const l of revision.boqLines || []) {
    const hit = BOQ_GROUP_TO_ACCOUNT_NAME.find(([rx]) => rx.test(l.component));
    if (hit) continue; // handled below by exact name
    rawMaterialsTotal += l.total || 0;
  }
  await add('Raw Materials', rawMaterialsTotal);

  for (const [rx, accountName] of BOQ_GROUP_TO_ACCOUNT_NAME) {
    const total = (revision.boqLines || []).filter(l => rx.test(l.component)).reduce((s, l) => s + (l.total || 0), 0);
    // eslint-disable-next-line no-await-in-loop
    await add(accountName, total);
  }

  const p = revision.pricing || {};
  const codes = config.erpCostAccountCodes || {};
  // eslint-disable-next-line no-await-in-loop
  await add('Project Overhead Allocation', p.overheadAmt, { mode: 'byConfiguredCode', code: codes.overhead });
  // eslint-disable-next-line no-await-in-loop
  await add('Contingency', p.contingencyAmt, { mode: 'byConfiguredCode', code: codes.contingency });
  // eslint-disable-next-line no-await-in-loop
  await add('Sales Bonus', p.salesBonusAmt, { mode: 'byConfiguredCode', code: codes.salesBonus });
  // eslint-disable-next-line no-await-in-loop
  await add('Engineering Incentive', p.engineeringIncentiveAmt, { mode: 'byConfiguredCode', code: codes.engineeringIncentive });

  return { lines, warnings };
}

// ---------------------------------------------------------------- W13: BOQ transfer

/**
 * W13: copies BOQ lines into Project.boqLines - which requires a REAL Product reference
 * (projectModel.js#boqLineSchema), unlike the Commercial revision's free-text component/
 * description. Matching itself (exact Price Book link, or a safe fuzzy fallback with ambiguity/
 * conflicting-size detection) is services/commercial/boqProductMatchingService.js - the ONE place
 * this happens, shared with createPrService.js (Feature 3/B4).
 *
 * A line that matches neither way is NOT written (a guessed Product would misrepresent what was
 * actually quoted) - reported as a warning instead, naming exactly what did not transfer and why.
 * projectModel.js enforces at most one line per product, so two BOQ lines that resolve to the SAME
 * product (e.g. two cable runs of the same confirmed gauge) are merged into one line (quantities
 * summed, unit price re-derived from the combined total) rather than rejected.
 */
async function buildErpBoqLines(boqLines, session) {
  const warnings = [];
  const byProduct = new Map();

  const context = await loadMatchingContext(boqLines, session);

  for (const l of boqLines || []) {
    if (!(l.total > 0) || !(l.qty > 0)) continue; // unpriced/zero-qty lines have nothing to compare

    const { product: match, ambiguous, reason } = matchLineToProduct(l, context);

    if (reason === 'unlinked') {
      warnings.push(`BOQ line "${l.component}" is linked (via its Price Book item) to an ERP product that no longer exists - it was not added to "Raw Materials, BOQ Price vs Purchase Cost". Re-link the Price Book item to a real product.`);
      continue;
    }
    if (reason === 'ambiguous') {
      warnings.push(`BOQ line "${l.component}" (${l.description || 'no description'}) matches ${ambiguous.length} catalog products ambiguously (${ambiguous.map(c => c.title.en).join(', ')}) - it was not added automatically. Link the Price Book item to the correct product (Materials page), or rename the catalog entries so only one matches.`);
      continue;
    }
    if (reason === 'unmatched') {
      warnings.push(`BOQ line "${l.component}" (${l.description || 'no description'}) has no matching product in the ERP catalog - it was not added to "Raw Materials, BOQ Price vs Purchase Cost". Purchasing must create the real product, or link the Price Book item to an existing one.`);
      continue;
    }

    const id = String(match._id);
    const existing = byProduct.get(id);
    if (existing) {
      existing.quantity += l.qty;
      existing.total += l.total;
      existing.unitPrice = round2(existing.total / existing.quantity);
      existing.notes = [existing.notes, l.description].filter(Boolean).join('; ') || null;
    } else {
      byProduct.set(id, { product: match._id, quantity: l.qty, total: l.total, unit: l.unit || null, unitPrice: l.unitPrice || 0, currency: 'EGP', notes: l.description || null });
    }
  }
  const lines = [...byProduct.values()].map(({ total, ...line }) => line);
  return { lines, warnings };
}

// ---------------------------------------------------------------- W12: budget check

/**
 * W12's exact formula, never approximated: Contract Value - Total Average Cost - Profit -
 * Category Addition + Discount must equal 0. Verified against the document's own worked example
 * (DEAL-2026-005): 1,142,784.78 - 883,071.04 - 77,252.30 - 182,461.44 + 0.00 = 0.00.
 * A tiny rounding tolerance (1 EGP) absorbs cent-level rounding across many lines without ever
 * masking a genuine mismatch.
 */
function computeBudgetCheck({ contractValue, totalAverageCost, pricing }) {
  const difference = round2(contractValue - totalAverageCost - (pricing.profitAmt || 0) - (pricing.categoryAdditionAmt || 0) + (pricing.discountAmt || 0));
  return {
    balanced: Math.abs(difference) < 1,
    difference,
    details: {
      contractValue: round2(contractValue),
      totalAverageCost: round2(totalAverageCost),
      profit: round2(pricing.profitAmt || 0),
      categoryAddition: round2(pricing.categoryAdditionAmt || 0),
      discount: round2(pricing.discountAmt || 0),
    },
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------- W6-W10: the main handover

/**
 * Creates the ERP project for a Won deal - idempotent (a project already linked is returned
 * as-is, never duplicated), transactional (all-or-nothing), and never silently invents data it
 * does not have (missing accounts/products/delivery period are reported as warnings, not guessed).
 * Called from commercialHandoffService.js#applyOutcome's 'won' branch, itself called AFTER
 * leadService.js#changeStage's wonReadiness gate (W1-W3) already confirmed the deal is ready.
 *
 * @returns {{erpProject, created: boolean, warnings: string[]}}
 */
async function createErpProjectForWonDeal(commercialProjectId, { userId = null } = {}) {
  const project = await CommercialProject.findById(commercialProjectId);
  if (!project) throw new ApiError('Deal Engine project not found.', 404);

  // W6: idempotent - a retry (or a second trigger) never creates a duplicate.
  if (project.erpProject) {
    const existing = await Project.findById(project.erpProject);
    if (existing) return { erpProject: existing, created: false, warnings: [] };
  }

  const revision = await CommercialRevision.findById(project.currentRevision);
  if (!revision) throw new ApiError('The deal has no revision to create the ERP project from.', 400);
  const proposal = await CommercialProposal.findOne({ project: project._id }).sort({ version: -1 });
  if (!proposal) throw new ApiError('No issued proposal to create the ERP project from.', 400);
  // commercialProjectModel.js's own pre(/^find/) hook already populates `customer` with exactly
  // the fields needed below (name/email/phone) - no second lookup needed.
  const customerUser = project.customer;
  if (!customerUser) throw new ApiError('The deal has no customer to create the ERP project for.', 400);

  const config = await pricingConfigService.getActiveConfig();
  const session = await mongoose.startSession();
  try {
    let erpProject;
    let warnings = [];
    await session.withTransaction(async () => {
      // W7: Customer = deal customer, matched (never duplicated) by phone against the shared ERP/
      // CRM customer record (sharedCustomerService.js - the SAME function the CRM->Deal Engine
      // handoff already uses for the identical purpose).
      const { customer } = await findOrCreateCustomer(
        { name: customerUser.name, phone: customerUser.phone, email: customerUser.email },
        { createdBy: userId, session }
      );

      // W7: Sector = deal sector. Resolved against the REAL, admin-managed Sector list - if "On-
      // Grid C&I" (etc.) is not yet a registered ERP Sector, this throws a clear, actionable error
      // rather than inventing one; the Won stays recorded, the ERP creation can be retried once a
      // matching Sector exists.
      const sector = await resolveProjectSector(project.category, { session });

      // W7: Contract Value = NET price EXCLUDING VAT of the Won revision.
      const contractValue = revision.pricing?.netExclVat;
      if (!(contractValue > 0)) throw new ApiError('The revision has no net price to use as the Contract Value.', 400);

      const { lines: averageCostLines, warnings: costWarnings } = await buildAverageCostLines(revision, config, session);
      const { lines: boqLines, warnings: boqWarnings } = await buildErpBoqLines(revision.boqLines, session);
      warnings = [...costWarnings, ...boqWarnings];

      const totalAverageCost = averageCostLines.reduce((s, l) => s + l.amount, 0);
      const budgetCheck = computeBudgetCheck({ contractValue, totalAverageCost, pricing: revision.pricing });
      if (!budgetCheck.balanced) {
        warnings.push(`Budget check did not balance (difference EGP ${budgetCheck.difference.toLocaleString()}) - the project was created as on_hold ("DRAFT") for the MD to review.`);
      }

      // W9: checked against what the proposal actually states (settings.paymentTerms.standard/
      // small, from dealEngineSettings.js) - that is free descriptive text tied to delivery
      // MILESTONES ("30% on delivery of modules... 30% on commissioning"), not day-tenor
      // installments. The ERP's own customerPaymentTerms schema (utils/documentPaymentTerms.js)
      // only supports day-tenor-based schedules, and no milestone-to-days mapping has been agreed
      // - inventing tenor days here would misstate the actual contract. Left unset, same as the
      // undefined default delivery period above: a real gap for Finance/MD to close, not guessed.
      const customerPaymentTerms = null;

      // W7: Start Date = Won date; Delivery Date = Won date + the proposal's delivery period - no
      // field anywhere in this codebase captures a delivery period yet (confirmed by searching for
      // one), and the source document itself flags the DEFAULT as an open MD decision ("MD to
      // confirm... the default delivery period when the proposal does not state one"). Left unset
      // rather than inventing a number - never silently guessed.
      const startDate = new Date();
      const deliveryDate = null;

      const projectNumber = await getNextProjectNumber(sector, session);
      const dealProjectNumber = project.dealNumber ? `${project.dealNumber}-PRJ` : null;

      const created = await Project.create(
        [
          {
            projectNumber,
            name: project.name,
            // W7: Description = deal number, proposal number, kWp and scope.
            description: `${project.dealNumber || ''} / ${proposal.proposalNumber} - ${revision.pricing?.designKwp ? `${revision.pricing.designKwp} kWp - ` : ''}${project.scope || 'Supply & Installation'}`.trim(),
            contractValue,
            remainingMoney: contractValue,
            projectManager: null, // W7: left empty, flagged "to assign" via the note below
            startDate,
            deliveryDate,
            customer: customer._id,
            sector,
            status: budgetCheck.balanced ? 'active' : 'on_hold',
            averageCostLines,
            customerPaymentTerms,
            boqLines,
            dealNumber: project.dealNumber || null,
            proposalNumber: proposal.proposalNumber,
            crmLeadNumber: project.crmLeadRef || null,
            dealProjectNumber,
            budgetCheck,
            createdBy: userId,
          },
        ],
        { session }
      );
      erpProject = created[0];

      // W10: write the real ERP number back to the Deal Engine project.
      await CommercialProject.updateOne(
        { _id: project._id },
        { $set: { erpProject: erpProject._id, erpProjectNumber: erpProject.projectNumber } },
        { session }
      );

      // W10: write it back to the CRM lead too, with a working link, and log the CRM timeline.
      if (project.crmLead) {
        await Lead.updateOne({ _id: project.crmLead }, { $set: { 'commercial.erpProjectNumber': erpProject.projectNumber } }, { session });
        await Activity.create(
          [
            {
              lead: project.crmLead,
              type: 'system',
              body: `ERP project ${erpProject.projectNumber} (${dealProjectNumber || 'no deal number'}) created automatically from the Won deal.${warnings.length ? ` ${warnings.length} item(s) need manual follow-up - see the ERP project.` : ''} Project Manager still needs to be assigned.`,
              author: userId,
            },
          ],
          { session }
        );
      }
    });
    return { erpProject, created: true, warnings };
  } finally {
    await session.endSession();
  }
}

module.exports = { createErpProjectForWonDeal, buildAverageCostLines, buildErpBoqLines, computeBudgetCheck };
