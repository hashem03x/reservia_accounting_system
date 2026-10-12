// An admin-managed Project Manager (Admin -> Project Managers). A Project references one by id
// (`project.projectManager`).
export interface ProjectManager {
  _id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  // Inactive project managers stay on the projects that have them but cannot be selected for a project.
  isActive: boolean;
  // How many projects have this project manager (one in use cannot be deleted).
  projectsCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type ProjectManagerInput = { name?: string; email?: string | null; phone?: string | null; isActive?: boolean };

// A manager projects still reference as a staff user, from before the Project Managers list existed.
export interface LegacyProjectManager {
  _id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  projectsCount: number;
  userFound: boolean;
}
