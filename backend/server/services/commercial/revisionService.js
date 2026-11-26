const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const CommercialApproval = require('../../models/commercial/commercialApprovalModel');
const CommercialSupplier = require('../../models/commercial/supplierModel');
const boqService = require('./boqService');
const pricingConfigService = require('./pricingConfigService');
const { pickLevers, LEVER_KEYS } = require('./commercialPricingService');
const { resolveProjectRegion } = require('../../utils/commercial/regions');
const { computeMdRequired, invalidateForChanges, recordResets, syncProjectRollups, workflowStatus, computeReleaseStatus } = require('./approvalService');
const { fingerprints } = require('../../utils/commercial/approvalFingerprint');
const dealEngineSettings = require('./dealEngineSettings');
const { assertSalesPricingWithinLimits } = require('../../utils/commercial/dealEnginePermissions');

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

/**
 * Feature 2/3/B3/B4 - a BOQ line's selected vendor AND its already-procured quantity
 * (orderedQty - Create PR's atomic guard against overspending the line) must survive editing,
 * recalculation, and a brand-new revision, even though boqLines is a COMPLETE rebuild from the
 * engine every time (built.lines above is plain objects with neither field, and no `_id` that
 * would match the old array's). Carried forward by `component` - the SAME key boqService.js
 * itself already uses for manual-override carry-forward (overridesByComponent), so a line is
 * matched identically whether the carried-forward value is a price override, a vendor, or an
 * ordered quantity. Losing orderedQty on a recalculation would silently let a line be
 * over-procured (Create PR would think the full BOQ quantity was still available) - exactly the
 * invariant this function exists to protect.
 */
function carryForwardVendors(newLines, oldLines) {
  if (!oldLines?.length) return newLines;
  const byComponent = new Map(oldLines.filter(l => l.vendor || l.orderedQty).map(l => [l.component, { vendor: l.vendor, orderedQty: l.orderedQty || 0 }]));
  if (!byComponent.size) return newLines;
  return newLines.map(line => {
    const carried = byComponent.get(line.component);
    if (!carried) return line;
    return { ...line, ...(carried.vendor ? { vendor: carried.vendor } : {}), ...(carried.orderedQty ? { orderedQty: carried.orderedQty } : {}) };
  });
}

/**
 * Manual BOQ overrides survive a recalculation (the rule in boqService.js#applyManualOverrides: an
 * override is applied ON TOP of the live recalculation). They are stored only on the lines
 * themselves (source 'override', with the auto values alongside), so they are read back from the
 * revision's own lines - only the field that really differs from the auto value is carried, so a
 * price override does not freeze a quantity the engineering would now change. The request's
 * overrides win; `null` for a component clears its override ("reset to auto").
 */
function carriedOverrides(oldLines, requested = {}) {
  const out = {};
  for (const l of oldLines || []) {
    if (l.source !== 'override') continue;
    const o = {};
    if (l.qty != null && l.qty !== l.autoQty) o.qty = l.qty;
    if (l.unitPrice != null && l.unitPrice !== l.autoUnitPrice) o.unitPrice = l.unitPrice;
    if (Object.keys(o).length) out[l.component] = l.notes ? { ...o, notes: l.notes } : o;
  }
  for (const [component, o] of Object.entries(requested || {})) {
    if (o === null) delete out[component];
    else if (o && typeof o === 'object') out[component] = { ...(out[component] || {}), ...o };
  }
  return out;
}

