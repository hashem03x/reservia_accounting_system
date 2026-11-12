// Reservia CRM - shared vocabulary (Developer Brief + the supplied reference sample). One source
// of truth so the Mongoose schemas, the express-validator chains, and the frontend's own copies
// (frontend/src/utils/constants/crm.ts) can never drift - mirrors this codebase's established
// convention for shared enums (e.g. utils/paymentTerms.js).

// Pipeline stages, in order - 'won'/'lost' are terminal (see utils/crm/stageRules.js).
const STAGES = ['new', 'contacted', 'qualified', 'site_survey', 'proposal_sent', 'negotiation', 'won', 'lost'];

// Customer segments (brief section 4B): "villas, compounds, farms, oil and gas, factories,
// services, other, and unknown".
const SEGMENTS = ['villa', 'compound', 'farm', 'oil_gas', 'factory', 'services', 'other', 'unknown'];

// Acquisition channel - how the enquiry physically arrived. Covers both the manual "New lead" form
// (phone/walk_in/dealer/referral/event/outreach/email/whatsapp) and the automated intake paths
// (web_form from the website's lead-capture endpoint, landing_page from a campaign page).
// 'ad_lead_form' (Change Request 2, items 9-11): an ad platform's own instant/lead form (Meta Lead
// Ads, TikTok Lead Generation, Google Ads lead form) - the platform itself is the lead's SOURCE.
const CHANNELS = ['phone', 'walk_in', 'dealer', 'referral', 'event', 'outreach', 'email', 'whatsapp', 'web_form', 'landing_page', 'ad_lead_form'];

// Change Request 2, item 6: the five acquisition "doors" the unified intake endpoint accepts
// (POST /api/v1/crm/integrations/:channel/leads), each with its own API key, mapped to the lead
// channel and the fixed SOURCES value it produces. `source: null` means "resolved per lead"
// (website -> UTM rules in sourceNormalization.js; whatsapp -> Ref code, else WhatsApp Direct).
const INTEGRATION_CHANNELS = {
  website: { leadChannel: 'web_form', source: null, label: 'Website form' },
  whatsapp: { leadChannel: 'whatsapp', source: null, label: 'WhatsApp' },
  meta: { leadChannel: 'ad_lead_form', source: 'Meta Ads', label: 'Meta Lead Ads' },
  tiktok: { leadChannel: 'ad_lead_form', source: 'TikTok', label: 'TikTok Lead Generation' },
  google_ads: { leadChannel: 'ad_lead_form', source: 'Google Ads', label: 'Google Ads lead form' },
};
const INTEGRATION_CHANNEL_IDS = Object.keys(INTEGRATION_CHANNELS);

// Change Request 2, item 3 - what counts as a first reply: the first move out of New, or the first
// logged call, WhatsApp message or email, whichever is EARLIEST. These are the only values
// Lead.firstReplyVia may hold (services/crm/firstReplyService.js).
const FIRST_REPLY_VIA = ['stage_change', 'call', 'whatsapp_out', 'email'];
// Activity types that count as a human reply. `whatsapp_in` (the customer's own message), `note`
// and `system` (automated) never do.
const FIRST_REPLY_ACTIVITY_TYPES = ['call', 'email', 'whatsapp_out'];

// Lost reasons (ported verbatim from the reference sample's LOST list).
const LOST_REASONS = [
  'Price',
  'Chose a competitor',
  'Payback too long',
  'No roof or land space',
  'Financing not available',
  'Not the decision maker',
  'No response',
  'Not a fit (too small)',
  'Project postponed',
  'Other',
];

// Marketing source (acceptance report finding 4; extended by Change Request 1 section 4: adds
// TikTok and splits Direct out of Organic) - the fixed list a lead's "where did this come from"
// field offers GOING FORWARD. Deliberately NOT a hard Mongoose `enum:` on Lead.source (see
// leadModel.js's own comment) - existing leads carry whatever free text was typed before this
// list existed ("google ads", "Website", ...), and those must keep displaying correctly rather
// than fail validation on an unrelated future edit. Enforced as a fixed choice at the validator
// layer for new/edited leads instead (utils/validators/crm/leadValidators.js), with a normalizer
// (sourceNormalization.js) mapping incoming UTM/referrer signals onto this list.
const SOURCES = ['Google Ads', 'Meta Ads', 'TikTok', 'Organic', 'Direct', 'Referral', 'WhatsApp Direct', 'Other'];

