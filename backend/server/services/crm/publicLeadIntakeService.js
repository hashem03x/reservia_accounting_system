'use strict';

const ApiError = require('../../utils/apiError');
const { normalizeSource } = require('../../utils/crm/sourceNormalization');
const { touchesFromWebsite } = require('../../utils/crm/attribution');
const WaRefCode = require('../../models/crm/waRefCodeModel');
const Lead = require('../../models/crm/leadModel');
const { processIntake } = require('./leadIntakeService');

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
  if (payload.submittedFrom && typeof payload.submittedFrom === 'string') lines.push(`Submitted from: ${payload.submittedFrom.slice(0, 200)}`);
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

  // CRM launch blocker C1: the website now sends the visitor's FIRST touch (the campaign/page that
  // acquired them, preserved across internal navigation) and LAST touch (most recent campaign).
  // The lead's source, UTM fields, click ids and landing page come from the FIRST touch - never
  // from the page the form happened to be submitted on. Older website builds (utm/pageUrl/referrer
  // only) map to the same shape.
  const { first, last } = touchesFromWebsite(body, channel);

  return {
    name: body.name,
    phone: body.phone,
    segment,
    channel,
    governorate: body.governorate || undefined,
    // Centralized source-mapping rules (Change Request 1, Feature 1) - see
    // utils/crm/sourceNormalization.js's own header for the full table (Google Ads needs BOTH
    // source=google and medium=cpc - or a Google click id - Meta Ads needs a paid medium, TikTok,
    // Organic vs Direct by referrer when there's no UTM at all).
    source: first.source,
    utmSource: first.utmSource || undefined,
    utmMedium: first.utmMedium || undefined,
    utmCampaign: first.utmCampaign || undefined,
    utmContent: first.utmContent || undefined,
    // Change Request 2, item 7: utm_term was dropped; campaign is the one displayed field.
    utmTerm: first.utmTerm || undefined,
    campaign: first.campaign || undefined,
    landingPage: first.landingPage || undefined,
    referrer: first.referrer || undefined,
    firstTouch: first,
    lastTouch: last,
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
  // Change Request 2, item 6: the website is one of the five doors into the SAME unified intake.
  // The website's own per-submission `eventId` makes a double-click or a retried request
  // idempotent (one lead, one note); a submission without one (an older website build) still
  // works exactly as before.
  const { leadId, refCode } = await processIntake({
    channel: 'website',
    externalId: body.eventId ? `event:${body.eventId}` : null,
    lead: mapped,
    note: buildIntakeNote(body),
  });
  if (refCode) return { refCode };
  const lead = await Lead.findById(leadId).select('refCode').lean();
  return { refCode: lead?.refCode };
}

/**
 * Registers a WhatsApp Ref code's attribution at the moment the website builds a wa.me link
 * (Change Request 1, Feature 1) - the ONE place a WA code's source is ever recorded, since the
 * code itself (services/waRefCode.ts on the website) is never otherwise persisted. Upsert, not
 * create-only - the website may retry a flaky network call safely.
 */
async function registerWaRefCode({ code, utmSource, utmMedium, utmCampaign, utmContent, referrer }) {
  if (!code || typeof code !== 'string') throw new ApiError('A ref code is required.', 400);
  const source = normalizeSource({ utmSource, utmMedium, referrer });
  await WaRefCode.findOneAndUpdate(
    { code: code.trim().slice(0, 40) },
    { $set: { source, utmSource: utmSource || null, utmMedium: utmMedium || null, utmCampaign: utmCampaign || null, utmContent: utmContent || null } },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

module.exports = { intakePublicLead, mapWebsitePayload, buildIntakeNote, registerWaRefCode, WEBSITE_SEGMENT_TO_CRM, WEBSITE_SOURCE_TO_CHANNEL };
