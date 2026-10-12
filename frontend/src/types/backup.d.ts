// Admin -> Backup & Restore (backend: server/backup/*).
export type BackupKind = "manual" | "scheduled" | "pre-restore" | "uploaded";
export type BackupStatus = "running" | "completed" | "failed" | "deleted";

export interface BackupRecord {
  _id: string;
  kind: BackupKind;
  status: BackupStatus;
  fileName: string;
  storage: "gridfs" | "filesystem";
  sizeBytes: number;
  sha256?: string | null;
  manifest?: {
    format?: string;
    formatVersion?: number;
    appVersion?: string;
    createdAt?: string;
    totalDocuments?: number;
    collections?: { name: string; count: number }[];
  };
  verification?: { ok: boolean | null; checkedAt: string | null; problems: string[] };
  error?: string | null;
  createdBy?: { _id: string; name: string } | null;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
}

export interface RestoreRecord {
  _id: string;
  backup?: { _id: string; fileName: string; kind: BackupKind; createdAt: string } | null;
  recoveryBackup?: { _id: string; fileName: string; createdAt: string } | null;
  mode: "replace";
  status: "running" | "completed" | "failed" | "rolled_back";
  collections: number;
  documents: number;
  error?: string | null;
  startedBy?: { _id: string; name: string } | null;
  startedAt: string;
  completedAt?: string | null;
}

export interface BackupOverview {
  backups: BackupRecord[];
  lastSuccessfulAt: string | null;
  storage: "gridfs" | "filesystem";
  settings: { backupTime: string; timezone: string; maxFiles: number };
}
