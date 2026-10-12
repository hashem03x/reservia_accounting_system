const { Schema, model } = require('mongoose');

// One record per backup file (server/backup/backup.service.js): a manual or scheduled backup, the
// recovery backup taken automatically before a restore, or a file an administrator uploaded to
// restore from. The file itself lives in the configured backup storage (GridFS in this database,
// or a server directory) - never in public / frontend storage. This collection is bookkeeping and is
// itself excluded from backups and from restores, so the history survives a restore.
//
// A backup is only ever `completed` after its file was fully written AND read back and verified
// (header, every collection's document count and SHA-256, every file's size and SHA-256, and the
// trailing manifest).
//
// scope: 'full' = the database AND the bytes of every stored file (attachments, Cloudinary documents,
// server-disk images); 'database' = database records only (plus the attachments kept inside the
// database) - every backup made before files were included (format version 1) is 'database';
// 'partial' = a recovery backup taken before a restore while some stored files were already
// unreadable (they are listed in fileFailures) - everything else, files included.
const backupSchema = new Schema(
  {
    kind: { type: String, enum: ['manual', 'scheduled', 'pre-restore', 'uploaded'], required: true },
    status: { type: String, enum: ['running', 'completed', 'failed', 'deleted'], default: 'running' },
    fileName: { type: String, required: true },
    storage: { type: String, enum: ['gridfs', 'filesystem'], required: true },
    scope: { type: String, enum: ['full', 'partial', 'database'], default: 'full' },
    // Where the file is: the GridFS file id, or the file name inside the backup directory.
    fileRef: { type: String, default: null },
    sizeBytes: { type: Number, default: 0 },
    sha256: { type: String, default: null },
    manifest: {
      format: String,
      formatVersion: Number,
      appVersion: String,
      createdAt: Date,
      totalDocuments: Number,
      databaseBytes: Number,
      collections: [{ _id: false, name: String, count: Number }],
    },
    // The files included, by storage (uncompressed bytes).
    files: {
      count: { type: Number, default: 0 },
      totalBytes: { type: Number, default: 0 },
      sources: {
        gridfs: { count: Number, bytes: Number },
        cloudinary: { count: Number, bytes: Number },
        local: { count: Number, bytes: Number },
      },
    },
    // Files that could not be read when this backup was attempted (why it failed).
    fileFailures: [{ _id: false, source: String, key: String, name: String, refs: [String], error: String }],
    verification: {
      ok: { type: Boolean, default: null },
      checkedAt: { type: Date, default: null },
      problems: [{ type: String }],
      files: { type: Number, default: null },
    },
    error: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

backupSchema.index({ status: 1, createdAt: -1 });
backupSchema.index({ kind: 1, createdAt: -1 });

module.exports = model('Backup', backupSchema);
