// Working-hours SLA calculation (Reservia CRM Developer Brief, sections 4 and 7): "8 working hours
// to first reply (Sun to Thu, 09:00 to 18:00 Cairo); the automatic WhatsApp acknowledgement does
// not count as the reply." Ported faithfully from the supplied reference sample's
// `addWorkingHours()` - a minute-by-minute walk through Cairo civil time via Intl.DateTimeFormat,
// so it is correct across the Africa/Cairo timezone's own DST history without hand-rolled offset
// math, and naturally handles the Thursday-to-Sunday weekend the brief's own acceptance scenario
// exercises (a lead arriving Thursday at 17:00 is due Sunday at 16:00: 1 working hour left on
// Thursday + a Friday/Saturday weekend skip + 7 more hours from Sunday 09:00).
//
// `start` may be a Date or an ISO string; returns a Date. A pure function - no DB, no clock
// mutation - so it is safe to call both when a lead is created and when it is reopened.

const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;
const WORKING_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu']; // Fri/Sat are the Egyptian weekend.
// A guard against an infinite loop if `hours` is absurd or the clock is somehow stuck - at one
// simulated minute per iteration, 20,000 iterations is far more than any real SLA duration needs.
const MAX_ITERATIONS = 20000;

const cairoFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  hourCycle: 'h23',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function cairoParts(date) {
  const parts = Object.fromEntries(cairoFormatter.formatToParts(date).map(p => [p.type, p.value]));
  return { weekday: parts.weekday, hour: Number(parts.hour), minute: Number(parts.minute) };
}

/**
 * @param {Date|string} start
 * @param {number} hours - working hours to add (the brief: 8)
 * @returns {Date}
 */
function addWorkingHours(start, hours) {
  let remainingMinutes = hours * 60;
  let cursor = new Date(start);
  cursor.setUTCSeconds(0, 0);

  for (let guard = 0; guard < MAX_ITERATIONS && remainingMinutes > 0; guard += 1) {
    const { weekday, hour, minute } = cairoParts(cursor);
    const isWorkingDay = WORKING_WEEKDAYS.includes(weekday);
    const isWorkingHour = isWorkingDay && hour >= WORK_START_HOUR && hour < WORK_END_HOUR;

    if (isWorkingHour) {
      const minutesLeftToday = (WORK_END_HOUR - hour) * 60 - minute;
      const step = Math.min(minutesLeftToday, remainingMinutes);
      cursor = new Date(cursor.getTime() + step * 60000);
      remainingMinutes -= step;
    } else {
      // Outside working hours (or a weekend day) - advance to the next minute boundary and keep
      // walking; the loop naturally lands on the next working window without separate "skip to
      // next Sunday 09:00" logic, so every boundary (including the Thu 17:00 -> Sun case) falls
      // out of the same rule.
      cursor = new Date(cursor.getTime() + (60 - minute) * 60000);
    }
  }
  return cursor;
}

/** Cairo-local working hours (true only Sun-Thu 09:00-18:00, Cairo time) for the given instant. */
function isWithinWorkingHours(date) {
  const { weekday, hour } = cairoParts(new Date(date));
  return WORKING_WEEKDAYS.includes(weekday) && hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
}

module.exports = { addWorkingHours, isWithinWorkingHours, WORK_START_HOUR, WORK_END_HOUR, WORKING_WEEKDAYS };
