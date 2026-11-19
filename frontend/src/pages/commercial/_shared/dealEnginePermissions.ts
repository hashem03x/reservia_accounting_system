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

export const PROJECT_TAB_MATRIX: Record<string, MatrixRow> = {
  overview: { md: "edit", commercial_director: "edit", sales: "edit", technical: "view", procurement: "view", member: "view" },
  overviewPricing: { md: "edit", commercial_director: "edit", sales: "edit", technical: "hidden", procurement: "hidden", member: "hidden" },
  engineeringInputDesign: { md: "edit", commercial_director: "view", sales: "view", technical: "edit", procurement: "hidden", member: "hidden" },
  engineeringInputCustomer: { md: "edit", commercial_director: "view", sales: "edit", technical: "view", procurement: "hidden", member: "hidden" },
  designChecks: { md: "edit", commercial_director: "hidden", sales: "hidden", technical: "edit", procurement: "hidden", member: "hidden" },
  boqLines: { md: "edit", commercial_director: "hidden", sales: "hidden", technical: "edit", procurement: "view", member: "hidden" },
  boqCosts: { md: "edit", commercial_director: "hidden", sales: "hidden", technical: "view", procurement: "hidden", member: "hidden" },
  pricing: { md: "edit", commercial_director: "edit", sales: "limited", technical: "hidden", procurement: "hidden", member: "hidden" },
  feasibility: { md: "edit", commercial_director: "view", sales: "edit", technical: "hidden", procurement: "hidden", member: "hidden" },
  approvalsStage1: { md: "edit", commercial_director: "view", sales: "edit", technical: "edit", procurement: "hidden", member: "view" },
  approvalsStage2: { md: "edit", commercial_director: "edit", sales: "view", technical: "hidden", procurement: "hidden", member: "view" },
  proposal: { md: "edit", commercial_director: "edit", sales: "edit", technical: "hidden", procurement: "hidden", member: "hidden" },
};

export const ENGINE_PAGE_MATRIX: Record<string, MatrixRow> = {
  materials: { md: "edit", commercial_director: "view", sales: "view", technical: "view", procurement: "edit", member: "view" },
  suppliers: { md: "edit", commercial_director: "edit", sales: "view", technical: "view", procurement: "edit", member: "view" },
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
