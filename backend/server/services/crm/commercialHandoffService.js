'use strict';

const ApiError = require('../../utils/apiError');
const Lead = require('../../models/crm/leadModel');
const Activity = require('../../models/crm/activityModel');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const CommercialSyncEvent = require('../../models/commercial/commercialSyncEventModel');
const { getNextProjectCode } = require('../commercial/projectCodeService');
const { ensureDealIdentifiers } = require('../commercial/dealNumberService');
const { findOrCreateCustomer } = require('../customer/sharedCustomerService');
const { regionForGovernorate } = require('../../utils/commercial/regions');

// Reservia - the CRM -> Commercial handoff (QA finding B5; Developer Brief 6.1; handover section 4).
//
//   Lead moves to "Proposal sent"  -> Commercial creates ONE project/deal prefilled from the lead
//                                     (customer, segment -> sector, governorate -> region, value,
//                                     size, source), with its Deal #, Proposal # and proposed ERP
//                                     project #, and returns them to the lead.
//   Lead Won                       -> the deal's outcome is Won; the cost-only ERP budget lines are
//                                     captured for the ERP project setup (no accounting is posted,
//                                     no ERP project is created or faked - brief 6.2).
//   Lead Lost                      -> outcome Lost, with the lead's lost reason.
//   Lead reopened (from Lost)      -> outcome back to Open.
//
// Idempotent on the CRM lead id: a unique index on CommercialProject.crmLead means one lead can
// only ever own one project, even under concurrent triggers; every retry re-finds that project and
// just re-syncs the identifiers. Failures never block the CRM stage change - they are recorded on
// the lead (commercial.syncStatus = 'failed' + error), in the lead's timeline, and in
// CommercialSyncEvent, and can be retried from the lead page (POST /crm/leads/:id/commercial-sync).

// CRM segment -> Commercial category + sub-type (the reference build's SUBS vocabulary). Editable on
// the project afterwards like any other header field.
const SEGMENT_TO_SECTOR = {
  villa: { category: 'On-Grid C&I', subCategory: 'Villa / building' },
  compound: { category: 'On-Grid C&I', subCategory: 'Compound / commercial' },
  farm: { category: 'Agriculture Pumping', subCategory: 'Farm' },
  oil_gas: { category: 'Off-Grid', subCategory: 'O&G camp' },
  factory: { category: 'On-Grid C&I', subCategory: 'Factory' },
  services: { category: 'On-Grid C&I', subCategory: 'Office / mall / retail' },
  other: { category: 'On-Grid C&I', subCategory: null },
  unknown: { category: 'On-Grid C&I', subCategory: null },
};

const OPEN_FOR_PROPOSAL = ['proposal_sent', 'negotiation', 'won'];

function safeError(err) {
  return String((err && (err.operational || err instanceof ApiError) && err.message) || err?.message || 'Synchronization failed.').slice(0, 480);
}

function identifiersOf(project) {
  return {
    dealNumber: project.dealNumber || null,
    projectCode: project.projectCode || null,
    proposalNumber: project.proposalNumber || null,
    proposedErpProjectNumber: project.proposedErpProjectNumber || null,
  };
}

async function findLinkedProject(lead) {
  if (lead.commercial?.project) {
    const p = await CommercialProject.findById(lead.commercial.project);
    if (p) return p;
  }
  return CommercialProject.findOne({ crmLead: lead._id });
}

/** Builds the new project's header from the lead. Throws an actionable ApiError when the lead lacks what Commercial needs. */
function projectHeaderFromLead(lead, { cityRegions = null } = {}) {
  const sector = SEGMENT_TO_SECTOR[lead.segment] || SEGMENT_TO_SECTOR.unknown;
  if (!lead.name || !String(lead.name).trim()) {
    throw new ApiError('The lead has no customer name - add the name on the lead, then retry the Deal Engine sync.', 400);
  }
  // Deal Engine C26: the configured city/governorate table (attachment A3) first, then the built-in
  // governorate table (nearest region for governorates without a rates row of their own).
  const fromTable = cityRegions && lead.governorate ? Object.entries(cityRegions).find(([c]) => c.toLowerCase() === String(lead.governorate).trim().toLowerCase()) : null;
  const mapped = fromTable ? { region: fromTable[1] } : regionForGovernorate(lead.governorate);
  if (!mapped) {
    throw new ApiError(
      lead.governorate
        ? `Governorate "${lead.governorate}" has no Rates matrix region mapping - set a standard governorate on the lead, then retry.`
        : 'The lead has no governorate - set it on the lead (it decides the installation/transport Rates region), then retry the Deal Engine sync.',
      400
    );
  }
  return {
    category: sector.category,
    subCategory: sector.subCategory,
    country: 'Egypt',
    region: mapped.region,
    regionNote: mapped.nearest
      ? `Region mapped from governorate ${lead.governorate} to the nearest Rates region (${mapped.region}) - confirm the installation and transport rates.`
      : `Region mapped from governorate ${lead.governorate}.`,
  };
}

