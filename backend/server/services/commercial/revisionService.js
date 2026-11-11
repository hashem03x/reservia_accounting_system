const ApiError = require('../../utils/apiError');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const CommercialApproval = require('../../models/commercial/commercialApprovalModel');
const boqService = require('./boqService');
const pricingConfigService = require('./pricingConfigService');
const { pickLevers, LEVER_KEYS } = require('./commercialPricingService');
const { resolveProjectRegion } = require('../../utils/commercial/regions');
const { computeMdRequired } = require('./approvalService');

// Reservia Commercial - revision lifecycle. Mirrors services/crm/quotationService.js's
// versioning: creating a new revision never edits a previous one, it flips the previous
// `isCurrent` to false and inserts a fresh document. Only the current revision is ever
// recomputed; superseded ones are a frozen historical snapshot from here on.
//
// Pricing levers (QA finding B3):
//   - a NEW revision starts from the Finance pricing configuration (pricingConfigService) and
//     records the configuration version + levers it used (`pricingConfigApplied`);
//   - a RECALCULATION keeps the revision's own levers (the rates used when it was priced) unless
//     the user changes them on the Pricing tab, or explicitly asks to re-apply the current
//     configuration (`applyCurrentConfig`). A Finance change never silently moves an open revision.

function storedLevers(revision) {
  return revision?.pricing ? pickLevers(revision.pricing) : {};
}

/** VAT fraction for a project: an explicit override, else the revision's own, else the configured rate for the country. */
function resolveVat({ project, config, pricingOverrides, revision }) {
  if (typeof pricingOverrides?.vatPct === 'number') return pricingOverrides.vatPct;
  if (revision && typeof revision.pricing?.vatPct === 'number' && revision.pricingConfigApplied?.source) return revision.pricing.vatPct;
  const configured = pricingConfigService.vatFor(config, project.country);
  if (configured !== undefined) return configured;
  if (revision && typeof revision.pricing?.vatPct === 'number') return revision.pricing.vatPct;
  throw new ApiError(`VAT rate is not configured for country "${project.country}" - enter it explicitly.`, 400);
}

async function computeAndSave(project, engineeringInput, { manualOverrides = {}, pricingOverrides = {}, userId, revision = null, applyCurrentConfig = false } = {}) {
  // An Egyptian project must carry a Rates matrix region before anything is calculated (QA B2).
  const regionCheck = resolveProjectRegion(project.country, project.region);
  if (regionCheck.error && project.category !== 'Agriculture Pumping') throw new ApiError(`${regionCheck.error} Edit the project to set it.`, 400);

  const config = await pricingConfigService.getActiveConfig();
  const overrideLevers = pickLevers(pricingOverrides);

  let levers;
  let applied;
  if (!revision || applyCurrentConfig) {
    levers = { ...pricingConfigService.leversFor(config, project.category), ...overrideLevers };
    applied = {
      configVersion: config.version,
      appliedAt: new Date(),
      source: Object.keys(overrideLevers).length ? 'revision' : 'config',
      levers: pricingConfigService.leversFor(config, project.category),
      vatPct: null,
      discountAuthorityPct: config.discountAuthorityPct,
    };
  } else {
    const prior = revision.pricingConfigApplied?.source ? revision.pricingConfigApplied : null;
    levers = { ...storedLevers(revision), ...overrideLevers };
    const changed = LEVER_KEYS.some(k => overrideLevers[k] !== undefined && overrideLevers[k] !== storedLevers(revision)[k]);
    applied = prior
      ? { ...(prior.toObject ? prior.toObject() : prior), source: changed ? 'revision' : prior.source }
      : { configVersion: null, appliedAt: revision.createdAt || null, source: changed ? 'revision' : 'legacy', levers: storedLevers(revision), vatPct: null, discountAuthorityPct: config.discountAuthorityPct };
  }

  const vatPct = resolveVat({ project, config, pricingOverrides, revision: applyCurrentConfig ? null : revision });
  applied.vatPct = vatPct;

  const built = await boqService.buildBoq({
    category: project.category, engineeringInput, country: project.country, region: project.region, manualOverrides,
  });
  const pricing = boqService.priceBoq({ boqTotal: built.boqTotal, kWp: built.kWp, vatPct, levers, discountAuthorityPct: applied.discountAuthorityPct ?? config.discountAuthorityPct });
  const { feasibility, dieselComparison } = boqService.computeFeasibility({
    category: project.category, engineeringInput, pricing, boqTotal: built.boqTotal, kWp: built.kWp, engineeringResult: built.engineeringResult,
  });

  return {
    engineeringInput,
    engineeringResult: built.engineeringResult,
    boqLines: built.lines,
    boqTotal: built.boqTotal,
    pricing,
    mdRequired: computeMdRequired(pricing.netExclVat),
    pricingConfigApplied: applied,
    feasibility: feasibility || null,
    dieselComparison: dieselComparison || null,
    status: 'Calculated',
    invalidatedAt: null,
    invalidationReason: null,
    createdBy: revision ? revision.createdBy : userId,
  };
}

