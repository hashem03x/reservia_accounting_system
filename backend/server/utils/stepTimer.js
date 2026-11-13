// ERP CHG-05 - server timing for the slow saves (purchase and sales invoices). Each save records how
// long every step took and writes ONE structured log line, e.g.
//   {"event":"invoice_save_timing","kind":"sales_invoice","totalMs":812,"steps":{"stockCheck":40,...},"ok":true}
// so the slow step is visible in the server logs (Vercel log drain) without a profiler. No business
// data beyond the document code is logged. Set INVOICE_TIMING_LOG=off to silence it.
const { performance } = require('perf_hooks');

function stepTimer(kind) {
  const started = performance.now();
  let last = started;
  const steps = {};
  return {
    mark(step) {
      const now = performance.now();
      steps[step] = Math.round((steps[step] || 0) + (now - last));
      last = now;
    },
    done({ ok = true, code = null } = {}) {
      const totalMs = Math.round(performance.now() - started);
      if (process.env.INVOICE_TIMING_LOG !== 'off' && process.env.NODE_ENV !== 'test') {
        console.info(JSON.stringify({ event: 'invoice_save_timing', kind, code, ok, totalMs, steps, at: new Date().toISOString() }));
      }
      return { totalMs, steps };
    },
  };
}

module.exports = { stepTimer };
