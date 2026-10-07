'use strict';

const path = require('path');
const fs = require('fs');
const { runBackup } = require('./backup.service');
const { reschedule } = require('./backup.scheduler');
const { getSettings } = require('./backup.settings');
const { listBackups, BACKUPS_DIR } = require('./backup.storage');

/**
 * POST /admin/backup/run
 * Triggers an immediate backup and waits for completion.
 */
const runNow = async (req, res) => {
  try {
    const result = await runBackup();

    return res.status(200).json({
      success: true,
      message: 'Backup completed successfully.',
      data: {
        archivePath: result.archivePath,
        stamp: result.stamp,
        collectionCount: result.collections.length,
        collections: result.collections,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: `Backup failed: ${err.message}`,
    });
  }
};

/**
 * POST /admin/backup/schedule
 * Body: { "time": "HH:mm" }
 * Updates the daily cron schedule and persists it to settings.json.
 */
const updateSchedule = (req, res) => {
  const { time } = req.body;

  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid time format. Expected HH:mm (e.g. "03:00").',
    });
  }

  const [hours, minutes] = time.split(':').map(Number);
  if (hours > 23 || minutes > 59) {
    return res.status(400).json({
      success: false,
      message: 'Time out of range. Hours must be 0-23 and minutes 0-59.',
    });
  }

  reschedule(time);

  return res.status(200).json({
    success: true,
    message: `Backup schedule updated to ${time} (Africa/Cairo).`,
    data: { backupTime: time },
  });
};

/**
 * GET /admin/backup/settings
 * Returns the current backup settings from settings.json.
 */
const getBackupSettings = (req, res) => {
  const settings = getSettings();
  return res.status(200).json({
    success: true,
    data: settings,
  });
};

/**
 * GET /admin/backup/files
 * Lists all stored backup archives, newest first.
 */
const getBackupFiles = async (req, res) => {
  try {
    const files = await listBackups();
    return res.status(200).json({
      success: true,
      count: files.length,
      data: files,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: `Could not list backups: ${err.message}`,
    });
  }
};

/**
 * GET /admin/backup/files/:filename
 * Streams a single .tar.gz archive as a file download.
 * Example: GET /api/v1/admin/backup/files/data-export-2026-05-12_07-32-00.tar.gz
 */
const downloadBackupFile = (req, res) => {
  const { filename } = req.params;

  // 1. Validate filename format — must match exactly what the system produces
  const VALID_FILENAME = /^data-export-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.tar\.gz$/;
  if (!VALID_FILENAME.test(filename)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid filename. Expected format: data-export-YYYY-MM-DD_HH-mm-ss.tar.gz',
    });
  }

  // 2. Resolve and guard against path traversal
  const filePath = path.resolve(BACKUPS_DIR, filename);
  if (!filePath.startsWith(path.resolve(BACKUPS_DIR) + path.sep)) {
    return res.status(400).json({ success: false, message: 'Invalid path.' });
  }

  // 3. Check the file actually exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      message: `Backup file not found: ${filename}`,
    });
  }

  // 4. Stream the file as a download
  return res.download(filePath, filename, err => {
    if (err && !res.headersSent) {
      return res.status(500).json({ success: false, message: 'Failed to stream file.' });
    }
  });
};

module.exports = { runNow, updateSchedule, getBackupSettings, getBackupFiles, downloadBackupFile };
