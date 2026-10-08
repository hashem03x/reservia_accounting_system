// An admin-managed Project Sector (Admin -> Sectors). A Project stores the sector's NAME in
// `project.sector`; the backend's Sector collection decides which names are valid.
export interface Sector {
  _id: string;
  name: string;
  // Inactive sectors stay on the projects that use them but cannot be selected for a project.
  isActive: boolean;
  // How many projects currently use this sector (a sector in use cannot be deleted).
  projectsCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type SectorInput = { name?: string; isActive?: boolean };
