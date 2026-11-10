// Reservia CRM - business-date handling in the Africa/Cairo timezone (Change Request 2, item 2).
//
// Two DIFFERENT kinds of time value exist in the CRM, and they must never be mixed up:
//
//   1. Calendar dates (a follow-up date). The user picks "12 November 2026" - a DAY, not an
//      instant. It is stored and returned as the literal string 'YYYY-MM-DD' and never passed
//      through `new Date('2026-11-12')`, which JavaScript reads as UTC midnight and which then
//      renders as "Nov 12, 2:00 AM" in Cairo (the exact bug reported in Change Request 2), or as
//      "Nov 11" in any browser west of UTC.
//
//   2. Real instants (lead creation, first reply, stage changes, activities, audit logs). These
//      stay real Date/ISO timestamps and are only ever DISPLAYED in Cairo time - nothing here
//      changes how they are stored.
//
// Every helper is pure (no DB), so it is unit-testable and shared by the model, validators,
// reports and CSV import alike.

const BUSINESS_TIMEZONE = 'Africa/Cairo';
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const cairoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const cairoPartsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** True only for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30, 2026-13-01...). */
function isValidDateOnly(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(DATE_ONLY_PATTERN);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** The Cairo calendar date ('YYYY-MM-DD') an instant falls on. */
function cairoDateOf(instant) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  return cairoDateFormatter.format(date); // en-CA formats as YYYY-MM-DD
}

/** Today's date in Cairo, as 'YYYY-MM-DD'. */
function cairoToday(now = new Date()) {
  return cairoDateOf(now);
}

/**
 * Normalizes anything a client or a legacy record might hold into a date-only string:
 *   - 'YYYY-MM-DD'                 -> returned unchanged (never re-parsed through Date)
 *   - a Date / full ISO timestamp  -> the Cairo calendar day that instant falls on. This is
 *     exactly right for legacy follow-ups, which were stored as `new Date('2026-11-12')` (UTC
 *     midnight = 02:00 Cairo on the 12th), and for a client that sent local-midnight-with-offset.
 *   - null / undefined / ''        -> null
 * Returns undefined for anything unparseable, so callers can distinguish "cleared" from "invalid".
 */
function toDateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (DATE_ONLY_PATTERN.test(trimmed)) return isValidDateOnly(trimmed) ? trimmed : undefined;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? undefined : cairoDateOf(parsed);
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : cairoDateOf(value);
  return undefined;
}

/** Cairo wall-clock parts for an instant. */
function cairoParts(instant) {
  const parts = Object.fromEntries(cairoPartsFormatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * The UTC instant of a Cairo wall-clock time. Cairo has observed DST in some years, so the offset
 * is resolved for that specific moment rather than assumed to be +02:00 - two passes converge even
 * across a DST boundary.
 */
function cairoWallTimeToInstant(year, month, day, hour = 0, minute = 0, second = 0) {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  for (let i = 0; i < 2; i += 1) {
    const p = cairoParts(guess);
    const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += target - asIfUtc;
  }
  return new Date(guess);
}

/**
 * [start, end) instants of a calendar month in Cairo time - month is 1-12. Reports use this so a
 * lead created at 00:30 on 1 November Cairo time counts in November, not October (it is still
 * 31 October in UTC at that moment).
 */
function cairoMonthBounds(year, month) {
  const start = cairoWallTimeToInstant(year, month, 1);
  const end = month === 12 ? cairoWallTimeToInstant(year + 1, 1, 1) : cairoWallTimeToInstant(year, month + 1, 1);
  return { start, end };
}

/** Whether a follow-up date ('YYYY-MM-DD') is strictly before today in Cairo - due today is not overdue. */
function isFollowUpOverdue(followUpDate, now = new Date()) {
  if (!isValidDateOnly(followUpDate)) return false;
  return followUpDate < cairoToday(now); // YYYY-MM-DD strings sort chronologically
}

/**
 * Parses an ORIGINAL lead-submission timestamp from an external source (CSV, webhook). Accepts:
 *   - ISO 8601 with an explicit offset or Z ('2026-11-09T10:00:00+02:00', '...Z')
 *   - 'YYYY-MM-DD HH:mm[:ss]' or 'YYYY-MM-DDTHH:mm[:ss]' with NO offset - read as Cairo local time,
 *     the timezone Reservia's marketing team works in
 *   - a Unix timestamp in seconds or milliseconds (numbers or numeric strings - Meta/TikTok)
 * Day-first/month-first forms like '09/11/2026' are deliberately rejected: they are ambiguous, and
 * a silently-wrong SLA start is worse than a clear row error.
 * Returns a Date, or null if the value cannot be parsed unambiguously.
 */
function parseSubmissionTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10}(\d{3})?$/.test(value.trim()))) {
    const n = Number(value);
    const ms = n < 1e12 ? n * 1000 : n;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  const local = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    const [year, month, day, hour, minute, second] = local.slice(1).map(v => Number(v || 0));
    if (!isValidDateOnly(`${local[1]}-${local[2]}-${local[3]}`) || hour > 23 || minute > 59 || second > 59) return null;
    return cairoWallTimeToInstant(year, month, day, hour, minute, second);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    // Meta's Graph API writes offsets as "+0000" (no colon) - normalized to "+00:00" so parsing
    // never depends on how lenient the JS engine's Date parser happens to be.
    const date = new Date(trimmed.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

module.exports = {
  BUSINESS_TIMEZONE,
  isValidDateOnly,
  cairoDateOf,
  cairoToday,
  toDateOnly,
  cairoParts,
  cairoWallTimeToInstant,
  cairoMonthBounds,
  isFollowUpOverdue,
  parseSubmissionTimestamp,
};
