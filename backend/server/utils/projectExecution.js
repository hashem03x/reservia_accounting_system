// The ONE calculation of a Project's executed and remaining amounts, used by the Project model
// (persisted `remainingMoney`, see projectModel.js) and by every Project API response
// (`executedAmount` + `remainingMoney`), so the two can never disagree:
//
//   Executed Amount  = Contract Value × Executed Percentage / 100
//   Remaining Amount = Contract Value − Executed Amount
//
// Executed Percentage itself is NOT computed here - it stays the existing Sales-Order-driven value
// (projectAccountingService.js#recalculateExecutedPercentage: pre-tax Sales Orders / Contract Value,
// clamped to 0-100 by that service and by the schema).
//
// Amounts are computed in whole cents (integers) and converted back, so e.g. 1,000,000 × 20% is
// exactly 200,000 and the remaining exactly 800,000 - no floating-point drift.

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

/**
 * Returns `{ executedAmount, remainingMoney }`, or `null` when the project has no usable Contract
 * Value (a legacy/partial project) - callers then leave the stored value untouched rather than
 * fabricating one.
 */
function computeProjectExecution({ contractValue, executedPercentage }) {
  if (!isFiniteNumber(contractValue) || contractValue <= 0) return null;
  const pct = isFiniteNumber(executedPercentage) ? Math.min(100, Math.max(0, executedPercentage)) : 0;

  const contractCents = Math.round(contractValue * 100);
  const executedCents = Math.round((contractCents * pct) / 100);
  return {
    executedAmount: executedCents / 100,
    remainingMoney: (contractCents - executedCents) / 100,
  };
}

module.exports = { computeProjectExecution };
