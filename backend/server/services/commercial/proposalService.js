const crypto = require('crypto');
const ApiError = require('../../utils/apiError');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const CommercialProposal = require('../../models/commercial/commercialProposalModel');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const { ensureDealIdentifiers, proposalNumberFor } = require('./dealNumberService');
const pricingConfigService = require('./pricingConfigService');
const { proposalSettings } = require('./dealEngineSettings');
const { renderProposalPdf } = require('./proposalPdf');
const attachments = require('../files/attachmentService');
const { releaseBlockers } = require('./supplierPricing');

// C20: who may release a proposal past the supplier-price rule ("unless the Commercial Director
// overrides with a note"); the MD, who signs above the Director, may too.
const RELEASE_OVERRIDE_ROLES = ['commercial_director', 'md'];

// Reservia Deal Engine - issuing a proposal freezes a snapshot of the revision's current
// boqLines/pricing/feasibility, exactly mirroring services/crm/quotationService.js's
// "compute once, store, never recompute on read" guarantee. A later Price Book price change or a
// further edit to the revision can never retroactively alter a proposal already issued.
//
// Deal Engine Changes Required (12 Nov 2026), C12-C17 / Spec Part 2 section 3.3:
//   - the proposal is a PDF on the Reservia letterhead (proposalPdf.js);
//   - preview is available before approvals, watermarked DRAFT, NOT FOR ISSUE on every page (C14);
//   - issue numbers it DEAL-YYYY-NNN-P01, P02..., freezes the document data, stores the customer PDF
//     with its sha256 hash, the issuer and the time; a re-issue is a new number, the old PDF stays (C15);
//   - two prints: customer copy (no unit prices) and internal copy (priced BOQ, pricing stack,
//     approval log) (C16);
//   - the issued PDF is attached to the CRM lead, and the lead moves to Proposal sent if the stage
//     rules allow it (C17).

const STAGE_TEXT = { stage1: 'Sales and Technical (Stage 1)', stage2: 'Sales and Commercial Director (Stage 2)', md: 'Managing Director' };

function systemWords(project, revision) {
  const ei = revision.engineeringInput || {};
  const mount = /ground/i.test(ei.structureType || '') ? 'ground-mounted' : 'rooftop';
  switch (project.category) {
    case 'Off-Grid':
      return { title: 'off-grid solar PV system with battery storage, supply and installation', noun: 'off-grid solar PV system' };
    case 'Agriculture Pumping':
      return { title: 'solar water pumping system, supply and installation', noun: 'solar water pumping system' };
    case 'Utility Scale':
      return { title: 'utility-scale solar PV plant, supply and installation', noun: 'solar PV plant' };
    default:
      return { title: 'grid-connected solar PV system, supply and installation', noun: `${mount} solar PV system` };
  }
}

function approvalsOf(revision) {
  return ['stage1', 'stage2', 'md']
    .filter(k => k !== 'md' || revision.mdRequired)
    .map(k => {
      const st = revision[k] || {};
      return { key: k, stage: STAGE_TEXT[k], status: st.status || 'Pending', by: st.approverName || null, at: st.decidedAt || null, note: st.note || '' };
    });
}

/**
 * Every value the PDF prints, as plain data - computed once from the project, revision and proposal
 * settings. Stored on an issued proposal so its internal copy re-renders identically later.
 */
function buildProposalData({ project, revision, proposalNumber, issueDate, settings }) {
  const words = systemWords(project, revision);
  const p = revision.pricing ? (revision.pricing.toObject ? revision.pricing.toObject() : revision.pricing) : {};
  const er = revision.engineeringResult || {};
  const ei = revision.engineeringInput || {};
  const designKwp = p.designKwp || ei.kWp || null;
  const moduleLine = (revision.boqLines || []).find(l => /^PV Modules/i.test(l.component));
  const approvals = approvalsOf(revision);
  const validUntil = new Date(issueDate.getTime() + settings.validityDays * 86400000);
  const smallMax = settings.paymentTerms.smallDealMaxNetEgp;
  const plainBoq = (revision.boqLines || []).map(l => (l.toObject ? l.toObject() : { ...l }));
  return {
    proposalNumber,
    dealNumber: project.dealNumber || null,
    issueDate,
    validUntil,
    customerName: project.customer?.name || '-',
    site: [project.region, project.country].filter(Boolean).join(', '),
    category: project.category,
    title: `${designKwp ? `${designKwp} kWp ` : ''}${words.title}`,
    systemNoun: words.noun,
    preparedBy: `${settings.company.name.replace(/ LLC$/, '')}, Sales and Technical team`,
    approvedBy: approvals.filter(a => a.status === 'Approved').map(a => a.stage).join('; ') || null,
    approvals,
    pricing: p,
    feasibility: revision.feasibility || null,
    engineering: {
      designKwp,
      moduleCount: moduleLine ? moduleLine.qty : null,
      moduleW: er.module && er.module.pmaxW ? er.module.pmaxW : er.pv && er.pv.selectedCapacityKwp && er.pv.modulesRequired ? Math.round((er.pv.selectedCapacityKwp * 1000) / er.pv.modulesRequired) : null,
      inverterKw: er.inverter ? er.inverter.ratedKw : null,
      inverterModel: er.inverter ? er.inverter.model : null,
      inverterBrand: er.inverter ? er.inverter.brand || null : null,
      moduleBrand: er.module ? er.module.brand || null : null,
      dcAcRatio: er.dcAcRatio ?? null,
      structure: ei.structureType || null,
    },
    boqLines: plainBoq,
    smallDeal: smallMax != null && p.netExclVat != null && p.netExclVat <= smallMax,
    settings,
    ruleVersion: revision.ruleVersion || null,
    revisionNumber: revision.revisionNumber,
  };
}