/** What a recalculation changed - returned to the dashboard so the user sees the effect (never persisted). */
function recalcSummary(before, after) {
  const byComp = new Map((before.boqLines || []).map(l => [l.component, l]));
  const changedLines = [];
  for (const l of after.boqLines || []) {
    const b = byComp.get(l.component);
    if (!b) { changedLines.push({ component: l.component, change: 'added', qty: l.qty, unitPrice: l.unitPrice }); continue; }
    byComp.delete(l.component);
    const d = {};
    if ((b.qty ?? null) !== (l.qty ?? null)) d.qty = { from: b.qty ?? null, to: l.qty ?? null };
    if ((b.unitPrice ?? null) !== (l.unitPrice ?? null)) d.unitPrice = { from: b.unitPrice ?? null, to: l.unitPrice ?? null };
    if ((b.description || '') !== (l.description || '')) d.description = { from: b.description || '', to: l.description || '' };
    if (Object.keys(d).length) changedLines.push({ component: l.component, change: 'changed', ...d });
  }
  for (const b of byComp.values()) changedLines.push({ component: b.component, change: 'removed' });
  const pick = r => ({ boqTotal: r.boqTotal ?? null, netExclVat: r.pricing?.netExclVat ?? null, grossInclVat: r.pricing?.grossInclVat ?? null });
  return {
    revisionNumber: after.revisionNumber,
    previous: pick(before),
    current: pick(after),
    changedLines,
    overridesKept: (after.boqLines || []).filter(l => l.source === 'override').length,
    linesWithPriceNotes: (after.boqLines || []).filter(l => l.priceNote).map(l => l.component),
  };
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

  // Deal Engine settings (C1-C4, C7, C9, discount rate) - recorded on the revision with the rule version (C11).
  const engineSettings = dealEngineSettings.engineSettings(config);
  const built = await boqService.buildBoq({
    category: project.category, engineeringInput, country: project.country, region: project.region, manualOverrides: carriedOverrides(revision?.boqLines, manualOverrides), engineSettings,
  });
  // Cable-breaker protection coordination (onGridEngine.js#sizeAcCable, 2026 engineering review):
  // never let a proposal go out with an AC cable that cannot safely carry its own breaker's rated
  // current after derating. `acCable` only exists on On-Grid/Utility-Scale results, so this is a
  // no-op for every other category.
  if (built.engineeringResult?.acCable?.protectionOk === false) {
    throw new ApiError(`Cable protection requirement violated: ${built.engineeringResult.acCable.flag}`, 400);
  }
  const pricing = boqService.priceBoq({ boqTotal: built.boqTotal, kWp: built.kWp, vatPct, levers, discountAuthorityPct: applied.discountAuthorityPct ?? config.discountAuthorityPct });
  const { feasibility, dieselComparison } = boqService.computeFeasibility({
    category: project.category, engineeringInput, pricing, boqTotal: built.boqTotal, kWp: built.kWp, engineeringResult: built.engineeringResult, engineSettings, region: project.region,
  });

  return {
    engineeringInput,
    engineeringResult: built.engineeringResult,
    boqLines: carryForwardVendors(built.lines, revision?.boqLines),
    boqTotal: built.boqTotal,
    pricing,
    mdRequired: computeMdRequired(pricing.netExclVat),
    pricingConfigApplied: applied,
    feasibility: feasibility || null,
    dieselComparison: dieselComparison || null,
    status: 'Calculated',
    ruleVersion: dealEngineSettings.RULE_VERSION,
    engineSettingsApplied: { configVersion: config.version, ...engineSettings },
    priceChangedSinceCalculation: false,
    invalidatedAt: null,
    invalidationReason: null,
    lastCalculatedAt: new Date(),
    // 3-stage approval: every (re)calculation is on workflow 2 and records what an approval signs.
    approvalWorkflow: 2,
    lastCalculatedBy: userId || null,
    createdBy: revision ? revision.createdBy : userId,
  };
}

