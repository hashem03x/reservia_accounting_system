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
 *
 * Skipped entirely on Vercel (`process.env.VERCEL` is set automatically by the platform on every
 * deployment/runtime - not something this project needs to configure). Two independent reasons:
 *   1. A cron job scheduled in one serverless invocation does not persist - the process is not
 *      kept alive between requests the way a traditional server is, so `node-cron`'s in-memory
 *      timer would never actually fire a scheduled backup.
 *   2. `getSettings()` (backup.settings.js) auto-creates settings.json via `fs.writeFileSync` if
 *      it's missing - Vercel's deployed filesystem is read-only outside `/tmp`, so that write
 *      throws `EROFS`. Since this used to run unconditionally at module load (server.js), that
 *      throw crashed the ENTIRE function before Express could handle any request at all -
 *      this is the fix for that, not just a "disable the feature" shortcut.
 */
function init() {
  if (process.env.VERCEL) {
    console.log('[STARTUP] Backup scheduler: skipped (running on Vercel - cron/fs persistence is not supported in a serverless environment).');
    return;
  }
  const { backupTime, timezone } = getSettings();
  _schedule(backupTime, timezone);
  console.log('[STARTUP] Backup scheduler: initialized.');
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
