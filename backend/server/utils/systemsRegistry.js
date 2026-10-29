// Central Business Portal - single source of truth for the five ecosystem systems (docs section
// "Central Business Portal"). Both the `/me/systems` endpoint and the platform-admin mutation
// endpoints (routes/portal/platformAdminRoute.js) validate against THIS file, never a
// hand-rolled list, so the set of valid system ids/roles can never drift between "what a user can
// be granted" and "what the UI claims exists".
//
// Only ERP is a real, implemented system today. HR/CRM/COMMERCIAL/WEBSITE are registered so the
// portal can show them (per the task's own requirement that all five cards always render, and
// that unimplemented systems are never faked as working) but have no routes/dashboards/permission
// logic behind them yet - `implemented: false` is what the frontend uses to render their card as
// "Coming soon" regardless of membership state.
//
// `roles` for ERP mirrors the EXISTING ERP role enum (models/userModel.js's `role` field) exactly
// - this is a gate on top of that role, never a second role vocabulary. For the unimplemented
// systems, a single generic placeholder role is enough; there is no real permission model to
// enforce yet, so inventing a richer one now would be speculative.

exports.SYSTEM_IDS = ['ERP', 'HR', 'CRM', 'COMMERCIAL', 'WEBSITE'];

exports.SYSTEMS = {
  ERP: {
    id: 'ERP',
    name: 'ERP',
    description: 'Accounting, finance, procurement, projects, and enterprise operations.',
    implemented: true,
    roles: ['admin', 'moderator', 'operator'],
  },
  HR: {
    id: 'HR',
    name: 'HR',
    description: 'Employee records, attendance, leave, recruitment, and human resources workflows.',
    implemented: false,
    roles: ['MEMBER'],
  },
  // Reservia CRM (Developer Brief "Website, Amplitude and CRM") - lead-to-contract pipeline.
  // Roles are the brief's own four: md (Managing Director - the only role that can approve >EGP 1M
  // contracts, reopen a lost lead together with admin, and set targets), admin (admin officer -
  // reassigns leads, reopens lost leads), sales (sales engineer - the default working role), and
  // technical (technical engineer - restricted to moving a lead to Site survey or Proposal sent
  // only, per utils/crm/stageRules.js). Deliberately NOT the ERP's role enum - see this file's own
  // header comment on why the unimplemented systems never borrow ERP's vocabulary.
  CRM: {
    id: 'CRM',
    name: 'CRM',
    description: 'Customer relationships, leads, interactions, and customer lifecycle management.',
    implemented: true,
    roles: ['md', 'admin', 'sales', 'technical'],
  },
  COMMERCIAL: {
    id: 'COMMERCIAL',
    name: 'Commercial',
    description: 'Commercial activities, sales operations, proposals, and business development workflows.',
    implemented: false,
    roles: ['MEMBER'],
  },
  WEBSITE: {
    id: 'WEBSITE',
    name: 'Website',
    description: "Access to the company website's content management dashboard.",
    implemented: false,
    roles: ['MEMBER'],
  },
};

// `role` is required on every membership entry at the schema level - callers supplying no role
// for a placeholder system should pass this.
exports.DEFAULT_PLACEHOLDER_ROLE = 'MEMBER';

exports.isValidSystemId = id => exports.SYSTEM_IDS.includes(id);

exports.isValidRoleForSystem = (systemId, role) => {
  const system = exports.SYSTEMS[systemId];
  return !!system && system.roles.includes(role);
};