// The 27 official Egyptian governorates (acceptance report finding 4), English + Arabic. Same
// "fixed list for new data, free text never rejected outright on an old record" approach as
// SOURCES above - see leadModel.js.
const GOVERNORATES = [
  { en: 'Cairo', ar: 'القاهرة' },
  { en: 'Giza', ar: 'الجيزة' },
  { en: 'Alexandria', ar: 'الإسكندرية' },
  { en: 'Dakahlia', ar: 'الدقهلية' },
  { en: 'Red Sea', ar: 'البحر الأحمر' },
  { en: 'Beheira', ar: 'البحيرة' },
  { en: 'Fayoum', ar: 'الفيوم' },
  { en: 'Gharbia', ar: 'الغربية' },
  { en: 'Ismailia', ar: 'الإسماعيلية' },
  { en: 'Menoufia', ar: 'المنوفية' },
  { en: 'Minya', ar: 'المنيا' },
  { en: 'Qalyubia', ar: 'القليوبية' },
  { en: 'New Valley', ar: 'الوادي الجديد' },
  { en: 'Suez', ar: 'السويس' },
  { en: 'Aswan', ar: 'أسوان' },
  { en: 'Assiut', ar: 'أسيوط' },
  { en: 'Beni Suef', ar: 'بني سويف' },
  { en: 'Port Said', ar: 'بورسعيد' },
  { en: 'Damietta', ar: 'دمياط' },
  { en: 'Sharqia', ar: 'الشرقية' },
  { en: 'South Sinai', ar: 'جنوب سيناء' },
  { en: 'Kafr El Sheikh', ar: 'كفر الشيخ' },
  { en: 'Matrouh', ar: 'مطروح' },
  { en: 'Luxor', ar: 'الأقصر' },
  { en: 'Qena', ar: 'قنا' },
  { en: 'North Sinai', ar: 'شمال سيناء' },
  { en: 'Sohag', ar: 'سوهاج' },
];
const GOVERNORATE_NAMES_EN = GOVERNORATES.map(g => g.en);

