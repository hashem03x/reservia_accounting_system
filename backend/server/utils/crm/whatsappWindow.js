// WhatsApp Business Platform's "24-hour customer service window" (Meta's own messaging rule,
// referenced by the Developer Brief's "24-hour window handling"): a business may send a free-form
// (non-template) reply only within 24 hours of the customer's MOST RECENT inbound message; outside
// that window, only a pre-approved message template may be sent. Pure date math - safe to build
// and test now even though the actual send path (services/crm/whatsappService.js) is not
// implemented yet for lack of a real access token.

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** @returns {boolean} whether a free-form reply may still be sent, given the customer's last inbound message time */
function isWithinFreeFormWindow(lastInboundAt, now = new Date()) {
  if (!lastInboundAt) return false;
  return now.getTime() - new Date(lastInboundAt).getTime() < WINDOW_MS;
}

/** @returns {Date|null} when the free-form window closes, or null if there is no inbound message to measure from */
function freeFormWindowCloses(lastInboundAt) {
  if (!lastInboundAt) return null;
  return new Date(new Date(lastInboundAt).getTime() + WINDOW_MS);
}

module.exports = { isWithinFreeFormWindow, freeFormWindowCloses, WINDOW_MS };
