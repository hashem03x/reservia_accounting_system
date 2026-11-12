const asyncHandler = require('express-async-handler');
const WebsiteIntegration = require('../../models/website/websiteIntegrationModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { logWebsiteActivity } = require('../../utils/website/activityLog');

// Website Management - tracking & verification integrations (singleton). Administrator-only
// (`integrations.manage`) for reading AND writing. Only ids are stored; the website build
// generates each provider's official snippet exactly once (no duplicates) and only on the PUBLIC
// site - never inside the dashboard. Validation is format-level: whether an id really belongs to
// the company's Google/Meta account can only be confirmed in that provider's own console (no
// provider API credentials are configured here) - the UI says so instead of faking a "connected".

const PROVIDERS = {
  ga4: { label: 'Google Analytics 4', rx: /^G-[A-Z0-9]{6,12}$/, example: 'G-ABC123XYZ9' },
  gtm: { label: 'Google Tag Manager', rx: /^GTM-[A-Z0-9]{4,10}$/, example: 'GTM-ABC1234' },
  metaPixel: { label: 'Meta Pixel', rx: /^\d{10,20}$/, example: '123456789012345' },
  googleAds: { label: 'Google Ads', rx: /^AW-\d{6,12}$/, example: 'AW-123456789' },
};
const VERIFICATION = {
  google: 'Google Search Console',
  bing: 'Bing Webmaster Tools',
  meta: 'Meta domain verification',
  yandex: 'Yandex Webmaster',
  pinterest: 'Pinterest',
};

/** Only the fields the dashboard needs - never the Conversions API cipher. */
function view(doc) {
  const d = doc || {};
  const out = { verification: {} };
  for (const key of Object.keys(PROVIDERS)) out[key] = { id: d[key]?.id || '', enabled: !!d[key]?.enabled };
  for (const key of Object.keys(VERIFICATION)) out.verification[key] = d.verification?.[key] || '';
  out.updatedAt = d.updatedAt || null;
  out.providers = Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, { label: v.label, example: v.example }]));
  out.verificationProviders = VERIFICATION;
  return out;
}

/** Accepts a bare token or a pasted `<meta name=... content="...">` tag. */
function verificationToken(raw, label) {
  if (raw === undefined) return undefined;
  let v = String(raw || '').trim();
  const m = v.match(/content\s*=\s*["']([^"']+)["']/i);
  if (m) v = m[1].trim();
  if (!v) return '';
  if (!/^[A-Za-z0-9_\-=.:+/]{6,160}$/.test(v)) throw new ApiError(`${label}: paste the verification code (or the whole <meta> tag) from the provider.`, 400);
  return v;
}

const getIntegrations = asyncHandler(async (req, res) => {
  const doc = await WebsiteIntegration.findById(WebsiteIntegration.SINGLETON_ID).lean();
  res.status(200).json(apiResponse('Integrations retrieved', true, view(doc)));
});

const updateIntegrations = asyncHandler(async (req, res) => {
  const body = req.body || {};
  let doc = await WebsiteIntegration.findById(WebsiteIntegration.SINGLETON_ID);
  if (!doc) doc = new WebsiteIntegration({ _id: WebsiteIntegration.SINGLETON_ID });
  const before = view(doc.toObject());

  for (const [key, p] of Object.entries(PROVIDERS)) {
    if (body[key] === undefined) continue;
    const input = body[key] || {};
    const id = String(input.id ?? doc[key]?.id ?? '').trim().toUpperCase();
    const enabled = input.enabled !== undefined ? !!input.enabled : !!doc[key]?.enabled;
    if (id && !p.rx.test(id)) throw new ApiError(`${p.label}: "${id}" is not a valid id (expected something like ${p.example}).`, 400);
    if (enabled && !id) throw new ApiError(`${p.label}: enter the id before enabling it.`, 400);
    doc[key] = { id, enabled };
  }
  if (body.verification !== undefined) {
    const v = body.verification || {};
    const current = doc.verification && typeof doc.verification.toObject === 'function' ? doc.verification.toObject() : doc.verification || {};
    const next = { ...current };
    for (const [key, label] of Object.entries(VERIFICATION)) {
      const token = verificationToken(v[key], label);
      if (token !== undefined) next[key] = token;
    }
    doc.verification = next;
  }
  doc.updatedBy = req.user._id;
  await doc.save();
  const after = view(doc.toObject());
  await logWebsiteActivity({ actor: req.user, action: 'integration.update', targetType: 'WebsiteIntegration', targetLabel: 'Integrations', before, after });
  res.status(200).json(apiResponse('Integrations saved. They reach the live website on the next update.', true, after));
});

/** Enabled integrations for the public feed (ids only). */
function publicIntegrations(doc) {
  const d = doc || {};
  const out = {};
  for (const [key, p] of Object.entries(PROVIDERS)) if (d[key]?.enabled && p.rx.test(d[key]?.id || '')) out[key] = d[key].id;
  out.verification = {};
  for (const key of Object.keys(VERIFICATION)) if (d.verification?.[key]) out.verification[key] = d.verification[key];
  return out;
}

module.exports = { getIntegrations, updateIntegrations, publicIntegrations, PROVIDERS };
