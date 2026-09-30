// Mirrors backend/server/utils/accountingConstants.js - kept as the single frontend source of
// truth for these lists so a new sector (or other accounting enum added later) is a one-line
// change here, not something scattered across every form/table that references it. Renamed from
// `ProjectDepartments` (the underlying Project field was renamed `department` -> `sector`) - the
// values themselves (Villa, Industrials) are unchanged.
export const ProjectSectors = ["Villa", "Industrials"] as const;

export type ProjectSector = (typeof ProjectSectors)[number];
