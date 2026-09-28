'use strict';

const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.resolve(__dirname, '../../settings.json');

const DEFAULTS = {
  backupTime: '02:00',
  timezone: 'Africa/Cairo',
  maxFiles: 10,
};

/**
 * Reads settings.json from disk.
 * Auto-creates the file with defaults if it does not exist.
 * @returns {{ backupTime: string, timezone: string, maxFiles: number }}
 */
function getSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf8');
    return { ...DEFAULTS };
  }

  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // Merge with defaults to handle missing keys after future upgrades
    return { ...DEFAULTS, ...parsed };
  } catch {
    // Corrupted file → reset to defaults
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf8');
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
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
}

module.exports = { getSettings, updateTime, SETTINGS_PATH };
