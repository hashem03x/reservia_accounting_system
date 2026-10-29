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

// Activity timeline entry types (brief section 4D + the sample's own set).
const ACTIVITY_TYPES = ['note', 'call', 'email', 'survey', 'proposal', 'whatsapp_in', 'whatsapp_out', 'system'];

// Payment purpose/provider vocabulary (brief section F / the sample) - Phase 2 scaffolding.
const PAYMENT_PURPOSES = ['down_payment', 'milestone', 'final'];
const PAYMENT_PROVIDERS = ['fawry_ref', 'card', 'instapay', 'bank_transfer', 'cash'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'cancelled'];

const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'declined'];

module.exports = { STAGES, SEGMENTS, CHANNELS, LOST_REASONS, ACTIVITY_TYPES, PAYMENT_PURPOSES, PAYMENT_PROVIDERS, PAYMENT_STATUSES, QUOTATION_STATUSES };
