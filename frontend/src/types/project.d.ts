import type { ProjectSector } from "@/utils/constants/accounting";

export type ProjectStatus = "active" | "completed" | "cancelled" | "on_hold";

export interface ProjectContract {
  url: string;
  publicId: string;
  filename?: string;
  mimeType?: string;
  uploadedAt: string;
  uploadedBy?: { _id: string; name: string };
}

export interface Project {
  _id: string;
  projectNumber: string;
  name?: string;
  description?: string;
  // Required at the API/schema level for any project created through the current app - but marked
  // optional here on purpose: a project created before the projectAmount->contractValue /
  // executor->projectManager rename, and not yet run through
  // backend/server/scripts/migrateProjectFieldRenames.js, genuinely comes back from the API without
  // these fields (Mongoose only ever exposes schema-defined paths, so an old document's
  // still-present-in-MongoDB `projectAmount` simply isn't reachable as `contractValue`). Typing
  // these as required hid that reality and let `.toLocaleString()`/`.name` be called on `undefined`
  // - every read site must now handle the missing case explicitly (see projects/index.tsx and
  // projects/[id]/index.tsx for the pattern), which is what TypeScript's `strict` mode is for.
  contractValue?: number;
  remainingMoney?: number;
  projectManager?: { _id: string; name: string; email?: string; role?: string };
  startDate?: string;
  deliveryDate?: string;
  sector?: ProjectSector | null;
  status: ProjectStatus;
  contract?: ProjectContract | null;
  createdBy?: { _id: string; name: string };
  createdAt: string;
  updatedAt: string;
}
