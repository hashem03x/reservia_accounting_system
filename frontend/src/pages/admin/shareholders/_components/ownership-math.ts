// Pure ownership-total math for the Capital Structure Setup wizard - extracted so it can be
// unit-tested directly (npm run test:unit) and so there is exactly ONE place this calculation
// lives, rather than the wizard silently re-deriving its own (previously incomplete) version.
//
// Root cause this fixes: the wizard used to total ONLY the rows being entered in the current
// session and call that "100% - ready to finalize", while the backend's real rule
// (backend/server/models/equity/shareholderModel.js's pre('validate') hook) sums ALL existing
// ACTIVE shareholders plus the one being saved. A shareholder added earlier via the separate
// "Add Shareholder" flow (available at any time, independent of this wizard) was invisible to the
// wizard's own math - three new rows that visually added up to a clean 100% could still be
// rejected by the backend once an existing shareholder's percentage was counted too, with no way
// for the user to have seen that coming. The fix is not a new business rule; it's making the
// wizard's own "is this 100% yet" claim count the same shareholders the backend counts.

type ShareholderLike = { status: string; ownershipPercentage: number };
type RowLike = { ownershipPercentage: unknown };

const round4 = (value: number) => Math.round(value * 10000) / 10000;

/** Sum of ownershipPercentage across ACTIVE shareholders only - mirrors the backend's own filter exactly. */
export function activeOwnershipTotal(shareholders: ShareholderLike[]): number {
  return round4(shareholders.filter((s) => s.status === "active").reduce((sum, s) => sum + (s.ownershipPercentage || 0), 0));
}

/** Sum of the wizard's own in-progress rows (numeric values only - a blank/invalid row contributes 0). */
export function rowsOwnershipTotal(rows: RowLike[]): number {
  return round4(rows.reduce((sum, r) => sum + (typeof r.ownershipPercentage === "number" ? r.ownershipPercentage : 0), 0));
}

/** What the backend will actually see once these rows are submitted: existing active + new rows. */
export function combinedOwnershipTotal(existingActiveTotal: number, rows: RowLike[]): number {
  return round4(existingActiveTotal + rowsOwnershipTotal(rows));
}

export const isOwnershipFinalized = (combinedTotal: number) => combinedTotal === 100;
