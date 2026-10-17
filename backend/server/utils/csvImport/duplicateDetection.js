// Detects duplicate business identifiers WITHIN the uploaded file itself (docs section "CSV
// Parsing and Validation" - "Duplicate records within the uploaded file"), as distinct from a
// duplicate against an ALREADY-EXISTING record (checked separately per module, usually against an
// in-memory Set fetched once before validating any row). Reports every row after the first
// occurrence of a key, pointing back at the row that "owns" it.

exports.findDuplicatesInFile = function findDuplicatesInFile(rows, keyFn) {
  const firstSeenAtRow = new Map(); // normalized key -> 1-based CSV data-row index (1 = first data row)
  const duplicates = []; // { row, key, firstRow }

  rows.forEach((row, index) => {
    const rawKey = keyFn(row);
    if (rawKey == null) return;
    const key = String(rawKey).trim().toLowerCase();
    if (!key) return;

    if (firstSeenAtRow.has(key)) {
      duplicates.push({ row: index + 1, key: rawKey, firstRow: firstSeenAtRow.get(key) });
    } else {
      firstSeenAtRow.set(key, index + 1);
    }
  });

  return duplicates;
};
