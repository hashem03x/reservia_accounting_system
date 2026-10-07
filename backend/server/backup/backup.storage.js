'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const tar = require('tar');

const BACKUPS_DIR = path.resolve(__dirname, '../../backups');

/**
 * Ensures /backups directory exists.
 */
async function ensureBackupsDir() {
  await fsp.mkdir(BACKUPS_DIR, { recursive: true });
}

/**
 * Creates a uniquely named temp directory for the export.
 * @param {string} stamp - timestamp string used in the name
 * @returns {string} absolute path to the temp directory
 */
async function createTempDir(stamp) {
  const tmpDir = path.join(BACKUPS_DIR, `tmp-export-${stamp}`);
  await fsp.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

/**
 * Removes a path (file or directory) safely. Does not throw.
 * @param {string} targetPath
 */
async function removeSafe(targetPath) {
  try {
    await fsp.rm(targetPath, { recursive: true, force: true });
  } catch {
    // ignore – best effort cleanup
  }
}

/**
 * Creates a .tar.gz archive from the contents of srcDir.
 * @param {string} srcDir - directory to compress
 * @param {string} stamp  - timestamp string for the archive name
 * @returns {string} absolute path to the created .tar.gz file
 */
async function createArchive(srcDir, stamp) {
  await ensureBackupsDir();
  const archiveName = `data-export-${stamp}.tar.gz`;
  const archivePath = path.join(BACKUPS_DIR, archiveName);

  await tar.c(
    {
      gzip: true,
      file: archivePath,
      cwd: srcDir,
    },
    fs.readdirSync(srcDir),
  );

  return archivePath;
}

/**
 * Deletes old archives so only the newest `maxFiles` remain.
 * @param {number} maxFiles
 */
async function applyRetentionPolicy(maxFiles) {
  await ensureBackupsDir();

  const entries = await fsp.readdir(BACKUPS_DIR);
  const archives = entries
    .filter(f => f.startsWith('data-export-') && f.endsWith('.tar.gz'))
    .map(f => ({
      name: f,
      fullPath: path.join(BACKUPS_DIR, f),
      // Sort by filename (contains timestamp), newest last
      mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => a.mtime - b.mtime); // oldest first

  const toDelete = archives.slice(0, Math.max(0, archives.length - maxFiles));

  for (const file of toDelete) {
    await removeSafe(file.fullPath);
    console.log(`[Backup] Deleted old archive: ${file.name}`);
  }
}

/**
 * Lists all backup archives in /backups.
 * @returns {Array<{ name: string, size: number, createdAt: string }>}
 */
async function listBackups() {
  await ensureBackupsDir();

  const entries = await fsp.readdir(BACKUPS_DIR);
  const archives = entries
    .filter(f => f.startsWith('data-export-') && f.endsWith('.tar.gz'))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, f));
      return {
        name: f,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest first

  return archives;
}

module.exports = {
  ensureBackupsDir,
  createTempDir,
  removeSafe,
  createArchive,
  applyRetentionPolicy,
  listBackups,
  BACKUPS_DIR,
};
