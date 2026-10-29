'use strict';

const https = require('https');

// Reservia CRM -> Amplitude. Server-side only (there is no Amplitude browser key shipped to the
// CRM frontend), and strictly non-PII per the Developer Brief section 4H: "Never send names,
// phone numbers, emails, free-text notes, message contents, or any other personal data as event
// properties or user/device identifiers. Keep IP tracking disabled."
//
// Mock mode: with no AMPLITUDE_API_KEY configured (local dev, CI, or before the real key is
// issued), every call is a no-op that resolves immediately - mirrors the website repo's own
// mock-mode convention, so analytics configuration can never block or fail product behaviour.

const AMPLITUDE_HTTP_API = 'https://api2.amplitude.com/2/httpapi';

// Defense in depth: even though every call site is expected to pass only enum-like/numeric
// properties, any key whose name itself suggests personal data is dropped rather than trusted, and
// any string value shaped like free text or containing an '@' is dropped too.
const BLOCKED_KEY_PATTERN = /name|phone|email|note|body|message|address|whatsapp|content/i;
const MAX_STRING_VALUE_LENGTH = 40;

function isSafeValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= MAX_STRING_VALUE_LENGTH && !value.includes('@');
  return false;
}

function sanitizeProperties(properties = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'ampDeviceId') continue; // carried separately as device_id, never as a property
    if (BLOCKED_KEY_PATTERN.test(key)) continue;
    if (!isSafeValue(value)) continue;
    safe[key] = value;
  }
  return safe;
}

const isEnabled = () => !!process.env.AMPLITUDE_API_KEY;

/**
 * Fires one Amplitude event. Never throws - analytics must never be able to fail a user-facing
 * request (a dropped event is acceptable; a 500 caused by an analytics outage is not).
 * @returns {Promise<{sent: boolean}>}
 */
function trackEvent(eventType, properties = {}) {
  if (!isEnabled()) return Promise.resolve({ sent: false, reason: 'AMPLITUDE_API_KEY not configured' });

  const { ampDeviceId, ...rest } = properties;
  const event = {
    event_type: eventType,
    device_id: ampDeviceId || 'crm-system',
    event_properties: sanitizeProperties(rest),
    // Explicitly zeroed rather than omitted - disables Amplitude's IP-based geolocation enrichment
    // per the brief's "Keep IP tracking disabled".
    ip: '0.0.0.0',
    time: Date.now(),
  };

  const payload = JSON.stringify({ api_key: process.env.AMPLITUDE_API_KEY, events: [event] });

  return new Promise(resolve => {
    const req = https.request(
      AMPLITUDE_HTTP_API,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      res => {
        res.on('data', () => {});
        res.on('end', () => resolve({ sent: res.statusCode === 200, statusCode: res.statusCode }));
      }
    );
    req.on('error', () => resolve({ sent: false }));
    req.write(payload);
    req.end();
  });
}

module.exports = { trackEvent, sanitizeProperties, isEnabled };
