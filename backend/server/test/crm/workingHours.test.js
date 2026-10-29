const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addWorkingHours, isWithinWorkingHours } = require('../../utils/crm/workingHours');

// Africa/Cairo is UTC+2 year-round (Egypt abolished DST in 2015) - these fixed UTC offsets are
// stable, not a seasonal assumption.
const cairoIso = (y, m, d, h, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 2, min)).toISOString();
const cairoWallClock = date =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(date));

test('addWorkingHours: the brief\'s own acceptance scenario - Thursday 17:00 + 8 working hours = Sunday 16:00 Cairo', () => {
  // 1 hour left on Thursday (17:00-18:00) + Friday/Saturday weekend skipped entirely + 7 more
  // hours from Sunday 09:00 = Sunday 16:00.
  const start = cairoIso(2026, 11, 5, 17, 0); // confirmed Thursday 17:00 Cairo
  const due = addWorkingHours(start, 8);
  assert.equal(cairoWallClock(due), 'Sunday 16:00');
});

test('addWorkingHours: a lead created well inside a working day finishes the same day', () => {
  const start = cairoIso(2026, 11, 1, 10, 0); // confirmed Sunday 10:00 Cairo
  const due = addWorkingHours(start, 8);
  assert.equal(cairoWallClock(due), 'Sunday 18:00');
});

test('addWorkingHours: exactly at the 18:00 close rolls to the next working day at 09:00', () => {
  const start = cairoIso(2026, 11, 1, 18, 0); // Sunday 18:00 (the instant the window closes)
  const due = addWorkingHours(start, 1);
  assert.equal(cairoWallClock(due), 'Monday 10:00');
});

test('addWorkingHours: a lead arriving before the window opens starts counting from 09:00 the same day', () => {
  const start = cairoIso(2026, 11, 1, 5, 0); // Sunday 05:00 - before the window opens
  const due = addWorkingHours(start, 1);
  assert.equal(cairoWallClock(due), 'Sunday 10:00');
});

test('addWorkingHours: a lead arriving on Friday (weekend) starts counting from Sunday 09:00', () => {
  const start = cairoIso(2026, 11, 6, 12, 0); // confirmed Friday
  const due = addWorkingHours(start, 1);
  assert.equal(cairoWallClock(due), 'Sunday 10:00');
});

test('addWorkingHours: a lead arriving on Saturday (weekend) also starts counting from Sunday 09:00', () => {
  const start = cairoIso(2026, 11, 7, 23, 0); // confirmed Saturday
  const due = addWorkingHours(start, 1);
  assert.equal(cairoWallClock(due), 'Sunday 10:00');
});

test('addWorkingHours: a full 8-hour SLA spanning more than one working day accumulates correctly', () => {
  // Wednesday 15:00 -> 3 hours left Wednesday (15:00-18:00) + 5 more hours Thursday from 09:00 = Thursday 14:00.
  const start = cairoIso(2026, 11, 4, 15, 0); // confirmed Wednesday
  const due = addWorkingHours(start, 8);
  assert.equal(cairoWallClock(due), 'Thursday 14:00');
});

test('isWithinWorkingHours: true only Sun-Thu 09:00-18:00 Cairo, false on the boundary\'s far side and on Fri/Sat', () => {
  assert.equal(isWithinWorkingHours(cairoIso(2026, 11, 1, 9, 0)), true); // Sunday 09:00 - window opens
  assert.equal(isWithinWorkingHours(cairoIso(2026, 11, 1, 17, 59)), true); // Sunday 17:59 - still open
  assert.equal(isWithinWorkingHours(cairoIso(2026, 11, 1, 18, 0)), false); // Sunday 18:00 - closed
  assert.equal(isWithinWorkingHours(cairoIso(2026, 11, 1, 8, 59)), false); // Sunday 08:59 - not yet open
  assert.equal(isWithinWorkingHours(cairoIso(2026, 11, 6, 12, 0)), false); // Friday - weekend
  assert.equal(isWithinWorkingHours(cairoIso(2026, 11, 7, 12, 0)), false); // Saturday - weekend
});
