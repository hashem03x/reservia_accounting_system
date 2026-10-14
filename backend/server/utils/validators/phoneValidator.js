// Shared phone-number validation for Customers and Vendors (docs section "Mandatory Vendor and
// Customer Contact Information") - a single source of truth so the two entities (and their CSV
// imports) never drift into independently-maintained regexes. Accepts either:
//   - A valid Egyptian mobile number (the four real carrier prefixes - 010/011/012/015 - optionally
//     prefixed with +20/0020/20), matching the existing convention already used elsewhere in this
//     codebase (e.g. salesReturnValidator.js's Egyptian mobile checks).
//   - A generic international number (E.164-ish: optional leading "+", 8-15 digits total, no
//     leading 0) - so a real non-Egyptian vendor/customer phone is never incorrectly rejected.
const EGYPTIAN_MOBILE_REGEX = /^(?:\+20|0020|20)?0?1[0125][0-9]{8}$/;
const INTERNATIONAL_PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

function isValidPhone(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return EGYPTIAN_MOBILE_REGEX.test(trimmed) || INTERNATIONAL_PHONE_REGEX.test(trimmed);
}

module.exports = { isValidPhone, EGYPTIAN_MOBILE_REGEX, INTERNATIONAL_PHONE_REGEX };