async function recordEvent({ lead, project, event, status, error = null, replay = false, trigger, userId }) {
  await CommercialSyncEvent.create({
    lead: lead._id, leadRef: lead.refCode, project: project?._id || null, event, status, error, replay, trigger, actor: userId || null,
    identifiers: project ? identifiersOf(project) : {},
  }).catch(() => {}); // the log must never turn a successful sync into a failure
}

async function markLead(lead, project, { event, ok, error = null, userId = null, note }) {
  const prev = lead.commercial || {};
  const commercial = {
    project: project?._id || prev.project || null,
    projectCode: project?.projectCode || prev.projectCode || null,
    dealNumber: project?.dealNumber || prev.dealNumber || null,
    proposalNumber: project?.proposalNumber || prev.proposalNumber || null,
    proposedErpProjectNumber: project?.proposedErpProjectNumber || prev.proposedErpProjectNumber || null,
    erpProjectNumber: project?.erpProjectNumber || prev.erpProjectNumber || null,
    syncStatus: ok ? 'synced' : 'failed',
    lastEvent: event === 'reopen' ? prev.lastEvent || 'proposal' : event,
    lastSyncAt: new Date(),
    lastError: ok ? null : error,
    attempts: (prev.attempts || 0) + 1,
  };
  await Lead.updateOne({ _id: lead._id }, { $set: { commercial } });
  lead.commercial = commercial;
  if (note) await Activity.create({ lead: lead._id, type: 'system', body: note, author: userId || null });
  if (project) {
    await CommercialProject.updateOne(
      { _id: project._id },
      { $set: { crmSync: { status: ok ? 'synced' : 'failed', lastEvent: commercial.lastEvent, lastSyncAt: commercial.lastSyncAt, lastError: ok ? null : error } } }
    );
  }
}

/**
 * Creates (or re-finds) the Commercial project for a lead at Proposal sent. Idempotent.
 * @returns {Promise<{project, created:boolean}>}
 */
async function ensureProjectForLead(lead, { userId = null } = {}) {
  const existing = await findLinkedProject(lead);
  if (existing) {
    if (await ensureDealIdentifiers(existing)) await existing.save();
    return { project: existing, created: false };
  }

  // eslint-disable-next-line global-require
  const pricingConfigService = require('../commercial/pricingConfigService');
  // eslint-disable-next-line global-require
  const { engineSettings } = require('../commercial/dealEngineSettings');
  const header = projectHeaderFromLead(lead, { cityRegions: engineSettings(await pricingConfigService.getActiveConfig()).cityRegions });
  const { customer } = await findOrCreateCustomer({ name: lead.name, phone: lead.phoneE164, email: lead.email }, { createdBy: userId });

  const project = new CommercialProject({
    projectCode: await getNextProjectCode(header.category),
    name: `${String(lead.name).trim()} - ${lead.refCode}`.slice(0, 200),
    customer: customer._id,
    ...header,
    currency: 'EGP',
    scope: 'Supply & Installation',
    crmLead: lead._id,
    crmLeadRef: lead.refCode,
    estimatedValueEgp: lead.valueEgp ?? null,
    estimatedKwp: lead.systemSizeKwp ?? null,
    leadSource: lead.source || null,
    leadCampaign: lead.campaign || null,
    createdBy: userId,
  });
  await ensureDealIdentifiers(project);
  try {
    await project.save();
    return { project, created: true };
  } catch (err) {
    if (err?.code === 11000 && err.keyPattern?.crmLead) {
      // A concurrent trigger for the same lead won the race - that project is THE project.
      const winner = await CommercialProject.findOne({ crmLead: lead._id });
      if (winner) return { project: winner, created: false };
    }
    throw err;
  }
}

