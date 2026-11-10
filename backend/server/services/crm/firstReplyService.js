'use strict';

const Lead = require('../../models/crm/leadModel');
const { workingHoursBetween } = require('../../utils/crm/workingHours');
const { FIRST_REPLY_ACTIVITY_TYPES } = require('../../utils/crm/constants');

// Reservia CRM - first-reply tracking (Change Request 2, item 3). The ONE place that decides what a
// "first reply" is, records it, and turns it into the Dashboard/Performance metrics, so the two
// screens can never disagree again ("Hours to first reply shows '-' with n=0 on Performance and
// Dashboard" was the reported symptom: only call/email/whatsapp_out activities ever set
// firstReplyAt, so a lead moved straight to Contacted never counted as replied).
//
// Definition (proposed by the client in Change Request 2 and adopted as-is):
//   the first reply is the EARLIEST of
//     1. the first transition out of New,
//     2. the first logged call,
//     3. the first logged WhatsApp message sent to the customer (whatsapp_out),
//     4. the first logged email.
//   Not a reply: the lead being created, imported or (re)assigned; an inbound customer message
//   (whatsapp_in); a note; an automated system entry.
//
// Elapsed time is measured in WORKING hours (Sun-Thu 09:00-18:00 Cairo, utils/crm/workingHours.js)
// from the lead's ORIGINAL submission time (Lead.submittedAt - the ad form / CSV timestamp), never
// from the moment it was imported.

const SLA_WORKING_HOURS = 8;

const VIA_BY_ACTIVITY_TYPE = { call: 'call', email: 'email', whatsapp_out: 'whatsapp_out' };

/** When the customer originally enquired - the SLA clock's start. Legacy leads fall back to createdAt. */
function leadOriginAt(lead) {
  return lead.submittedAt || lead.createdAt;
}

/** The firstReplyVia value an activity type would record, or null if that type is not a reply. */
function replyViaForActivityType(type) {
  return FIRST_REPLY_ACTIVITY_TYPES.includes(type) ? VIA_BY_ACTIVITY_TYPE[type] : null;
}

/**
 * Offers a qualifying event as the lead's first reply. Atomic and order-independent: the write
 * only lands if the lead has no first reply yet OR the stored one is LATER than this event, so a
 * later reply can never overwrite an earlier one, duplicate deliveries are harmless, and a
 * back-dated backfill can still correct a too-late value.
 *
 * @returns {Promise<boolean>} whether this event became the (new) first reply
 */
async function offerFirstReply(leadId, at, via, { session } = {}) {
  if (!at || !via) return false;
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return false;
  const result = await Lead.updateOne(
    { _id: leadId, $or: [{ firstReplyAt: null }, { firstReplyAt: { $gt: when } }] },
    { $set: { firstReplyAt: when, firstReplyVia: via } },
    { session }
  );
  return result.modifiedCount === 1;
}

/** Working hours from original submission to first reply for one lead, or null if not replied. */
function hoursToFirstReply(lead) {
  if (!lead.firstReplyAt) return null;
  return workingHoursBetween(leadOriginAt(lead), lead.firstReplyAt);
}

function round1(value) {
  return value == null ? null : Math.round(value * 10) / 10;
}

function average(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Metrics over a population of leads (each needs createdAt, submittedAt, firstReplyAt, replyDueAt).
 *
 *  - avgHours / medianHours: over REPLIED leads only (an unreplied lead has no reply time).
 *  - pctWithinSla: replied within 8 working hours / leads whose SLA outcome is already KNOWN -
 *    i.e. every replied lead PLUS every unreplied lead whose deadline has already passed (that is a
 *    definite miss). An unreplied lead that is still inside its 8 hours is "pending" and is left
 *    out of the percentage until it resolves, so the figure is neither flattered by ignoring missed
 *    leads nor dragged down by leads that can still make it.
 *
 * Every count travels with the figures so the UI can show n= and never imply confidence a tiny
 * sample doesn't have.
 */
function computeFirstReplyMetrics(leads, { now = new Date() } = {}) {
  const replyHours = [];
  let withinSla = 0;
  let overdueUnreplied = 0;
  let pending = 0;

  for (const lead of leads) {
    if (lead.firstReplyAt) {
      const hours = hoursToFirstReply(lead);
      replyHours.push(hours);
      if (hours <= SLA_WORKING_HOURS) withinSla += 1;
    } else if (lead.replyDueAt && new Date(lead.replyDueAt).getTime() < now.getTime()) {
      overdueUnreplied += 1;
    } else {
      pending += 1;
    }
  }

  const slaSampleSize = replyHours.length + overdueUnreplied;
  return {
    avgHours: round1(average(replyHours)),
    medianHours: round1(median(replyHours)),
    pctWithinSla: slaSampleSize === 0 ? null : round1((withinSla / slaSampleSize) * 100),
    repliedCount: replyHours.length,
    withinSlaCount: withinSla,
    overdueUnrepliedCount: overdueUnreplied,
    pendingCount: pending,
    // `sampleSize` keeps its historical meaning (replied leads behind the average); the SLA
    // percentage has its own denominator.
    sampleSize: replyHours.length,
    slaSampleSize,
    slaWorkingHours: SLA_WORKING_HOURS,
  };
}

module.exports = {
  SLA_WORKING_HOURS,
  leadOriginAt,
  replyViaForActivityType,
  offerFirstReply,
  hoursToFirstReply,
  computeFirstReplyMetrics,
};
