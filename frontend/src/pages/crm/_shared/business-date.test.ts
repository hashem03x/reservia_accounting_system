// Run as part of: npm run test:unit (Node's built-in test runner; Node strips the types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatFollowUpDate, isFollowUpOverdue, toDateOnly, cairoDateOf, formatCairoDateTime, toDateInputValue } from "./business-date.ts";

// Change Request 2, item 2: "A follow-up date of 12 Nov shows as 'Nov 12, 2:00 AM'."

test("formatFollowUpDate: shows exactly the date entered - no time, no 2:00 AM, in any browser timezone", () => {
  const shown = formatFollowUpDate("2026-11-12", "en-GB");
  assert.equal(shown, "12 Nov 2026");
  assert.ok(!/AM|PM|:/.test(shown));
  assert.equal(formatFollowUpDate("2026-11-12", "en-GB", { withYear: false }), "12 Nov");
});

test("formatFollowUpDate: a legacy UTC-midnight timestamp still shows 12 November", () => {
  assert.equal(formatFollowUpDate("2026-11-12T00:00:00.000Z", "en-GB"), "12 Nov 2026");
});

test("formatFollowUpDate: empty / invalid values render a dash, never 'Invalid Date'", () => {
  assert.equal(formatFollowUpDate(null, "en-GB"), "-");
  assert.equal(formatFollowUpDate("garbage", "en-GB"), "-");
});

test("toDateOnly / toDateInputValue keep the calendar day; instants map to their CAIRO day", () => {
  assert.equal(toDateOnly("2026-11-12"), "2026-11-12");
  assert.equal(toDateInputValue("2026-11-12"), "2026-11-12");
  assert.equal(cairoDateOf("2026-11-11T22:30:00Z"), "2026-11-12", "00:30 Cairo on the 12th");
  assert.equal(cairoDateOf("2026-11-11T21:59:00Z"), "2026-11-11");
});

test("isFollowUpOverdue: due today is NOT overdue; it becomes overdue when the Cairo day ends", () => {
  assert.equal(isFollowUpOverdue("2026-11-12", new Date("2026-11-12T00:30:00Z")), false);
  assert.equal(isFollowUpOverdue("2026-11-12", new Date("2026-11-12T21:59:00Z")), false);
  assert.equal(isFollowUpOverdue("2026-11-12", new Date("2026-11-12T22:00:00Z")), true);
  assert.equal(isFollowUpOverdue(null), false);
});

test("formatCairoDateTime: a real instant is shown in Cairo time", () => {
  // 08:39 UTC = 10:39 Cairo (the Change Request 2 example "Sunday 10:39").
  assert.match(formatCairoDateTime("2026-11-08T08:39:00Z", "en-GB"), /8 Nov 2026.*10:39/);
  assert.equal(formatCairoDateTime(null, "en-GB"), "-");
});