// Brief 3.5 - ERP budget = BOQ cost groups + site costs + overhead + contingency + incentives.
// Profit is excluded; the check (budget - (COGS + overhead + contingency + incentives)) must be 0.
const COST_GROUP_BY_COMPONENT = [
  [/^(pv modules|solar pv modules|solar inverters|off-grid inverter|battery bank|submersible water pump|pump motor|pump inverter)/i, ['EQ-01', 'Equipment']],
  [/mounting structure/i, ['ST-01', 'Mounting structures']],
  [/(dc solar cable|dc cables|ac cable|cable tray|mc4|drop cable|rising main)/i, ['CB-01', 'Cabling']],
  [/(breaker|distribution board|dc protection|combiner)/i, ['PR-01', 'Protection']],
  [/(earthing|accessories|miscellaneous)/i, ['BS-01', 'Balance of system']],
  [/^installation/i, ['SV-01', 'Installation, testing and commissioning']],
  [/^transportation/i, ['SV-02', 'Transportation']],
  [/^travel/i, ['SV-03', 'Travel, hotels and accommodation']],
  [/personnel/i, ['SV-04', 'Site personnel allowance']],
];

function erpBudgetFromRevision(revision) {
  const buckets = new Map();
  const add = (code, label, amount) => {
    const b = buckets.get(code) || { costCode: code, line: label, budgetEgp: 0 };
    b.budgetEgp += amount || 0;
    buckets.set(code, b);
  };
  for (const l of revision.boqLines || []) {
    const hit = COST_GROUP_BY_COMPONENT.find(([rx]) => rx.test(l.component));
    const [code, label] = hit ? hit[1] : ['AD-01', 'Utility adders / other'];
    add(code, label, l.total);
  }
  const p = revision.pricing;
  add('OV-01', 'Overhead allocation', p.overheadAmt);
  add('OV-02', 'Contingency', p.contingencyAmt);
  add('IN-01', 'Sales bonus', p.salesBonusAmt);
  add('IN-02', 'Engineering incentive', p.engineeringIncentiveAmt);
  const lines = [...buckets.values()].map(b => ({ ...b, budgetEgp: Math.round(b.budgetEgp * 100) / 100 }));
  const total = lines.reduce((s, l) => s + l.budgetEgp, 0);
  const check = Math.round(total - (p.cogs + p.overheadAmt + p.contingencyAmt + p.salesBonusAmt + p.engineeringIncentiveAmt));
  return { lines, totalBudgetEgp: Math.round(total * 100) / 100, check, capturedAt: new Date(), revision: revision._id };
}

async function applyOutcome(project, event, lead) {
  const set = {};
  if (event === 'won') {
    set.outcome = 'Won';
    set.outcomeAt = new Date();
    set.wonValueEgp = lead.valueEgp ?? null;
    set.lostReason = null;
    const revision = project.currentRevision ? await CommercialRevision.findById(project.currentRevision) : null;
    if (revision && revision.status !== 'Draft' && revision.pricing?.cogs != null) set.erpBudget = erpBudgetFromRevision(revision);
  } else if (event === 'lost') {
    set.outcome = 'Lost';
    set.outcomeAt = new Date();
    set.lostReason = lead.lostReason || null;
  } else if (event === 'reopen') {
    set.outcome = 'Open';
    set.outcomeAt = null;
    set.lostReason = null;
  }
  if (Object.keys(set).length) await CommercialProject.updateOne({ _id: project._id }, { $set: set });
  return CommercialProject.findById(project._id);
}

/**
 * Runs one lead event into Commercial. Never throws for a business failure - the failure is
 * recorded and returned (`ok: false`) so the caller's stage change still succeeds.
 *
 * @param {string} leadId
 * @param {'proposal'|'won'|'lost'|'reopen'} event
 */