async function createRevision(projectId, engineeringInput, opts = {}) {
  const project = await CommercialProject.findById(projectId);
  if (!project) throw new ApiError('Deal Engine project not found.', 404);

  // A resubmitted "Calculate & Create Revision" (double submit, or a retry after a timeout whose
  // first request did succeed) must not add a second revision. The engineering form sends one
  // requestId per form session; a revision already created with it is returned as it is. Identical
  // INPUTS alone are not a duplicate: a new revision with the same inputs is a legitimate way to
  // re-price after a Rates matrix or Finance change.
  const requestId = typeof opts.requestId === 'string' && opts.requestId.trim() ? opts.requestId.trim().slice(0, 80) : null;
  if (requestId) {
    const existing = await CommercialRevision.findOne({ project: project._id, createRequestId: requestId });
    if (existing) {
      existing.$locals.duplicateOf = true;
      return existing;
    }
  }

  const computed = await computeAndSave(project, engineeringInput, { ...opts, revision: null });
  computed.approvalBasis = fingerprints(computed);
  // R9: checked on the REAL computed result, before anything is persisted - never a separate,
  // possibly-diverging dry-run calculation (opts.roles/salesLimits come from the controller;
  // absent for internal callers like duplicateProject, which correctly skip this check).
  if (opts.salesLimits) assertSalesPricingWithinLimits(opts.roles, computed.pricing, opts.salesLimits);
  const previousCount = await CommercialRevision.countDocuments({ project: project._id });

  if (previousCount > 0) {
    // Feature 2/B3 - a brand NEW revision still carries forward BOQ-line vendor selections from
    // the revision it supersedes (a fresh `computeAndSave(..., revision: null)` above deliberately
    // does NOT do this itself - passing the old revision there would also carry forward its
    // pricing levers/pricingConfigApplied, which a genuinely new revision must not do).
    const previousCurrent = await CommercialRevision.findOne({ project: project._id, isCurrent: true }).select('boqLines').lean();
    computed.boqLines = carryForwardVendors(computed.boqLines, previousCurrent?.boqLines);
    await CommercialRevision.updateMany({ project: project._id, isCurrent: true }, { $set: { isCurrent: false } });
  }

  const revision = await CommercialRevision.create({
    project: project._id,
    revisionNumber: previousCount + 1,
    isCurrent: true,
    ...computed,
    createRequestId: requestId,
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
      revision[field] = { status: 'Pending', approver: null, approverName: null, approverRole: null, decidedAt: null, note: `Reset: ${reason}`, requiresReapproval: current.status === 'Approved' || !!current.requiresReapproval, revisionNumber: null, calculatedAt: null, basis: null };
    }
  }
  revision.releaseStatus = 'NOT RELEASED';
  if (reset.length && userId) {
    await CommercialApproval.insertMany(
      reset.map(r => ({
        revision: revision._id, project: revision.project?._id || revision.project, stage: r.stage, status: 'Pending', action: 'Reset', approver: userId, note: `Reset from ${r.previous}: ${reason}`,
        revisionNumber: revision.revisionNumber, calculatedAt: revision.lastCalculatedAt || null, workflowVersion: revision.approvalWorkflow === 2 ? 2 : 1,
        valueSnapshot: { netExclVat: revision.pricing?.netExclVat ?? null, grossProfitPct: revision.pricing?.grossProfitPct ?? null },
      }))
    );
  }
  return reset;
}

