const { Schema, model } = require('mongoose');

// One record per restore attempt (server/backup/backup.service.js#restoreBackup): which backup was
// restored, the verified recovery backup taken of the data it replaced, who started it and when, and
// how it ended. A failed restore is rolled back to the data as it was; `rolled_back` says so.
const restoreLogSchema = new Schema(
  {
    backup: { type: Schema.Types.ObjectId, ref: 'Backup', required: true },
    recoveryBackup: { type: Schema.Types.ObjectId, ref: 'Backup', default: null },
    mode: { type: String, enum: ['replace'], default: 'replace' },
    status: { type: String, enum: ['running', 'completed', 'failed', 'rolled_back'], default: 'running' },
    collections: { type: Number, default: 0 },
    documents: { type: Number, default: 0 },
    scope: { type: String, enum: ['full', 'partial', 'database'], default: 'full' },
    // The stored files: restored = put back from the backup; unchanged = already in place with the
    // same content (checked by SHA-256), so not rewritten.
    files: {
      total: { type: Number, default: 0 },
      gridfs: { type: Number, default: 0 },
      cloudinaryRestored: { type: Number, default: 0 },
      cloudinaryUnchanged: { type: Number, default: 0 },
      localRestored: { type: Number, default: 0 },
      localUnchanged: { type: Number, default: 0 },
    },
    warnings: [{ type: String }],
    error: { type: String, default: null },
    startedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

restoreLogSchema.index({ createdAt: -1 });

module.exports = model('RestoreLog', restoreLogSchema);