async function syncLeadEvent(leadId, event, { userId = null, trigger = 'stage_change' } = {}) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw new ApiError('Lead not found.', 404);

  let project = null;
  try {
    if (event === 'proposal') {
      const { project: p, created } = await ensureProjectForLead(lead, { userId });
      project = p;
      await markLead(lead, project, {
        event, ok: true, userId,
        note: created
          ? `Sent to the Deal Engine: deal ${project.dealNumber}, project ${project.projectCode}, proposal # ${project.proposalNumber}, proposed ERP project # ${project.proposedErpProjectNumber}.`
          : null,
      });
      await recordEvent({ lead, project, event, status: 'synced', replay: !created, trigger, userId });
      return { ok: true, created, project, identifiers: identifiersOf(project) };
    }

    // won / lost / reopen - the deal must exist. A Won lead whose proposal handoff had failed gets
    // its project created now (out-of-order safe); a lead lost before ever reaching Proposal has no
    // deal, and there is nothing to sync.
    project = await findLinkedProject(lead);
    if (!project && event === 'won') project = (await ensureProjectForLead(lead, { userId })).project;
    if (!project) {
      await recordEvent({ lead, project: null, event, status: 'skipped', trigger, userId, error: 'No Deal Engine deal for this lead (it never reached Proposal sent).' });
      return { ok: true, skipped: true };
    }
    const already = (event === 'won' && project.outcome === 'Won') || (event === 'lost' && project.outcome === 'Lost' && project.lostReason === (lead.lostReason || null)) || (event === 'reopen' && project.outcome === 'Open');
    project = await applyOutcome(project, event, lead);
    const label = event === 'won' ? 'Won' : event === 'lost' ? `Lost${lead.lostReason ? ` (${lead.lostReason})` : ''}` : 'Open (reopened)';
    await markLead(lead, project, { event, ok: true, userId, note: already ? null : `Deal Engine deal ${project.dealNumber} outcome set to ${label}.` });
    await recordEvent({ lead, project, event, status: 'synced', replay: already, trigger, userId });
    return { ok: true, project, identifiers: identifiersOf(project) };
  } catch (err) {
    const message = safeError(err);
    console.error(`[CRM->Deal Engine] ${event} sync failed for lead ${lead.refCode}: ${err.message}`);
    await markLead(lead, project, { event, ok: false, error: message, userId, note: `Deal Engine sync (${event}) failed: ${message} Retry from this lead once fixed.` }).catch(() => {});
    await recordEvent({ lead, project, event, status: 'failed', error: message, trigger, userId });
    return { ok: false, error: message };
  }
}

/** Which event a lead in `stage` should (re-)sync - used by the manual retry. */
function eventForStage(stage) {
  if (stage === 'won') return 'won';
  if (stage === 'lost') return 'lost';
  if (OPEN_FOR_PROPOSAL.includes(stage)) return 'proposal';
  return null;
}

/** Manual retry / re-sync from the lead page. */
async function retrySync(leadId, { userId = null } = {}) {
  const lead = await Lead.findById(leadId).select('stage');
  if (!lead) throw new ApiError('Lead not found.', 404);
  const event = eventForStage(lead.stage);
  if (!event) throw new ApiError('This lead has not reached Proposal sent yet - there is nothing to send to the Deal Engine.', 400);
  return syncLeadEvent(leadId, event, { userId, trigger: 'retry' });
}

/**
 * Called by leadService.changeStage after a committed stage change. Never throws. A reopened lead
 * (leaving Lost/Won for an open stage) first sets the deal back to Open; landing on Proposal sent
 * then (re-)ensures the deal - in that order, so out-of-order or combined transitions converge.
 */
async function onStageChanged(leadId, from, to, { userId = null } = {}) {
  const events = [];
  const terminal = ['lost', 'won'];
  if (terminal.includes(from) && !terminal.includes(to)) events.push('reopen');
  if (to === 'proposal_sent') events.push('proposal');
  else if (to === 'won') events.push('won');
  else if (to === 'lost') events.push('lost');
  let last = null;
  for (const event of events) {
    try {
      // eslint-disable-next-line no-await-in-loop
      last = await syncLeadEvent(leadId, event, { userId, trigger: 'stage_change' });
    } catch (err) {
      console.error(`[CRM->Deal Engine] unexpected error for lead ${leadId}: ${err.message}`);
      last = { ok: false, error: safeError(err) };
    }
  }
  return last;
}

module.exports = { syncLeadEvent, retrySync, onStageChanged, ensureProjectForLead, projectHeaderFromLead, erpBudgetFromRevision, eventForStage, SEGMENT_TO_SECTOR };
