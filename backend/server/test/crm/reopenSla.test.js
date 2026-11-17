const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reopenSla } = require('../../services/crm/leadService');
const { leadOriginAt, hoursToFirstReply } = require('../../services/crm/firstReplyService');
const { addWorkingHours } = require('../../utils/crm/workingHours');

// SLA reopen fix (Nov 2026 QA finding): reopening a Lost lead kept its stale "first reply
// overdue" flag because addWorkingHours was only ever called once, at Lead.create - reopening
// never recomputed replyDueAt or reset firstReplyAt/firstReplyVia. These are pure-function tests
// of reopenSla() + leadOriginAt()'s interaction, run without a database (the full reopen flow -
// reopenLostOnRepeat / changeStage - needs a replica set for its transaction and is covered by
// test/crm/leadService.test.js and test/commercial/commercialWorkflow.test.js, both gated on
// TEST_DB_URI).

// A Sunday 10:00 Cairo (07:00 UTC) instant - safely inside the working week, well clear of any
// weekend-boundary edge case, so a fixed 8-working-hour SLA window lands the same day.
const SUNDAY_10AM_CAIRO = new Date('2026-11-15T07:00:00.000Z');
// A Thursday 17:00 Cairo (15:00 UTC) instant - 1 working hour left before the weekend.
const THURSDAY_5PM_CAIRO = new Date('2026-11-12T15:00:00.000Z');

test('leadOriginAt: a lead that has never been reopened falls back to submittedAt, then createdAt - unchanged from before this fix', () => {
  assert.equal(leadOriginAt({ slaCycleStartedAt: null, submittedAt: SUNDAY_10AM_CAIRO, createdAt: THURSDAY_5PM_CAIRO }), SUNDAY_10AM_CAIRO);
  assert.equal(leadOriginAt({ slaCycleStartedAt: null, submittedAt: null, createdAt: THURSDAY_5PM_CAIRO }), THURSDAY_5PM_CAIRO);
});

test('leadOriginAt: a reopened lead measures from the reopen, not the original (possibly months-old) submission', () => {
  const lead = { slaCycleStartedAt: SUNDAY_10AM_CAIRO, submittedAt: new Date('2025-01-01T00:00:00.000Z'), createdAt: new Date('2025-01-01T00:00:00.000Z') };
  assert.equal(leadOriginAt(lead), SUNDAY_10AM_CAIRO);
});

test('reopenSla: a lead that was NEVER replied to and breached its SLA gets a fresh deadline, an archived breached cycle, and no carried-over overdue flag', () => {
  const originalSubmittedAt = new Date('2026-10-01T08:00:00.000Z'); // long ago
  const lead = {
    slaCycleStartedAt: null,
    submittedAt: originalSubmittedAt,
    createdAt: originalSubmittedAt,
    replyDueAt: addWorkingHours(originalSubmittedAt, 8), // deadline passed weeks ago
    firstReplyAt: null,
    firstReplyVia: null,
    slaCycles: [],
  };
  const now = SUNDAY_10AM_CAIRO;
  const patch = reopenSla(lead, now);

  assert.equal(patch.slaCycleStartedAt, now);
  assert.equal(patch.firstReplyAt, null);
  assert.equal(patch.firstReplyVia, null);
  assert.deepEqual(patch.replyDueAt, addWorkingHours(now, 8), 'the SLA clock restarts from the reopen, not the original submission');
  assert.ok(patch.replyDueAt.getTime() > now.getTime(), 'the lead is no longer immediately overdue after reopening');

  assert.equal(patch.slaCycles.length, 1);
  const closed = patch.slaCycles[0];
  assert.equal(closed.startedAt, originalSubmittedAt, 'the closing cycle is archived with its own original start, not lost');
  assert.equal(closed.endedAt, now);
  assert.equal(closed.firstReplyAt, null);
  assert.equal(closed.breached, true, 'the closed cycle correctly records that it WAS breached historically');
});

test('reopenSla: a lead that already received a first reply before being lost gets a clean cycle too (the previously-silent "never obligated again" bug)', () => {
  const originalSubmittedAt = new Date('2026-10-01T08:00:00.000Z');
  const repliedAt = addWorkingHours(originalSubmittedAt, 3); // replied well within SLA
  const lead = {
    slaCycleStartedAt: null,
    submittedAt: originalSubmittedAt,
    createdAt: originalSubmittedAt,
    replyDueAt: addWorkingHours(originalSubmittedAt, 8),
    firstReplyAt: repliedAt,
    firstReplyVia: 'call',
    slaCycles: [],
  };
  const now = SUNDAY_10AM_CAIRO;
  const patch = reopenSla(lead, now);

  // Without this fix, firstReplyAt would stay set forever, so offerFirstReply's
  // "later-than-stored" guard would never let a NEW reply register after reopening.
  assert.equal(patch.firstReplyAt, null, 'the new cycle has no reply yet - the next activity must be able to set it');
  assert.equal(patch.firstReplyVia, null);
  assert.equal(patch.slaCycles[0].firstReplyAt, repliedAt, 'the original reply is preserved in the archived cycle, never erased');
  assert.equal(patch.slaCycles[0].breached, false, 'replied within SLA - correctly not a breach');
});

