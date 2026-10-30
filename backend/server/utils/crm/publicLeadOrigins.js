// Reservia CRM - allowed browser origins for the real reservia-energy.com marketing website,
// across TWO independent CORS policies that must never be coupled to each other:
//   - WEBSITE_ALLOWED_ORIGINS -> PUBLIC_LEAD_ALLOWED_ORIGINS, used only by the public,
//     unauthenticated, no-credentials lead-intake route (routes/crm/publicLeadRoute.js) - must
//     never be widened to "allow any origin", since that would let any third-party page scrape
//     this endpoint for mass/automated submissions (server-side rate limiting alone doesn't fully
//     stop that either).
//   - WEBSITE_PRODUCTION_ORIGINS, used only by app.js's global, cookie-credentialed CORS policy
//     for the authenticated ERP/CRM API - letting the website's own Idempotency-Key-bearing quote
//     form preflight successfully against /api/v1/crm/leads, without widening who can make
//     cookie-bearing requests any further than this one real domain.
// Overriding either env var must never silently also change the other's allow-list - that's why
// each has its own, both comma-separated, no trailing slashes (e.g.
// "https://reservia-energy.com,https://www.reservia-energy.com"), and both fall back to the real
// production domain confirmed in the website repo's own vercel.json redirect rule
// (reserviawebsite.vercel.app -> https://reservia-energy.com) plus its apex/www variants, so both
// work out of the box without requiring either env var to be set first.
const DEFAULT_ORIGINS = ['https://reservia-energy.com', 'https://www.reservia-energy.com'];
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function parseOrigins(raw) {
  if (!raw) return null;
  return raw
    .split(',')
    .map(o => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

// WEBSITE_PRODUCTION_ORIGINS env var - comma-separated, no trailing slashes. Used by app.js's
// global, credentialed CORS policy. Falls back to the real production domain (confirmed in the
// website repo's own vercel.json redirect rule: reserviawebsite.vercel.app -> reservia-energy.com)
// plus its apex/www variants, so it works out of the box without requiring the env var to be set.
exports.WEBSITE_PRODUCTION_ORIGINS = parseOrigins(process.env.WEBSITE_PRODUCTION_ORIGINS) || DEFAULT_ORIGINS;

// WEBSITE_ALLOWED_ORIGINS env var - same comma-separated shape, but for the PUBLIC lead-intake
// route's own, non-credentialed CORS policy only (see this file's header comment for why the two
// are kept independent). Same real-domain fallback when unset.
exports.PUBLIC_LEAD_ALLOWED_ORIGINS = [...(parseOrigins(process.env.WEBSITE_ALLOWED_ORIGINS) || DEFAULT_ORIGINS), ...DEV_ORIGINS];

exports.isAllowedWebsiteOrigin = origin => !origin || exports.PUBLIC_LEAD_ALLOWED_ORIGINS.includes(origin);
