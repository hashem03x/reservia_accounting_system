import { CommercialRole } from "@/types/commercial";

// Deal Engine Changes Required Rev 02 (19 Nov 2026), R2-R4/R13 - mirrors backend
// utils/commercial/dealEnginePermissions.js's PROJECT_TAB_MATRIX exactly (same rows, same access
// levels). The backend is the real security boundary (R12: hidden tabs return no data, refused
// writes return 403, checked again on every request from the DB-loaded role) - this module only
// decides what the UI shows, so a role never even sees a control the API would refuse anyway.
// Keep the two matrices in sync by hand; there is no shared package between the Node backend and
// the Vite frontend to import a single source of truth from.

export type AccessLevel = "hidden" | "view" | "limited" | "edit";
const LEVEL_RANK: Record<AccessLevel, number> = { hidden: 0, view: 1, limited: 2, edit: 3 };

type MatrixRow = Record<CommercialRole, AccessLevel>;

// Go-live Developer Pack section 5.4 (23 Nov 2026) reconciliation - mirrors backend
// utils/commercial/dealEnginePermissions.js's own header comment on every deliberate deviation
// from the Rev 02 values (sales moves down to view-only on Overview/Engineering Input/BOQ/
// Pricing; commercial_director gains BOQ edit access per F6; bdm/marketing added throughout).
export const PROJECT_TAB_MATRIX: Record<string, MatrixRow> = {
  overview: { md: "edit", commercial_director: "edit", sales: "view", technical: "view", procurement: "view", member: "view", bdm: "edit", marketing: "view" },
  overviewPricing: { md: "edit", commercial_director: "edit", sales: "view", technical: "hidden", procurement: "hidden", member: "hidden", bdm: "view", marketing: "hidden" },
  engineeringInputDesign: { md: "edit", commercial_director: "edit", sales: "view", technical: "edit", procurement: "hidden", member: "hidden", bdm: "edit", marketing: "hidden" },
  engineeringInputCustomer: { md: "edit", commercial_director: "edit", sales: "view", technical: "edit", procurement: "hidden", member: "hidden", bdm: "edit", marketing: "hidden" },
  designChecks: { md: "edit", commercial_director: "hidden", sales: "hidden", technical: "edit", procurement: "hidden", member: "hidden", bdm: "hidden", marketing: "hidden" },
  boqLines: { md: "edit", commercial_director: "edit", sales: "view", technical: "edit", procurement: "view", member: "hidden", bdm: "edit", marketing: "hidden" },
  boqCosts: { md: "edit", commercial_director: "edit", sales: "view", technical: "view", procurement: "hidden", member: "hidden", bdm: "edit", marketing: "hidden" },
  pricing: { md: "edit", commercial_director: "edit", sales: "view", technical: "hidden", procurement: "hidden", member: "hidden", bdm: "limited", marketing: "hidden" },
  feasibility: { md: "edit", commercial_director: "edit", sales: "view", technical: "hidden", procurement: "hidden", member: "hidden", bdm: "edit", marketing: "view" },
  approvalsStage1: { md: "edit", commercial_director: "view", sales: "edit", technical: "edit", procurement: "hidden", member: "view", bdm: "edit", marketing: "hidden" },
  approvalsStage2: { md: "edit", commercial_director: "edit", sales: "view", technical: "hidden", procurement: "hidden", member: "view", bdm: "view", marketing: "hidden" },
  proposal: { md: "edit", commercial_director: "edit", sales: "edit", technical: "hidden", procurement: "hidden", member: "hidden", bdm: "edit", marketing: "view" },
};

export const ENGINE_PAGE_MATRIX: Record<string, MatrixRow> = {
  materials: { md: "edit", commercial_director: "edit", sales: "view", technical: "view", procurement: "edit", member: "view", bdm: "view", marketing: "hidden" },
  suppliers: { md: "edit", commercial_director: "edit", sales: "view", technical: "view", procurement: "edit", member: "view", bdm: "edit", marketing: "hidden" },
};

/** R13: widest access across every Commercial role the user holds (today almost always just one). */
export function widestLevel(row: MatrixRow, roles: CommercialRole[] | null | undefined): AccessLevel {
  let best: AccessLevel = "hidden";
  for (const role of roles || []) {
    const level = row[role];
    if (level && LEVEL_RANK[level] > LEVEL_RANK[best]) best = level;
  }
  return best;
}

export function projectTabAccess(roles: CommercialRole[] | null | undefined, tab: keyof typeof PROJECT_TAB_MATRIX): AccessLevel {
  return widestLevel(PROJECT_TAB_MATRIX[tab], roles);
}

export function enginePageAccess(roles: CommercialRole[] | null | undefined, page: keyof typeof ENGINE_PAGE_MATRIX): AccessLevel {
  return widestLevel(ENGINE_PAGE_MATRIX[page], roles);
}

export const canView = (level: AccessLevel) => level !== "hidden";
export const canEditFully = (level: AccessLevel) => level === "edit";
