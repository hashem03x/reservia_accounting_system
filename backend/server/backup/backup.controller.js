'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/apiError');
const service = require('./backup.service');
const { reschedule } = require('./backup.scheduler');
const { getSettings } = require('./backup.settings');
const { listBackups: listLegacyArchives, BACKUPS_DIR } = require('./backup.storage');
const { mode: storageMode } = require('./backup.store');
const { setFileHeaders } = require('../utils/contentDisposition');

// Admin -> Backup & Restore (every route admin-only - see backup.routes.js). All rules live in
// backup.service.js.

// POST /admin/backup/run  { scope?: 'full' | 'database' } - a manual backup; responds once it is
// written AND verified. 'full' (default) includes every stored file; it fails, naming the files, if
// any of them cannot be read.
const runNow = asyncHandler(async (req, res) => {
  const scope = req.body?.scope === 'database' ? 'database' : 'full';
  const backup = await service.createBackup({ kind: 'manual', scope, userId: req.user._id });
  res
    .status(201)
    .json({ success: true, message: scope === 'full' ? 'Full backup (data and files) completed and verified.' : 'Database backup completed and verified.', data: backup });
});

// GET /admin/backup/backups - history (newest first) and the last successful backup.
const getBackups = asyncHandler(async (req, res) => {
  const backups = await service.listBackups();
  const last = backups.find(b => b.status === 'completed' && b.kind !== 'uploaded') || null;
  const lastFull = backups.find(b => b.status === 'completed' && b.kind !== 'uploaded' && b.scope === 'full') || null;
  res
    .status(200)
    .json({
      success: true,
      data: { backups, lastSuccessfulAt: last ? last.completedAt : null, lastFullAt: lastFull ? lastFull.completedAt : null, storage: storageMode(), settings: getSettings() },
    });
});

// GET /admin/backup/backups/:id/download - streams the file (authenticated, admin-only).
const downloadBackup = asyncHandler(async (req, res) => {
  const { stream, fileName, sizeBytes } = await service.openDownload(req.params.id);
  setFileHeaders(res, { fileName, contentType: 'application/gzip', size: sizeBytes || undefined });
  stream.on('error', err => (res.headersSent ? res.destroy(err) : res.status(500).json({ success: false, message: 'Could not read the backup file.' })));
  stream.pipe(res);
});

// POST /admin/backup/backups/:id/verify - reads the file back and checks it.
const verifyBackup = asyncHandler(async (req, res) => {
  const result = await service.verify(req.params.id);
  res
    .status(200)
    .json({
      success: true,
      data: {
        ok: result.ok,
        problems: result.problems,
        scope: result.scope,
        files: result.files,
        manifest: result.manifest && { ...result.manifest, files: result.manifest.files && { ...result.manifest.files, list: undefined } },
      },
    });
});

// DELETE /admin/backup/backups/:id  { confirm: "DELETE" }
const deleteBackup = asyncHandler(async (req, res, next) => {
  if (req.body?.confirm !== 'DELETE') return next(new ApiError('Type DELETE to confirm deleting this backup.', 400));
  await service.deleteBackup(req.params.id, req.user._id);
  res.status(200).json({ success: true, message: 'Backup deleted.' });
});

// Uploading a backup to restore from: start -> chunks -> complete (verified preview).
const startUpload = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await service.startUpload({ fileName: req.body?.fileName, sizeBytes: req.body?.sizeBytes, userId: req.user._id }) });
});
const putChunk = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: await service.putChunk(req.params.uploadId, req.params.index, req.body) });
});
const completeUpload = asyncHandler(async (req, res) => {
  const { backup, verification } = await service.completeUpload(req.params.uploadId, req.user._id);
  res
    .status(verification.ok ? 201 : 422)
    .json({
      success: verification.ok,
      message: verification.ok ? 'Backup uploaded and verified.' : 'The uploaded file is not a valid backup.',
      data: { backup, verification: { ok: verification.ok, problems: verification.problems } },
    });
});

// POST /admin/backup/backups/:id/restore  { confirm: "RESTORE" } - replaces all business data.
const restoreBackup = asyncHandler(async (req, res) => {
  const log = await service.restoreBackup({ backupId: req.params.id, confirm: req.body?.confirm, userId: req.user._id });
  res.status(200).json({ success: true, message: 'Restore completed.', data: log });
});

const getRestores = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: await service.listRestores() });
});

// GET /admin/backup/cron - for a scheduler outside the app (e.g. Vercel Cron), authenticated with
// `Authorization: Bearer <CRON_SECRET>`. Disabled unless CRON_SECRET (16+ characters) is set.
const cronBackup = asyncHandler(async (req, res, next) => {
  const secret = process.env.CRON_SECRET || '';
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ok = secret.length >= 16 && given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return next(new ApiError('Not allowed.', 401));
  const backup = await service.runBackup();
  res.status(200).json({ success: true, data: { id: backup._id, fileName: backup.fileName, scope: backup.scope, fallbackFrom: backup.fallbackFrom || null } });
});

// POST /admin/backup/schedule  { "time": "HH:mm" } - the daily automatic backup time.
const updateSchedule = (req, res) => {
  const { time } = req.body;
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ success: false, message: 'Invalid time format. Expected HH:mm (e.g. "03:00").' });
  }
  const [hours, minutes] = time.split(':').map(Number);
  if (hours > 23 || minutes > 59) {
    return res.status(400).json({ success: false, message: 'Time out of range. Hours must be 0-23 and minutes 0-59.' });
  }
  reschedule(time);
  return res.status(200).json({ success: true, message: `Backup schedule updated to ${time} (Africa/Cairo).`, data: { backupTime: time } });
};

const getBackupSettings = (req, res) => res.status(200).json({ success: true, data: getSettings() });

// Archives written by the earlier backup version (tar.gz in the backups folder) - listed and
// downloadable; they are not restorable (no manifest or checksums).
const getBackupFiles = async (req, res) => {
  try {
    const files = await listLegacyArchives();
    return res.status(200).json({ success: true, count: files.length, data: files });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Could not list backups: ${err.message}` });
  }
};

const downloadBackupFile = (req, res) => {
  const { filename } = req.params;
  const VALID_FILENAME = /^data-export-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.tar\.gz$/;
  if (!VALID_FILENAME.test(filename)) {
    return res.status(400).json({ success: false, message: 'Invalid filename. Expected format: data-export-YYYY-MM-DD_HH-mm-ss.tar.gz' });
  }
  const filePath = path.resolve(BACKUPS_DIR, filename);
  if (!filePath.startsWith(path.resolve(BACKUPS_DIR) + path.sep)) return res.status(400).json({ success: false, message: 'Invalid path.' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: `Backup file not found: ${filename}` });
  return res.download(filePath, filename, err => {
    if (err && !res.headersSent) res.status(500).json({ success: false, message: 'Failed to stream file.' });
  });
};

module.exports = {
  runNow,
  getBackups,
  downloadBackup,
  verifyBackup,
  deleteBackup,
  startUpload,
  putChunk,
  completeUpload,
  restoreBackup,
  getRestores,
  cronBackup,
  updateSchedule,
  getBackupSettings,
  getBackupFiles,
  downloadBackupFile,
};
