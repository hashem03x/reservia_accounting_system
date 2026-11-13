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
  // Reservia HR Portal (HR Portal Developer Spec, 11 Nov 2026). Roles are the spec's section 2:
  // md (everything, approves payroll), hr (HR officer), manager (line manager - team time, never
  // pay), finance (register, journal, ERP post; no edits to people or time). See
  // middleware/hrAccess.js. Memberships stored while HR was a placeholder ('MEMBER') carry no
  // permission and must be re-granted with a real role.
  HR: {
    id: 'HR',
    name: 'HR',
    description: 'People, contracts, time, site visits, expenses, payroll and approvals.',
    implemented: true,
    roles: ['md', 'hr', 'manager', 'finance'],
    requireValidRole: true,
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
  // Reservia Commercial - engineering estimation, BOQ, pricing and quotation workflow for solar
  // projects (On-Grid, Off-Grid, Agriculture Pumping, Utility Scale, Street Lighting, Solar Water
  // Heaters). Roles mirror the two-stage-plus-MD commercial approval workflow: member (create/edit
  // projects, no approval rights), sales / technical (either can give the Stage 1 gross-profit
  // sign-off), commercial_director (Stage 2 allocations sign-off, opens only after Stage 1), md
  // (final sign-off, required when net price excl. VAT is above the configured threshold).
  // Deliberately NOT the ERP's role enum, same reasoning as CRM above.
  COMMERCIAL: {
    id: 'COMMERCIAL',
    // Shown to users as "Deal Engine" (client request, 12 Nov 2026). The id stays COMMERCIAL so every
    // existing membership, route and integration keeps working.
    name: 'Deal Engine',
    description: 'Solar deal design, BOQ pricing, customer feasibility, approvals, proposals and approved suppliers.',
    implemented: true,
    // 'procurement' (Deal Engine C18): maintains the approved supplier list and uploads supplier
    // price lists; the MD approves suppliers.
    roles: ['md', 'commercial_director', 'sales', 'technical', 'procurement', 'member'],
  },
  // Website Management (CMS for the public Reservia marketing site, Reservia_Website repo). Roles
  // are a simple content-authority ladder, not the ERP's resource:action matrix - see
  // middleware/websiteAccess.js's CAPABILITIES_BY_ROLE for exactly what each role can do. Same
  // "deliberately NOT the ERP's role enum" reasoning as CRM/COMMERCIAL above: admin (full control,
  // including publish/tracking/custom code - real site-wide and legal blast radius), editor
  // (draft content/media/SEO, cannot publish or touch tracking/custom code), viewer (read-only).
  WEBSITE: {
    id: 'WEBSITE',
    name: 'Website',
    description: "Access to the company website's content management dashboard.",
    implemented: true,
    roles: ['admin', 'editor', 'viewer'],
  },
};

// `role` is required on every membership entry at the schema level - callers supplying no role
// for a placeholder system should pass this.
exports.DEFAULT_PLACEHOLDER_ROLE = 'MEMBER';

// The role that OWNS each system - the one whose holders can use every function of it (CRM: MD-only
// targets, spend, archive, stage overrides, integration keys; Commercial: MD final sign-off).
// Single source of truth for (a) the "never remove the last owner" lock-out guard
// (controller/portal/platformAdminController.js) and (b) the platform-administrator rule of
// scripts/restoreSystemAccess.js. Only systems with a real role vocabulary have one.
exports.SYSTEM_OWNER_ROLES = { CRM: 'md', COMMERCIAL: 'md', HR: 'md' };

// Historical placeholder role stored while a system was still `implemented: false` with roles
// ['MEMBER'] (CRM until 29 Oct 2026, Commercial until 7 Nov 2026, Website until 8 Nov 2026). It
// only ever meant "has a membership" - it carries NO permission level and is not the same thing as
// Commercial's lower-case 'member' role. Never mapped to a real role automatically.
exports.LEGACY_PLACEHOLDER_ROLE = 'MEMBER';

exports.isValidSystemId = id => exports.SYSTEM_IDS.includes(id);

exports.isValidRoleForSystem = (systemId, role) => {
  const system = exports.SYSTEMS[systemId];
  return !!system && system.roles.includes(role);
};
