'use strict';

const express = require('express');
const authController = require('../controller/user/authController');
const c = require('./backup.controller');
const { CHUNK_MAX_BYTES } = require('./backup.service');

const router = express.Router();

// For an external scheduler (e.g. Vercel Cron) - authenticated by CRON_SECRET, not a user session.
router.get('/cron', c.cronBackup);

// Everything else: signed in and an administrator (enforced here, not only by the UI).
router.use(authController.protect);
router.use(authController.allowedTo('admin'));

router.post('/run', c.runNow); // a manual full backup (written, then verified)
router.get('/backups', c.getBackups); // history + last successful backup
router.get('/backups/:id/download', c.downloadBackup);
router.post('/backups/:id/verify', c.verifyBackup);
router.delete('/backups/:id', c.deleteBackup); // { confirm: "DELETE" }
router.post('/backups/:id/restore', c.restoreBackup); // { confirm: "RESTORE" }
router.get('/restores', c.getRestores);

// Upload a backup file to restore from, in chunks under the hosting request-size limit.
router.post('/uploads', c.startUpload); // { fileName, sizeBytes }
router.put('/uploads/:uploadId/chunks/:index', express.raw({ type: 'application/octet-stream', limit: Math.ceil(CHUNK_MAX_BYTES) + 1024 }), c.putChunk);
router.post('/uploads/:uploadId/complete', c.completeUpload);

// Daily automatic backup time, settings, and archives from the earlier backup version.
router.post('/schedule', c.updateSchedule); // { "time": "HH:mm" }
router.get('/settings', c.getBackupSettings);
router.get('/files', c.getBackupFiles);
router.get('/files/:filename', c.downloadBackupFile);

module.exports = router;
