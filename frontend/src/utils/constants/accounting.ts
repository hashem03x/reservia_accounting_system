// Mirrors backend/server/utils/accountingConstants.js - kept as the single frontend source of
// truth for these lists so a new department (or other accounting enum added later) is a one-line
// change here, not something scattered across every form/table that references it.
export const ProjectDepartments = ["Villa", "Industrials"] as const;

export type ProjectDepartment = (typeof ProjectDepartments)[number];