async function loadForDocument(revisionId) {
  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Deal Engine revision not found.', 404);
  const project = await CommercialProject.findById(revision.project).populate('customer', 'name');
  if (!project) throw new ApiError('Deal Engine project not found.', 404);
  if (!revision.pricing || revision.pricing.netExclVat == null) throw new ApiError('Calculate the revision before producing a proposal.', 400);
  return { revision, project };
}

/** C14 / C16: a preview of the NEXT proposal, before (or after) approvals - always watermarked DRAFT. */
async function previewProposal(revisionId, { copy = 'customer' } = {}) {
  const { revision, project } = await loadForDocument(revisionId);
  if (await ensureDealIdentifiers(project)) await project.save();
  const settings = proposalSettings(await pricingConfigService.getActiveConfig());
  const data = buildProposalData({ project, revision, proposalNumber: project.proposalNumber || `${project.dealNumber}-P01`, issueDate: new Date(), settings });
  return { pdf: await renderProposalPdf(data, { copy, draft: true }), proposalNumber: data.proposalNumber };
}

/**
 * C17: the issued PDF on the CRM lead, and the lead to Proposal sent when the stage rules allow that
 * move (same rule as sending a CRM quotation: never skips a stage - otherwise the timeline says why).
 */
async function attachToLead(project, proposal, buffer, { userId, crmRole }) {
  if (!project.crmLead) return { attached: false };
  // eslint-disable-next-line global-require
  const Lead = require('../../models/crm/leadModel');
  // eslint-disable-next-line global-require
  const Activity = require('../../models/crm/activityModel');
  const lead = await Lead.findById(project.crmLead);
  if (!lead) return { attached: false };
  const att = await attachments.storeGeneratedFile({ ownerKey: 'crm-leads', ownerId: lead._id, buffer, name: `${proposal.proposalNumber}.pdf`, contentType: 'application/pdf', userId });
  let stageNote = '';
  if (!['proposal_sent', 'negotiation', 'won', 'lost'].includes(lead.stage)) {
    // eslint-disable-next-line global-require
    const { evaluateStageTransition, STAGE_LABELS } = require('../../utils/crm/stageRules');
    // eslint-disable-next-line global-require
    const leadService = require('../crm/leadService');
    const role = crmRole || 'sales';
    const followUpAt = lead.followUpAt || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const violations = evaluateStageTransition({ from: lead.stage, to: 'proposal_sent', role, followUpAt, mdApproved: lead.mdApproved, governorate: lead.governorate });
    if (violations.length === 0) {
      await leadService.changeStage(lead._id, { to: 'proposal_sent', followUpAt }, { userId, role });
      stageNote = ' The lead moved to Proposal sent.';
    } else {
      stageNote = ` The lead stays at "${STAGE_LABELS[lead.stage]}" - ${violations.map(v => v.message).join(' ')}`;
    }
  }
  await Activity.create({
    lead: lead._id,
    type: 'proposal',
    body: `Proposal ${proposal.proposalNumber} issued from the Deal Engine (PDF attached, SHA-256 ${proposal.pdfHash.slice(0, 16)}...).${stageNote}`,
    author: userId || null,
  });
  return { attached: true, attachmentId: att._id };
}

