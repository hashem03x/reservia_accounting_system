'use strict';

const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.resolve(__dirname, '../../settings.json');

const DEFAULTS = {
  backupTime: '02:00',
  timezone: 'Africa/Cairo',
  maxFiles: 10,
};

// Best-effort persistence: on a read-only filesystem (Vercel, outside /tmp) this logs and returns
// false instead of throwing - the backup feature's write-through settings cache degrading to
// in-memory-only defaults is an acceptable, visible limitation; an uncaught EROFS crashing the
// whole request (or, when called from the scheduler's module-scope init(), the whole function) is
// not. See backup.scheduler.js's init() for the module-load-time crash this was actually causing.
function _tryWrite(data) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`[Backup] Could not persist settings.json (${err.code || err.name}) - continuing with in-memory defaults.`);
    return false;
  }
}

/**
 * Reads settings.json from disk.
 * Auto-creates the file with defaults if it does not exist.
 * @returns {{ backupTime: string, timezone: string, maxFiles: number }}
 */
function getSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    _tryWrite(DEFAULTS);
    return { ...DEFAULTS };
  }

  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // Merge with defaults to handle missing keys after future upgrades
    return { ...DEFAULTS, ...parsed };
  } catch {
    // Corrupted file → reset to defaults
    _tryWrite(DEFAULTS);
    return { ...DEFAULTS };
  }
}

/**
 * Updates the backupTime field in settings.json.
 * @param {string} time - HH:mm format (e.g. "03:00")
 */
function updateTime(time) {
  const settings = getSettings();
  settings.backupTime = time;
  _tryWrite(settings);
}

module.exports = { getSettings, updateTime, SETTINGS_PATH };
