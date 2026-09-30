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
  contractValue: number;
  remainingMoney: number;
  projectManager: { _id: string; name: string; email?: string; role?: string };
  startDate: string;
  deliveryDate: string;
  sector?: ProjectSector | null;
  status: ProjectStatus;
  contract?: ProjectContract | null;
  createdBy?: { _id: string; name: string };
  createdAt: string;
  updatedAt: string;
}
