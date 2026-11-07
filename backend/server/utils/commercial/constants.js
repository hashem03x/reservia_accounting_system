// Reservia Commercial - shared enums, mirrors the convention in utils/crm/constants.js.

const CATEGORIES = ['On-Grid C&I', 'Off-Grid', 'Agriculture Pumping', 'Utility Scale', 'Street Lighting', 'Solar Water Heating'];
const SCOPES = ['Supply & Installation', 'Supply Only', 'Installation Only'];
// systemsRegistry.js's COMMERCIAL.roles - repeated here as a plain array for validators that
// can't import the registry's richer shape.
const ROLES = ['md', 'commercial_director', 'sales', 'technical', 'member'];
const APPROVAL_STAGES = ['STAGE1', 'STAGE2', 'MD'];
const APPROVAL_STATUSES = ['Pending', 'Approved', 'Rejected'];
const BOQ_LINE_SOURCES = ['auto', 'manual', 'override'];
const PROPOSAL_VALIDITY_DAYS = 14;

module.exports = { CATEGORIES, SCOPES, ROLES, APPROVAL_STAGES, APPROVAL_STATUSES, BOQ_LINE_SOURCES, PROPOSAL_VALIDITY_DAYS };
