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
const CHANNELS = ['phone', 'walk_in', 'dealer', 'referral', 'event', 'outreach', 'email', 'whatsapp', 'web_form', 'landing_page'];

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

// Marketing source (acceptance report finding 4) - the fixed list a lead's "where did this come
// from" field offers GOING FORWARD. Deliberately NOT a hard Mongoose `enum:` on Lead.source (see
// leadModel.js's own comment) - existing leads carry whatever free text was typed before this
// list existed ("google ads", "Website", ...), and those must keep displaying correctly rather
// than fail validation on an unrelated future edit. Enforced as a fixed choice at the validator
// layer for new/edited leads instead (utils/validators/crm/leadValidators.js), with a normalizer
// (crmSourceNormalization.js) mapping incoming UTM values onto this list rather than discarding them.
const SOURCES = ['Google Ads', 'Meta Ads', 'Organic', 'Referral', 'WhatsApp Direct', 'Other'];

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

// Probability-of-close weight per OPEN stage (acceptance report finding 6: "Open pipeline total
// shows 1,500 EGP, ignores stage weights. Fix: weighted value"). Won/lost are deliberately absent
// - Won is already-realized revenue, not a forecast, and Lost contributes nothing; "weighted
// pipeline" only ever concerns the six open, still-uncertain stages.
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

module.exports = {
  STAGES,
  SEGMENTS,
  FORM_SEGMENTS,
  CHANNELS,
  SOURCES,
  GOVERNORATES,
  GOVERNORATE_NAMES_EN,
  LOST_REASONS,
  ACTIVITY_TYPES,
  PAYMENT_PURPOSES,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  QUOTATION_STATUSES,
  STAGE_WEIGHTS,
};