async function issueProposal(revisionId, { userId, userName = null, crmRole = null, commercialRole = null, releaseOverrideNote = null } = {}) {
  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Deal Engine revision not found.', 404);
  if (!revision.isCurrent) throw new ApiError('Only the current revision can be issued as a proposal.', 400);
  if (revision.status === 'Draft') {
    throw new ApiError('This revision is in Draft - recalculate it and re-approve it before issuing a proposal.', 400);
  }
  if (revision.releaseStatus !== 'APPROVED FOR ISSUE') {
    throw new ApiError('This revision is NOT RELEASED - every required approval stage must be Approved before a proposal can be issued.', 400);
  }

  // C20 - stale Reference prices and non-Approved suppliers block the release, unless overridden.
  const blockers = releaseBlockers(revision);
  let releaseOverride = null;
  if (blockers.length) {
    const note = String(releaseOverrideNote || '').trim();
    if (!note) {
      throw new ApiError(`This proposal cannot be released yet: ${blockers.join(' ')} Upload current supplier prices and recalculate, or the Commercial Director can override with a note.`, 400, { releaseBlocked: true, reasons: blockers });
    }
    if (!RELEASE_OVERRIDE_ROLES.includes(commercialRole)) throw new ApiError('Only the Commercial Director (or the MD) can release a proposal past the supplier price rule.', 403);
    if (note.length < 5) throw new ApiError('Give a reason for the override (at least 5 characters).', 400);
    releaseOverride = `${userName || 'User'} (${commercialRole}) overrode: ${blockers.join(' ')} Note: ${note.slice(0, 500)}`;
  }

  const project = await CommercialProject.findById(revision.project).populate('customer', 'name');
  if (!project) throw new ApiError('Deal Engine project not found.', 404);
  if (await ensureDealIdentifiers(project)) await project.save();

  const version = (await CommercialProposal.countDocuments({ project: revision.project })) + 1;
  const proposalNumber = proposalNumberFor(project.dealNumber, version);
  const settings = proposalSettings(await pricingConfigService.getActiveConfig());
  const issueDate = new Date();
  const data = buildProposalData({ project, revision, proposalNumber, issueDate, settings });
  if (releaseOverride) data.releaseOverride = releaseOverride;
  const pdf = await renderProposalPdf(data, { copy: 'customer', draft: false });
  const pdfHash = crypto.createHash('sha256').update(pdf).digest('hex');
  const stored = await attachments.storeGeneratedFile({ ownerKey: 'commercial-projects', ownerId: project._id, buffer: pdf, name: `${proposalNumber}.pdf`, contentType: 'application/pdf', userId });

  let proposal;
  try {
    proposal = await CommercialProposal.create({
      revision: revision._id,
      project: revision.project,
      version,
      proposalNumber,
      issuedAt: issueDate,
      validUntil: data.validUntil,
      boqLinesSnapshot: revision.boqLines,
      pricingSnapshot: revision.pricing,
      feasibilitySnapshot: revision.feasibility,
      documentSnapshot: JSON.parse(JSON.stringify(data)),
      pdfAttachmentId: stored._id,
      pdfHash,
      pdfSize: pdf.length,
      releaseOverride: releaseOverride || null,
      issuedBy: userId,
    });
  } catch (err) {
    await attachments.deleteAttachment(stored).catch(() => {});
    if (err?.code === 11000) throw new ApiError('Another proposal was issued for this project at the same moment - reload and try again.', 409);
    throw err;
  }
  await CommercialProject.updateOne({ _id: project._id }, { $set: { proposalNumber: proposalNumberFor(project.dealNumber, version + 1) } });

  // C17 - never fails the issue: a problem is recorded on the proposal instead.
  try {
    const lead = await attachToLead(project, proposal, pdf, { userId, crmRole });
    if (lead.attached) await CommercialProposal.updateOne({ _id: proposal._id }, { $set: { leadAttachmentId: lead.attachmentId } });
  } catch (err) {
    console.error(`[Deal Engine] proposal ${proposalNumber}: CRM lead attachment failed: ${err.message}`);
    await CommercialProposal.updateOne({ _id: proposal._id }, { $set: { leadAttachmentError: String(err.message).slice(0, 300) } });
  }
  return CommercialProposal.findById(proposal._id).select('-documentSnapshot');
}

/** C15 / C16: an issued proposal's PDF - the stored customer copy, or the internal copy re-rendered from the frozen data. */
async function getProposalPdf(proposalId, { copy = 'customer' } = {}) {
  const proposal = await CommercialProposal.findById(proposalId);
  if (!proposal) throw new ApiError('Proposal not found.', 404);
  if (copy === 'internal') {
    if (!proposal.documentSnapshot) throw new ApiError('This proposal was issued before internal copies were stored - only its figures are available.', 404);
    const data = { ...proposal.documentSnapshot, issueDate: new Date(proposal.documentSnapshot.issueDate), validUntil: new Date(proposal.documentSnapshot.validUntil) };
    return { pdf: await renderProposalPdf(data, { copy: 'internal', draft: false }), proposal };
  }
  if (!proposal.pdfAttachmentId) throw new ApiError('This proposal was issued before PDFs were stored.', 404);
  const { attachment } = await attachments.getAttachment(proposal.pdfAttachmentId);
  const pdf = await attachments.readFileBuffer(attachment.file);
  const hash = crypto.createHash('sha256').update(pdf).digest('hex');
  if (proposal.pdfHash && hash !== proposal.pdfHash) throw new ApiError('The stored PDF does not match its recorded hash - contact the administrator.', 500);
  return { pdf, proposal };
}

async function listProposalsForProject(projectId) {
  return CommercialProposal.find({ project: projectId }).select('-documentSnapshot').populate('issuedBy', 'name').sort({ version: -1 });
}

/** C20 preview: what would block the release of this revision right now (shown on the Proposal tab). */
async function releaseCheck(revisionId) {
  const revision = await CommercialRevision.findById(revisionId).lean();
  if (!revision) throw new ApiError('Deal Engine revision not found.', 404);
  return { blockers: releaseBlockers(revision), priceChangedSinceCalculation: !!revision.priceChangedSinceCalculation, priceChangedItems: revision.priceChangedItems || [] };
}

module.exports = { releaseCheck, issueProposal, previewProposal, getProposalPdf, listProposalsForProject, buildProposalData };