test('reopenSla: reopened during working hours vs outside working hours both produce a valid future deadline', () => {
  const lead = { slaCycleStartedAt: null, submittedAt: new Date('2026-09-01T08:00:00.000Z'), createdAt: new Date('2026-09-01T08:00:00.000Z'), replyDueAt: new Date('2026-09-01T12:00:00.000Z'), firstReplyAt: null, firstReplyVia: null, slaCycles: [] };

  const duringHours = reopenSla(lead, SUNDAY_10AM_CAIRO);
  assert.deepEqual(duringHours.replyDueAt, addWorkingHours(SUNDAY_10AM_CAIRO, 8));

  // Thursday 17:00 Cairo: only 1 working hour left before the Friday/Saturday weekend - the
  // deadline must correctly roll over to Sunday, not land mid-weekend.
  const outsideBoundary = reopenSla(lead, THURSDAY_5PM_CAIRO);
  const expectedDeadline = addWorkingHours(THURSDAY_5PM_CAIRO, 8);
  assert.deepEqual(outsideBoundary.replyDueAt, expectedDeadline);
  assert.ok(new Date(expectedDeadline).getTime() > THURSDAY_5PM_CAIRO.getTime() + 24 * 3600 * 1000, 'the weekend is correctly skipped, not counted as working time');
});

test('reopenSla: multiple reopen cycles each archive their own closing cycle, in order, without losing earlier ones', () => {
  let lead = {
    slaCycleStartedAt: null,
    submittedAt: new Date('2026-08-01T08:00:00.000Z'),
    createdAt: new Date('2026-08-01T08:00:00.000Z'),
    replyDueAt: new Date('2026-08-01T12:00:00.000Z'),
    firstReplyAt: null,
    firstReplyVia: null,
    slaCycles: [],
  };

  const firstReopenAt = new Date('2026-09-01T07:00:00.000Z'); // Sunday 09:00 Cairo
  const patch1 = reopenSla(lead, firstReopenAt);
  lead = { ...lead, ...patch1 };
  assert.equal(lead.slaCycles.length, 1);

  // Second cycle: never replied again, breaches, then reopened a second time.
  const secondReopenAt = new Date('2026-10-01T07:00:00.000Z');
  const patch2 = reopenSla(lead, secondReopenAt);
  lead = { ...lead, ...patch2 };

  assert.equal(lead.slaCycles.length, 2, 'both closed cycles are kept - never trimmed');
  assert.equal(lead.slaCycles[0].startedAt, patch1.slaCycles[0].startedAt, 'the first closed cycle is untouched by the second reopen');
  assert.equal(lead.slaCycles[1].startedAt, firstReopenAt, 'the second closed cycle started at the FIRST reopen, not the original submission');
  assert.equal(lead.slaCycles[1].endedAt, secondReopenAt);
  assert.equal(lead.slaCycleStartedAt, secondReopenAt, 'the lead is now on its third cycle, started at the second reopen');
  assert.equal(lead.firstReplyAt, null);
});

test('reopenSla + hoursToFirstReply: a reply logged just after a reopen scores correctly against the NEW cycle, not a multi-week-old origin', () => {
  const originalSubmittedAt = new Date('2026-01-01T08:00:00.000Z'); // months before the reopen
  const lead = {
    slaCycleStartedAt: null,
    submittedAt: originalSubmittedAt,
    createdAt: originalSubmittedAt,
    replyDueAt: addWorkingHours(originalSubmittedAt, 8),
    firstReplyAt: null,
    firstReplyVia: null,
    slaCycles: [],
  };
  const reopenedAt = SUNDAY_10AM_CAIRO;
  const patch = reopenSla(lead, reopenedAt);
  const reopened = { ...lead, ...patch };

  // A reply logged 2 working hours after the reopen.
  const repliedAt = addWorkingHours(reopenedAt, 2);
  const replied = { ...reopened, firstReplyAt: repliedAt, firstReplyVia: 'call' };

  const hours = hoursToFirstReply(replied);
  assert.ok(Math.abs(hours - 2) < 0.01, `expected ~2 working hours from the reopen, got ${hours} (would be ~7,000+ if measured from the original January submission)`);
});
