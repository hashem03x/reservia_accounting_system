'use strict';

const cron = require('node-cron');
const { getSettings, updateTime } = require('./backup.settings');
const { runBackup } = require('./backup.service');

/** @type {cron.ScheduledTask | null} */
let _task = null;

/**
 * Converts "HH:mm" to a cron expression that runs daily at that time.
 * e.g. "03:00" → "0 3 * * *"
 *
 * @param {string} time - HH:mm
 * @returns {string} cron expression
 */
function _timeToCron(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return `${minutes} ${hours} * * *`;
}

/**
 * Destroys the currently scheduled task (if any).
 */
function _destroyCurrent() {
  if (_task) {
    _task.stop();
    _task = null;
  }
}

/**
 * Schedules (or re-schedules) the daily backup cron.
 *
 * @param {string} time     - HH:mm
 * @param {string} timezone - IANA timezone string
 */
function _schedule(time, timezone) {
  _destroyCurrent();

  const expression = _timeToCron(time);
  console.log(`[Backup] Scheduler set → "${expression}" (${timezone})`);

  _task = cron.schedule(
    expression,
    async () => {
      try {
        const result = await runBackup();
        console.log(`[Backup] Scheduled run complete → ${result.archivePath}`);
      } catch (err) {
        // runBackup already sends email & logs – nothing else to do here
      }
    },
    { timezone },
  );
}

/**
 * Initialises the scheduler on app boot.
 * Reads time + timezone from settings.json (auto-created with defaults if absent).
 */
function init() {
  const { backupTime, timezone } = getSettings();
  _schedule(backupTime, timezone);
}

/**
 * Changes the schedule to a new time, persists it in settings.json,
 * and immediately restarts the cron.
 *
 * @param {string} time - HH:mm format
 */
function reschedule(time) {
  updateTime(time);
  const { timezone } = getSettings();
  _schedule(time, timezone);
}

module.exports = { init, reschedule };
