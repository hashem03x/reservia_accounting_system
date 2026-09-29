// Lightweight structured logging for accounting events (PROJECT_CREATED,
// JOURNAL_ENTRY_POSTED, etc). The codebase has no winston/structured logger (only morgan for HTTP
// access logs - see reversia-business-logic.md), so this stays consistent with the existing
// console.log/console.error convention instead of introducing a new logging dependency. Never
// pass secrets/tokens in `data`.
function logAccountingEvent(event, data = {}) {
  console.log(JSON.stringify({ event, ...data, timestamp: new Date().toISOString() }));
}

function logAccountingError(event, error, data = {}) {
  console.error(JSON.stringify({ event, error: error?.message, ...data, timestamp: new Date().toISOString() }));
}

module.exports = { logAccountingEvent, logAccountingError };
