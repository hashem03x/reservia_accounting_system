const { Schema, model } = require('mongoose');

// One record per backup file (server/backup/backup.service.js): a manual or scheduled backup, the
// recovery backup taken automatically before a restore, or a file an administrator uploaded to
// restore from. The file itself lives in the configured backup storage (GridFS in this database,
// or a server directory) - never in public / frontend storage. This collection is bookkeeping and is
// itself excluded from backups and from restores, so the history survives a restore.
//
// A backup is only ever `completed` after its file was fully written AND read back and verified
// (header, every collection's document count and SHA-256, and the trailing manifest).
const backupSchema = new Schema(
  {
    kind: { type: String, enum: ['manual', 'scheduled', 'pre-restore', 'uploaded'], required: true },
    status: { type: String, enum: ['running', 'completed', 'failed', 'deleted'], default: 'running' },
    fileName: { type: String, required: true },
    storage: { type: String, enum: ['gridfs', 'filesystem'], required: true },
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
      collections: [{ _id: false, name: String, count: Number }],
    },
    verification: {
      ok: { type: Boolean, default: null },
      checkedAt: { type: Date, default: null },
      problems: [{ type: String }],
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