// CRM Changes Required (12 Nov 2026), item 1: the website form's location is free text. It is
// matched to the official governorate (English or Arabic, any case/spacing, with or without a
// "Governorate" / "محافظة" word) so the Deal Engine can map it to a Rates region. Anything else
// returns null - the lead then has no governorate and is asked for one at Qualified.
const stripGovernorateWord = s =>
  String(s || '')
    .normalize('NFKC')
    .replace(/[\u064B-\u0652]/g, '') // Arabic diacritics
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\b(governorate|gov\.?)\b/gi, '')
    .replace(/محافظه|محافظة/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
const GOVERNORATE_KEYS = new Map();
for (const g of GOVERNORATES) {
  GOVERNORATE_KEYS.set(stripGovernorateWord(g.en), g.en);
  GOVERNORATE_KEYS.set(stripGovernorateWord(g.ar), g.en);
}
// Common English transliterations seen on forms (the official spelling above stays canonical).
const GOVERNORATE_SPELLINGS = {
  Sharqia: ['Sharkia', 'Sharkiya', 'Sharqiya', 'Al Sharqia'], Dakahlia: ['Dakahliya', 'Daqahlia', 'Dakhalia'], Qalyubia: ['Qaliubiya', 'Kalyoubia', 'Qalyoubia', 'Kaliobeya'],
  Beheira: ['Behira', 'Buhayrah', 'Behaira'], Menoufia: ['Menofia', 'Monufia', 'Minufiya'], Gharbia: ['Gharbiya', 'Garbia'], Ismailia: ['Ismailiya', 'Esmailia'],
  Assiut: ['Asyut', 'Assiout', 'Asiut'], Sohag: ['Suhag', 'Souhag'], Fayoum: ['Fayum', 'Faiyum', 'Fayyum'], 'Beni Suef': ['Bani Suef', 'Beni Sueif', 'Bani Swaif'],
  Damietta: ['Damiatta', 'Dumyat'], Matrouh: ['Matruh', 'Marsa Matrouh', 'Mersa Matruh'], Luxor: ['Louxor', 'Loxor'], Aswan: ['Asswan'],
  'Red Sea': ['Al Bahr Al Ahmar'], 'New Valley': ['Wadi El Gedid', 'El Wadi El Gedid'], 'Kafr El Sheikh': ['Kafr Elsheikh', 'Kafr Al Sheikh'], Cairo: ['Al Qahira', 'El Qahera'], Giza: ['Gizeh', 'El Giza'],
};
for (const [canonical, spellings] of Object.entries(GOVERNORATE_SPELLINGS)) {
  if (!GOVERNORATE_NAMES_EN.includes(canonical)) continue;
  for (const sp of spellings) GOVERNORATE_KEYS.set(stripGovernorateWord(sp), canonical);
}
function normalizeGovernorate(text) {
  const key = stripGovernorateWord(text);
  if (!key) return null;
  return GOVERNORATE_KEYS.get(key) || GOVERNORATE_KEYS.get(key.replace(/^al |^el |^ال/, '')) || null;
}

// Probability-of-close weight per OPEN stage (acceptance report finding 6: "Open pipeline total
// shows 1,500 EGP, ignores stage weights. Fix: weighted value"). Won/lost are deliberately absent
// - Won is already-realized revenue, not a forecast, and Lost contributes nothing; "weighted
// pipeline" only ever concerns the six open, still-uncertain stages.
//
// Change Request 2, item 4: this object is THE single source of truth for stage probabilities.
// The API returns it with every pipeline payload (`probability` per stage) so the Dashboard and the
// Pipeline board print the exact numbers used in the calculation - the frontend never keeps its
// own copy. services/crm/pipelineValuation.js refuses to silently treat a missing open-stage
// weight as 0 (see assertStageWeightsConfigured).
const STAGE_WEIGHTS = {
  new: 0.05,
  contacted: 0.1,
  qualified: 0.25,
  site_survey: 0.4,
  proposal_sent: 0.55,
  negotiation: 0.75,
};

// Activity timeline entry types (brief section 4D + the sample's own set).
const ACTIVITY_TYPES = ['note', 'call', 'email', 'survey', 'proposal', 'whatsapp_in', 'whatsapp_out', 'system'];

// Payment purpose/provider vocabulary (brief section F / the sample) - Phase 2 scaffolding.
const PAYMENT_PURPOSES = ['down_payment', 'milestone', 'final'];
const PAYMENT_PROVIDERS = ['fawry_ref', 'card', 'instapay', 'bank_transfer', 'cash'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'cancelled'];

const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'declined'];

// Segments offered on the lead FORM going forward (acceptance report finding 4: "seven segments").
// 'unknown' stays a valid, displayable value on SEGMENTS above (a lead nobody has classified yet
// still needs a safe default) but is never offered as something a person actively picks.
const FORM_SEGMENTS = SEGMENTS.filter(s => s !== 'unknown');

// Target dimension (Change Request 1, Feature 5A: "MD configures targets by Month, Segment").
// 'all' is itself a selectable value, not a fallback computed elsewhere - it is the single
// company-wide target the MD enters when a month isn't broken down per segment (exactly how the
// client's own initial Nov/Dec 2026 figures were given: "All segments: Enquiries 24..."). A
// specific segment's own target (when the MD later chooses to set one) is a SEPARATE record, never
// summed into or compared against the 'all' record.
const TARGET_SEGMENTS = ['all', ...FORM_SEGMENTS];

module.exports = {
  STAGES,
  SEGMENTS,
  FORM_SEGMENTS,
  TARGET_SEGMENTS,
  CHANNELS,
  SOURCES,
  GOVERNORATES,
  GOVERNORATE_NAMES_EN,
  normalizeGovernorate,
  LOST_REASONS,
  ACTIVITY_TYPES,
  PAYMENT_PURPOSES,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  QUOTATION_STATUSES,
  STAGE_WEIGHTS,
  INTEGRATION_CHANNELS,
  INTEGRATION_CHANNEL_IDS,
  FIRST_REPLY_VIA,
  FIRST_REPLY_ACTIVITY_TYPES,
};
