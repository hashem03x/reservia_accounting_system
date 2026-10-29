'use strict';

const ApiError = require('../../utils/apiError');
const Lead = require('../../models/crm/leadModel');
const Quotation = require('../../models/crm/quotationModel');
const { computeQuotationTotals, round2 } = require('../../utils/crm/quotationCalc');
const leadService = require('./leadService');

// Reservia CRM - Phase 2 "Quotations" (Developer Brief section 4E, due 2026-12-10). This is the
// minimal real wiring of utils/crm/quotationCalc.js (the brief's own acceptance test: "farm
// package at 5% discount totals EGP 1,072,071") into an actual persisted record - everything past
// this (PDF generation, e-signature/accept flow polish, price-list admin UI) is still open for
// Phase 2 and is NOT claimed as done.

/** Sums a quotation's own line totals - each line already rounded by computeQuotationTotals. */
function aggregate(items, vatPercent) {
  const lineTotals = items.map(item => computeQuotationTotals(item.unitPriceEgp, item.quantity, item.discountPercent || 0, vatPercent));
  const sum = key => round2(lineTotals.reduce((acc, t) => acc + t[key], 0));
  return { subtotal: sum('subtotal'), discountAmount: sum('discountAmount'), vatAmount: sum('vatAmount'), total: sum('total') };
}

async function createQuotation(leadId, input, { userId } = {}) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw new ApiError('Lead not found.', 404);
  if (!Array.isArray(input.items) || !input.items.length) throw new ApiError('A quotation needs at least one line item.', 400);

  const vatPercent = input.vatPercent ?? 14;
  const totals = aggregate(input.items, vatPercent);
  const version = (await Quotation.countDocuments({ lead: lead._id })) + 1;

  return Quotation.create({
    lead: lead._id,
    version,
    items: input.items,
    vatPercent,
    ...totals,
    validUntil: input.validUntil || null,
    createdBy: userId || null,
  });
}

/** Sending a quotation moves the lead to Proposal sent - the one stage transition this wires automatically. */
async function sendQuotation(quotationId, { userId, role } = {}) {
  const quotation = await Quotation.findById(quotationId);
  if (!quotation) throw new ApiError('Quotation not found.', 404);
  quotation.status = 'sent';
  quotation.sentAt = new Date();
  await quotation.save();

  const lead = await Lead.findById(quotation.lead);
  if (lead && lead.stage !== 'proposal_sent' && lead.stage !== 'negotiation' && lead.stage !== 'won') {
    await leadService.changeStage(lead._id, { to: 'proposal_sent', followUpAt: lead.followUpAt || new Date(Date.now() + 86400000) }, { userId, role });
  }
  return quotation;
}

async function acceptQuotation(quotationId) {
  const quotation = await Quotation.findById(quotationId);
  if (!quotation) throw new ApiError('Quotation not found.', 404);
  quotation.status = 'accepted';
  quotation.respondedAt = new Date();
  await quotation.save();
  // The lead's own valueEgp reflects what was actually quoted and accepted - used by the Won
  // stage-transition rule's >EGP 1M MD-approval check (utils/crm/stageRules.js).
  await Lead.updateOne({ _id: quotation.lead }, { $set: { valueEgp: quotation.total } });
  return quotation;
}

module.exports = { createQuotation, sendQuotation, acceptQuotation, aggregate };
