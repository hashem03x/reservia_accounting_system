'use strict';

const ApiError = require('../../utils/apiError');
const leadService = require('./leadService');

// Reservia CRM - the public website's lead-capture call (Developer Brief: "Website lead
// submission into CRM"). This is the ONE place the website's own vocabulary (its `Segment` type,
// `source: 'contact_form'|'landing_form'`, a generic numeric `siteInput`, an optional calculator
// estimate) is translated into the CRM's real schema/business rules - the website project is a
// separate, read-only-from-here codebase, so this mapping lives on the CRM side rather than
// asking the website to know the CRM's internal enums.
//
// Every real write still goes through services/crm/leadService.js#intakeLead/recordActivity -
// the SAME dedupe-by-phone, SLA-clock and ref-code logic every other channel uses. This file adds
// NO new business rule to lead creation itself; it only decides what request field maps to what
// existing field.

// The website's own segment vocabulary (src/config/navigation.ts's `Segment` type) does not match
// the CRM's SEGMENTS enum one-for-one - the website's single "Industrial" page covers BOTH oil/gas
// and factories (see Reservia_Website/README.md: "Industrial (oil/gas + factories)"), so this
// mapping makes a documented assumption (industrial -> oil_gas) rather than guessing per-submission;
// confirm with the business before relying on the oil_gas/factory split for industrial leads.
const WEBSITE_SEGMENT_TO_CRM = {
  villas: 'villa',
  compounds: 'compound',
  agriculture: 'farm',
  industrial: 'oil_gas',
  service: 'services',
  general: 'unknown',
  calc: 'unknown',
};

// source: 'contact_form' -> the main site's contact page; 'landing_form' -> one of the five
// paid-campaign pages (/lp/*) - exactly the two automated intake paths
// utils/crm/constants.js's CHANNELS comment already anticipated ("web_form from the website's
// lead-capture endpoint, landing_page from a campaign page").
const WEBSITE_SOURCE_TO_CHANNEL = { contact_form: 'web_form', landing_form: 'landing_page' };

const MAX_NOTE_LENGTH = 2000;

/** A short, human-readable note for the sales rep - never raw internal field names, never PII beyond what the rep already has from the lead record itself. */
function buildIntakeNote(payload) {
  const lines = [];
  if (payload.message) lines.push(`Message: ${String(payload.message).slice(0, MAX_NOTE_LENGTH)}`);
  if (payload.siteInput !== undefined && payload.siteInput !== null) {
    lines.push(`Figure entered on the form (bill/consumption/pump size - unit depends on the segment): ${payload.siteInput}`);
  }
  const calc = payload.calculator;
  if (calc && typeof calc === 'object') {
    const parts = [];
    if (calc.category) parts.push(`category=${calc.category}`);
    if (calc.systemSizeKwp !== undefined) parts.push(`size=${calc.systemSizeKwp}kWp`);
    if (calc.indicativePriceEgp !== undefined) parts.push(`indicative price=EGP ${calc.indicativePriceEgp}`);
    if (calc.yearlySavingEgp !== undefined) parts.push(`yearly saving=EGP ${calc.yearlySavingEgp}`);
    if (calc.paybackYears !== undefined && calc.paybackYears !== null) parts.push(`payback=${calc.paybackYears}y`);
    if (parts.length) lines.push(`Calculator estimate: ${parts.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Maps a public website submission to services/crm/leadService.js#intakeLead's input shape.
 * Throws ApiError(400) for a segment/source the website should never actually send (defensive -
 * the validator already checked this).
 */
function mapWebsitePayload(body) {
  const segment = WEBSITE_SEGMENT_TO_CRM[body.segment];
  if (!segment) throw new ApiError('Unrecognized segment.', 400);
  const channel = WEBSITE_SOURCE_TO_CHANNEL[body.source];
  if (!channel) throw new ApiError('Unrecognized source.', 400);

  const calc = body.calculator && typeof body.calculator === 'object' ? body.calculator : null;

  return {
    name: body.name,
    phone: body.phone,
    segment,
    channel,
    governorate: body.governorate || undefined,
    // The website's own `utm.utm_source`, when present, is the single most useful "where did
    // this come from" label for a human reading the pipeline - falls back to a plain "Website"
    // label when the visit carried no campaign params at all (direct/organic traffic).
    source: body.utm?.utm_source || 'Website',
    utmSource: body.utm?.utm_source || undefined,
    utmMedium: body.utm?.utm_medium || undefined,
    utmCampaign: body.utm?.utm_campaign || undefined,
    landingPage: body.pageUrl || undefined,
    // Only set from the calculator's own typed estimate (a clean, known-unit figure) - never from
    // the generic `siteInput` number, whose unit depends on a form field (`extraKind`) the
    // website does not currently send with the submission; see buildIntakeNote for how that
    // ambiguous figure is preserved instead (as a note, not a typed field).
    systemSizeKwp: calc?.systemSizeKwp,
    valueEgp: calc?.indicativePriceEgp,
    ampDeviceId: body.ampDeviceId,
  };
}

/**
 * @returns {Promise<{ refCode: string } | { honeypot: true }>}
 */
async function intakePublicLead(body) {
  // Honeypot (Developer Brief: "a hidden honeypot input"). A real visitor's browser never
  // populates this field (it is visually hidden and never asked for); a non-empty value here means
  // an automated submission. Reported back to the caller as a distinct, non-error outcome so the
  // controller can respond exactly like a real success (no lead, no activity, nothing written) -
  // telling a bot "rejected" only teaches it to adapt.
  if (body.website) return { honeypot: true };

  const mapped = mapWebsitePayload(body);
  const { lead } = await leadService.intakeLead(mapped, {});

  const note = buildIntakeNote(body);
  if (note) await leadService.recordActivity(lead._id, { type: 'note', body: note }, {});

  return { refCode: lead.refCode };
}

module.exports = { intakePublicLead, mapWebsitePayload, buildIntakeNote, WEBSITE_SEGMENT_TO_CRM, WEBSITE_SOURCE_TO_CHANNEL };
