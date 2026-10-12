'use strict';

const { Readable } = require('stream');
const cloudinary = require('cloudinary').v2;

// Reading and writing the files the application keeps on Cloudinary: customer and vendor business
// documents and project contracts (middleware/documentUploadMiddleware.js, `resource_type: 'raw'`).
// Used by the authenticated document downloads (so a file is served with its real name, type and
// extension) and by full backups / restores (server/backup/backup.files.js).
//
// Reading needs no credentials for a delivered (`upload`-type) asset - its stored URL is fetched;
// if that fails and CLOUDINARY_URL is set, a signed API download URL is tried. Writing (a restore
// putting a missing document back) needs CLOUDINARY_URL. Callers use `api.x()` so tests can stand
// in for the network calls.

const isConfigured = () => Boolean(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET));

async function fetchOk(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    // Drain so the connection is released.
    await res.arrayBuffer().catch(() => {});
    throw new Error(`HTTP ${res.status}`);
  }
  return res;
}

/** { stream, contentType, size } of a stored document. Rejects with the reason it cannot be read. */
async function openRead({ url, publicId, resourceType = 'raw' }) {
  let res;
  let firstError;
  if (url) {
    try {
      res = await fetchOk(url);
    } catch (err) {
      firstError = err;
    }
  }
  if (!res && publicId && isConfigured()) {
    try {
      res = await fetchOk(cloudinary.utils.private_download_url(publicId, '', { resource_type: resourceType, type: 'upload' }));
    } catch (err) {
      firstError = firstError || err;
    }
  }
  if (!res) throw new Error(`could not be downloaded from Cloudinary (${firstError ? firstError.message : 'no URL'})`);
  const length = Number(res.headers.get('content-length'));
  return { stream: Readable.fromWeb(res.body), contentType: res.headers.get('content-type') || null, size: Number.isFinite(length) && length > 0 ? length : null };
}

/** Uploads a stream as a new raw asset; resolves { url, publicId }. Never overwrites an existing asset. */
function upload(readable, { publicId, resourceType = 'raw' }) {
  if (!isConfigured()) return Promise.reject(new Error('CLOUDINARY_URL is not configured, so documents cannot be written to Cloudinary.'));
  return new Promise((resolve, reject) => {
    const out = cloudinary.uploader.upload_stream(
      { resource_type: resourceType, public_id: publicId, overwrite: false, unique_filename: false, use_filename: false },
      (err, result) => {
        if (err || !result) return reject(new Error(err?.message || 'Cloudinary upload failed.'));
        return resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    readable.on('error', err => out.destroy(err));
    readable.pipe(out);
  });
}

async function destroy(publicId, resourceType = 'raw') {
  if (!publicId || !isConfigured()) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

const api = { isConfigured, openRead, upload, destroy };
module.exports = api;
