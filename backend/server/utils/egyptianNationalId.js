// Structural validation for an Egyptian National ID (14 digits total: C YY MM DD GG SSSS):
//   C       century indicator - 2 for 1900-1999, 3 for 2000-2099                          (1 digit)
//   YY MM DD  birth year/month/day within that century - checked for a real calendar date (6 digits)
//   GG      governorate/birth-location code (not range-checked here - the official code list
//           includes both the 27 governorates and several "born abroad" codes that are not
//           publicly documented as one simple numeric range, so narrowing this risks rejecting
//           real, valid IDs)                                                              (2 digits)
//   SSSS    a 4-digit sequence number, its last digit encoding gender by parity              (4 digits)
//   K       a final check digit - the government's actual check-digit algorithm is not
//           publicly published, so it is intentionally NOT reimplemented/guessed here; a bogus
//           "looks like a checksum" calculation would be worse than none; validated only as a
//           plain digit.                                                                  (1 digit)
// 1 + 6 + 2 + 4 + 1 = 14 digits total. This catches the overwhelming majority of typos/garbage
// (wrong length, impossible date) without pretending to a stronger guarantee this function cannot
// actually make.

const PATTERN = /^([23])(\d{2})(\d{2})(\d{2})(\d{2})(\d{4})(\d)$/;

function isValidEgyptianNationalId(value) {
  if (typeof value !== 'string') return false;
  const match = PATTERN.exec(value.trim());
  if (!match) return false;
  const [, century, yy, mm, dd] = match;
  const year = (century === '2' ? 1900 : 2000) + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return false;
  return true;
}

module.exports = { isValidEgyptianNationalId };