async function createRevision(projectId, engineeringInput, opts = {}) {
  const project = await CommercialProject.findById(projectId);
  if (!project) throw new ApiError('Commercial project not found.', 404);

  const computed = await computeAndSave(project, engineeringInput, { ...opts, revision: null });
  const previousCount = await CommercialRevision.countDocuments({ project: project._id });

  if (previousCount > 0) {
    await CommercialRevision.updateMany({ project: project._id, isCurrent: true }, { $set: { isCurrent: false } });
  }

  const revision = await CommercialRevision.create({
    project: project._id,
    revisionNumber: previousCount + 1,
    isCurrent: true,
    ...computed,
    createdBy: opts.userId,
  });

  project.currentRevision = revision._id;
  project.engineeringApprovalRollup = 'PENDING';
  project.commercialApprovalRollup = 'PENDING';
  await project.save();
  return revision;
}

/**
 * Re-approval rule (brief 4.1): editing the price, BOQ or allocations after a sign-off resets that
 * stage to Pending - and a Rejected stage too, since a rejection means "revise the pricing or
 * allocations" - with an append-only log row recording the reset. Returns the stages reset.
 */
async function resetSignedStages(revision, reason, { userId = null } = {}) {
  const reset = [];
  for (const [field, stage] of [['stage1', 'STAGE1'], ['stage2', 'STAGE2'], ['md', 'MD']]) {
    const current = revision[field];
    if (current && (current.status === 'Approved' || current.status === 'Rejected')) {
      reset.push({ field, stage, previous: current.status });
      revision[field] = { status: 'Pending', approver: null, approverName: null, approverRole: null, decidedAt: null, note: `Reset: ${reason}` };
    }
  }
  revision.releaseStatus = 'NOT RELEASED';
  if (reset.length && userId) {
    await CommercialApproval.insertMany(
      reset.map(r => ({
        revision: revision._id, stage: r.stage, status: 'Pending', approver: userId, note: `Reset from ${r.previous}: ${reason}`,
        valueSnapshot: { netExclVat: revision.pricing?.netExclVat ?? null, grossProfitPct: revision.pricing?.grossProfitPct ?? null },
      }))
    );
  }
  return reset;
}

/** Only the CURRENT revision may be recomputed. */
async function recomputeCurrentRevision(revisionId, engineeringInput, opts = {}) {
  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Commercial revision not found.', 404);
  if (!revision.isCurrent) throw new ApiError('This revision has been superseded and is read-only. Create a new revision instead.', 400);

  const project = await CommercialProject.findById(revision.project);
  const computed = await computeAndSave(project, engineeringInput || revision.engineeringInput, { ...opts, revision });

  await resetSignedStages(revision, 'engineering input or pricing changed after sign-off.', { userId: opts.userId });
  Object.assign(revision, computed);
  await revision.save();

  project.engineeringApprovalRollup = 'PENDING';
  project.commercialApprovalRollup = 'PENDING';
  await project.save();
  return revision;
}

/**
 * QA finding B1: a project edit that changes an input the figures depend on (region -> installation
 * and transport rates; country -> VAT and rates; category -> the whole engine) invalidates the
 * current revision: status Draft, every sign-off reset, release NOT RELEASED. The stored figures
 * stay visible but flagged stale; approvals and proposal issue are blocked until it is recalculated
 * with the new inputs. Never silently keeps the old site costs as if they were still valid.
 */
async function invalidateCurrentRevision(project, reason, { userId = null } = {}) {
  if (!project.currentRevision) return null;
  const revision = await CommercialRevision.findById(project.currentRevision._id || project.currentRevision);
  if (!revision || !revision.isCurrent) return null;
  await resetSignedStages(revision, reason, { userId });
  revision.status = 'Draft';
  revision.invalidatedAt = new Date();
  revision.invalidationReason = reason;
  await revision.save();
  return revision;
}

module.exports = { createRevision, recomputeCurrentRevision, invalidateCurrentRevision, resetSignedStages, computeAndSave };
