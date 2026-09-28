'use strict';

const { getSettings } = require('./backup.settings');
const { exportAllCollections } = require('./backup.exporter');
const { createTempDir, createArchive, removeSafe, applyRetentionPolicy } = require('./backup.storage');
const { notifyFailure } = require('./backup.notifier');

/**
 * Generates a safe timestamp string in Africa/Cairo timezone.
 * Format: YYYY-MM-DD_HH-mm-ss  (safe for Linux/Windows filenames)
 *
 * @returns {string}
 */
function _cairoStamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = type => parts.find(p => p.type === type)?.value ?? '00';

  return `${get('year')}-${get('month')}-${get('day')}_${get('hour')}-${get('minute')}-${get('second')}`;
}

/**
 * Runs the full backup flow:
 *  1. Read settings
 *  2. Create temp dir
 *  3. Export all collections to JSON files
 *  4. Compress to .tar.gz
 *  5. Remove temp dir
 *  6. Apply retention policy
 *  7. Return result summary
 *
 * On failure: cleans up temp/broken archive, logs, sends email, re-throws.
 *
 * @returns {Promise<{ archivePath: string, stamp: string, collections: Array }>}
 */
async function runBackup() {
  const settings = getSettings();
  const stamp = _cairoStamp();
  let tmpDir = null;
  let archivePath = null;

  console.log(`[Backup] Started export... (${stamp})`);

  try {
    // Step 1: create temp directory
    tmpDir = await createTempDir(stamp);

    // Step 2: export collections
    const collectionStats = await exportAllCollections(tmpDir);

    // Step 3: compress to .tar.gz
    archivePath = await createArchive(tmpDir, stamp);
    console.log(`[Backup] Archive created: ${archivePath}`);

    // Step 4: remove temp directory
    await removeSafe(tmpDir);
    tmpDir = null;

    // Step 5: retention cleanup
    await applyRetentionPolicy(settings.maxFiles);
    console.log(`[Backup] Cleanup complete. Keeping latest ${settings.maxFiles} archives.`);

    return { archivePath, stamp, collections: collectionStats };
  } catch (err) {
    console.error(`[Backup] Failed: ${err.message}`);

    // Clean up any broken temp dir or partial archive
    if (tmpDir) await removeSafe(tmpDir);
    if (archivePath) await removeSafe(archivePath);

    // Send SMTP failure notification
    await notifyFailure(err);

    throw err;
  }
}

module.exports = { runBackup };