/** Only the CURRENT revision may be recomputed. */
async function recomputeCurrentRevision(revisionId, engineeringInput, opts = {}) {
  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Deal Engine revision not found.', 404);
  if (!revision.isCurrent) throw new ApiError('This revision has been superseded and is read-only. Create a new revision instead.', 400);

  const project = await CommercialProject.findById(revision.project);
  const computed = await computeAndSave(project, engineeringInput || revision.engineeringInput, { ...opts, revision });
  if (opts.salesLimits) assertSalesPricingWithinLimits(opts.roles, computed.pricing, opts.salesLimits);
  computed.approvalBasis = fingerprints(computed);

  const before = revision.toObject();
  let resets = [];
  if (revision.approvalWorkflow !== 2) {
    // A revision priced under the earlier 2-stage + MD rules: its sign-offs reset (as before) and it
    // moves to the 3-stage workflow from here on.
    await resetSignedStages(revision, 'engineering input or pricing changed after sign-off.', { userId: opts.userId });
    Object.assign(revision, computed);
  } else {
    // 3-stage workflow: only the approvals whose underlying data changed are reset (and a
    // recalculation that changes nothing resets nothing) - approvalService.js#invalidateForChanges.
    const actor = opts.userId ? await mongoose.model('User').findById(opts.userId).select('name').lean() : null;
    const previousBasis = revision.approvalBasis || null;
    Object.assign(revision, computed);
    resets = invalidateForChanges(revision, previousBasis, computed.approvalBasis, { userId: opts.userId, userName: actor?.name || null, role: (opts.roles || [])[0] || null });
  }
  revision.releaseStatus = computeReleaseStatus(revision);
  // Mixed paths: Object.assign replaces them, but mark them so an equal-looking object is still written.
  revision.markModified('engineeringInput');
  revision.markModified('engineeringResult');
  revision.markModified('feasibility');
  await revision.save();
  await recordResets(revision, resets);
  revision.$locals.recalcSummary = { ...recalcSummary(before, revision.toObject()), approvalsReset: resets.map(r => r.stage), workflowStatus: workflowStatus(revision) };
  await syncProjectRollups(revision);
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

// Feature 2 - who may select/change a BOQ line's vendor. Mirrors supplierService.js's own
// EDIT_ROLES exactly: assigning a supplier to a line is the same kind of action as managing the
// supplier record itself, not an engineering edit (PROJECT_TAB_MATRIX.boqLines, which gates
// quantities/descriptions, is a different concern and deliberately not reused here).
const BOQ_VENDOR_ROLES = ['md', 'commercial_director', 'procurement'];

/**
 * Sets (or clears, when supplierId is falsy) one BOQ line's selected vendor - a narrow mutation
 * that touches ONLY that one line's `vendor` field. Deliberately never recalculates pricing,
 * never resets a signed approval stage, and is not itself an "edit" for the re-approval rule
 * (resetSignedStages) - picking a vendor is a sourcing/procurement decision, not a change to the
 * commercial terms the Stage 1/2/MD sign-offs are actually approving.
 *
 * Addressed by `component`, not a line id - boqLineSchema is `{ _id: false }` (boqLines is a
 * complete rebuild from the engine on every recalculation, so a persistent per-line id was never
 * useful before this feature either), and `component` is already the SAME key this file's own
 * carryForwardVendors (and boqService.js's manual-override matching) uses to find "the same line"
 * again after a rebuild - reusing it here rather than introducing a second identity scheme.
 */
async function setBoqLineVendor(revisionId, component, supplierId, { role } = {}) {
  if (!BOQ_VENDOR_ROLES.includes(role)) {
    throw new ApiError(`Selecting a BOQ line's vendor is for: ${BOQ_VENDOR_ROLES.map(r => r.replace('_', ' ')).join(', ')}. Your Deal Engine role is "${role || 'none'}".`, 403);
  }
  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Deal Engine revision not found.', 404);
  if (!revision.isCurrent) throw new ApiError('This revision has been superseded and is read-only.', 400);
  const line = revision.boqLines.find(l => l.component === component);
  if (!line) throw new ApiError(`BOQ line "${component}" not found on this revision.`, 404);

  if (supplierId) {
    const supplier = await CommercialSupplier.findById(supplierId).select('status').lean();
    if (!supplier) throw new ApiError('Supplier not found.', 404);
    if (!['Approved', 'Conditional'].includes(supplier.status)) {
      throw new ApiError(`Only an Approved or Conditional supplier can be selected (this one is ${supplier.status}).`, 400);
    }
    line.vendor = supplierId;
  } else {
    line.vendor = undefined;
  }
  await revision.save();
  return revision.populate({ path: 'boqLines.vendor', select: 'code legalName status' });
}

module.exports = { createRevision, recomputeCurrentRevision, invalidateCurrentRevision, resetSignedStages, computeAndSave, setBoqLineVendor, carryForwardVendors, carriedOverrides, recalcSummary };
