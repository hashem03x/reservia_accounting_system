const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addWorkingHours, workingHoursBetween, isWithinWorkingHours } = require('../../utils/crm/workingHours');

// Africa/Cairo observes DST in this environment's tzdata (EEST = UTC+3 in summer/fall, EET =
// UTC+2 in winter) - confirmed empirically: the 2026 transition back to standard time falls
// between Oct 29 and Oct 30. Every date below is November, safely on the +2 (EET) side of that
// boundary, which is what makes this fixed `h - 2` shortcut valid here - it is NOT a safe
// year-round assumption, and must never be reused for an October (or earlier) date without
// re-checking the real offset first.
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

// workingHoursBetween is the exact inverse of addWorkingHours - critical for "hours to first
// reply" reporting (services/crm/reportService.js, performanceReportService.js), which must never
// report a weekend as if it were working time.
test('workingHoursBetween: is the exact inverse of addWorkingHours for every scenario above', () => {
  const cases = [
    [cairoIso(2026, 11, 5, 17, 0), 8], // the brief's own Thursday 17:00 scenario
    [cairoIso(2026, 11, 1, 10, 0), 8],
    [cairoIso(2026, 11, 1, 18, 0), 1],
    [cairoIso(2026, 11, 6, 12, 0), 1], // Friday start
    [cairoIso(2026, 11, 4, 15, 0), 8], // spans Wed -> Thu
  ];
  for (const [start, hours] of cases) {
    const end = addWorkingHours(start, hours);
    assert.equal(workingHoursBetween(start, end), hours, `start=${start} hours=${hours}`);
  }
});

test('workingHoursBetween: a reply that merely spans a weekend is NOT counted as hours of delay', () => {
  // Created Thursday 17:00, replied Sunday 10:00: 1 hour left Thursday + 1 hour Sunday = 2 working
  // hours - comfortably inside the 8-hour SLA, even though ~65 RAW wall-clock hours passed.
  const created = cairoIso(2026, 11, 5, 17, 0);
  const repliedAt = cairoIso(2026, 11, 8, 10, 0);
  assert.equal(workingHoursBetween(created, repliedAt), 2);
});

test('workingHoursBetween: zero when the reply is not after creation', () => {
  const t = cairoIso(2026, 11, 1, 10, 0);
  assert.equal(workingHoursBetween(t, t), 0);
  assert.equal(workingHoursBetween(t, cairoIso(2026, 11, 1, 9, 0)), 0);
});

test('workingHoursBetween: a reply within the same working window is the plain hour difference', () => {
  assert.equal(workingHoursBetween(cairoIso(2026, 11, 1, 10, 0), cairoIso(2026, 11, 1, 14, 30)), 4.5);
});
