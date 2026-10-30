// Reservia CRM - allowed browser origins for the PUBLIC lead-intake endpoint
// (routes/crm/publicLeadRoute.js), which is deliberately separate from app.js's global CORS
// allow-list: that one guards cookie-credentialed, authenticated ERP/CRM routes and must only
// ever allow the Central Portal frontend; this one guards a public, unauthenticated,
// no-credentials POST that the real public marketing website needs to call from the browser, and
// must never be widened to "allow any origin" - that would let any third-party page scrape this
// endpoint for mass/automated submissions server-side rate limiting alone doesn't fully stop.
//
// WEBSITE_ALLOWED_ORIGINS - comma-separated, no trailing slashes (e.g.
// "https://reservia-energy.com,https://www.reservia-energy.com"). Falls back to the real
// production domain confirmed in the website repo's own vercel.json redirect rule
// (reserviawebsite.vercel.app -> https://reservia-energy.com) plus its apex/www variants and
// local dev, so the endpoint works out of the box without requiring the env var to be set first -
// override it if the real production domain ever changes.
const DEFAULT_ORIGINS = ['https://reservia-energy.com', 'https://www.reservia-energy.com'];
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function parseConfiguredOrigins() {
  const raw = process.env.WEBSITE_ALLOWED_ORIGINS;
  if (!raw) return null;
  return raw
    .split(',')
    .map(o => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

const configured = parseConfiguredOrigins();
exports.PUBLIC_LEAD_ALLOWED_ORIGINS = [...(configured || DEFAULT_ORIGINS), ...DEV_ORIGINS];

exports.isAllowedWebsiteOrigin = origin => !origin || exports.PUBLIC_LEAD_ALLOWED_ORIGINS.includes(origin);
