// Egyptian phone normalization (Reservia CRM Developer Brief, section 7 "Rules that must not
// change": "One lead per phone number, stored as +20...; repeats merge, never duplicate.").
// Ported faithfully from the supplied reference sample's `normPhone()` (same digit-stripping,
// same Arabic-Indic digit conversion, same leading-zero/country-code handling, same two accepted
// patterns), since the brief says the rules in the spec/reference must not change.
//
// Accepts: Arabic-Indic digits (٠-٩), a leading 00/+20/20 country-code prefix, a leading 0, any
// punctuation/spaces mixed in. Two shapes are valid once the prefix is stripped:
//   - a mobile number: carrier prefix 010/011/012/015 + 8 more digits (10 digits total), or
//   - a 9-digit number starting with 2 (e.g. a Cairo landline after its leading 0 is stripped).
// Anything else (a foreign number, a short/garbled string) is rejected.
//
// Returns the canonical '+20XXXXXXXXX' string, or null if the input doesn't match either shape.

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function normalizeEgyptianPhone(input) {
  let digits = String(input || '').replace(/[٠-٩]/g, c => String(ARABIC_INDIC_DIGITS.indexOf(c)));
  digits = digits.replace(/[^\d]/g, '');

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('20')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);

  if (/^1[0125]\d{8}$/.test(digits) || /^2\d{8}$/.test(digits)) return `+20${digits}`;
  return null;
}

module.exports = { normalizeEgyptianPhone };
