// Admin -> Backup & Restore (backend: server/backup/*).
export type BackupKind = "manual" | "scheduled" | "pre-restore" | "uploaded";
export type BackupStatus = "running" | "completed" | "failed" | "deleted";
// full = the database AND every stored file; partial = a recovery backup taken while some files were
// already unreadable; database = records only (every backup from before files were included).
export type BackupScope = "full" | "partial" | "database";
type SourceStats = { count: number; bytes: number };

export interface BackupRecord {
  _id: string;
  kind: BackupKind;
  status: BackupStatus;
  fileName: string;
  storage: "gridfs" | "filesystem";
  scope?: BackupScope;
  sizeBytes: number;
  sha256?: string | null;
  manifest?: {
    format?: string;
    formatVersion?: number;
    appVersion?: string;
    createdAt?: string;
    totalDocuments?: number;
    databaseBytes?: number;
    collections?: { name: string; count: number }[];
  };
  files?: {
    count: number;
    totalBytes: number;
    sources?: { gridfs?: SourceStats; cloudinary?: SourceStats; local?: SourceStats };
  };
  fileFailures?: { source: string; key: string; name?: string; refs: string[]; error: string }[];
  verification?: { ok: boolean | null; checkedAt: string | null; problems: string[]; files?: number | null };
  error?: string | null;
  createdBy?: { _id: string; name: string } | null;
  startedAt: string;
  completedAt?: string | null;
  createdAt: string;
}

export interface RestoreRecord {
  _id: string;
  backup?: { _id: string; fileName: string; kind: BackupKind; scope?: BackupScope; createdAt: string } | null;
  recoveryBackup?: { _id: string; fileName: string; createdAt: string } | null;
  mode: "replace";
  status: "running" | "completed" | "failed" | "rolled_back";
  collections: number;
  documents: number;
  scope?: BackupScope;
  files?: {
    total: number;
    gridfs: number;
    cloudinaryRestored: number;
    cloudinaryUnchanged: number;
    localRestored: number;
    localUnchanged: number;
  };
  warnings?: string[];
  error?: string | null;
  startedBy?: { _id: string; name: string } | null;
  startedAt: string;
  completedAt?: string | null;
}

export interface BackupOverview {
  backups: BackupRecord[];
  lastSuccessfulAt: string | null;
  lastFullAt?: string | null;
  storage: "gridfs" | "filesystem";
  settings: { backupTime: string; timezone: string; maxFiles: number };
}
