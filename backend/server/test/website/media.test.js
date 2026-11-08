const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Website Management - Media Library controller, exercised directly with a mock req/res. Covers
// the "remove from the library never hard-deletes" rule and the update/list/scoping behavior.
// Actual Cloudinary network calls are never exercised here (CLOUDINARY_URL is not configured in
// this test environment) - uploadImages is tested by constructing req.files the way multer's
// CloudinaryStorage would have left them (file.path/file.filename already populated), the exact
// same boundary test/documentUpload.test.js uses for the PDF upload pipeline.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_website_media';

let WebsiteMedia, WebsiteActivityLog, User;
let mediaController;
let user;
let seq = 0;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  WebsiteMedia = require('../../models/website/websiteMediaModel');
  WebsiteActivityLog = require('../../models/website/websiteActivityLogModel');
  User = require('../../models/userModel');
  mediaController = require('../../controller/website/mediaController');
  await Promise.all([WebsiteMedia.init(), WebsiteActivityLog.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([WebsiteMedia.deleteMany({}), WebsiteActivityLog.deleteMany({}), User.deleteMany({})]);
  seq += 1;
  user = await User.create({ name: `Website Media Manager ${seq}`, email: `website-media-${seq}-${Date.now()}@example.com`, role: 'admin', type: 'online' });
});

function mockRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
async function run(fn, req) {
  const res = mockRes();
  let nextErr;
  await fn(req, res, err => { nextErr = err; });
  return { res, err: nextErr };
}

function fakeUploadedFile(name) {
  // What multer-storage-cloudinary leaves on req.file/req.files after a real upload - .path is
  // the delivered Cloudinary URL, .filename is the public_id (see
  // middleware/websiteMediaUploadMiddleware.js).
  return { path: `https://res.cloudinary.com/demo/image/upload/website/media/${name}.jpg`, filename: `website/media/${name}`, mimetype: 'image/jpeg', size: 12345 };
}

test('uploadImages: rejects a request with no file at all', async () => {
  const { err } = await run(mediaController.uploadImages, { user, files: [], body: {} });
  assert.ok(err);
  assert.equal(err.statusCode, 400);
});

test('uploadImages: creates one WebsiteMedia document per uploaded file, in the given folder, and logs each one', async () => {
  const req = { user, files: [fakeUploadedFile('a'), fakeUploadedFile('b')], body: { folder: 'hero', altEn: 'Hero banner' } };
  const { res, err } = await run(mediaController.uploadImages, req);
  assert.equal(err, undefined);
  assert.equal(res.body.data.length, 2);
  assert.equal(res.body.data[0].folder, 'hero');
  assert.equal(res.body.data[0].altEn, 'Hero banner');
  assert.equal(await WebsiteMedia.countDocuments(), 2);
  assert.equal(await WebsiteActivityLog.countDocuments({ action: 'media.upload' }), 2);
});

test('getMedia: only lists active media, newest first, optionally filtered by folder', async () => {
  const a = await WebsiteMedia.create({ url: 'u1', publicId: 'p1', folder: 'hero', uploadedBy: user._id });
  await new Promise(r => setTimeout(r, 5));
  const b = await WebsiteMedia.create({ url: 'u2', publicId: 'p2', folder: 'partners', uploadedBy: user._id });
  await WebsiteMedia.create({ url: 'u3', publicId: 'p3', folder: 'hero', uploadedBy: user._id, isActive: false });

  const all = await run(mediaController.getMedia, { query: {} });
  assert.equal(all.res.body.data.length, 2);
  assert.equal(String(all.res.body.data[0]._id), String(b._id), 'newest first');

  const heroOnly = await run(mediaController.getMedia, { query: { folder: 'hero' } });
  assert.equal(heroOnly.res.body.data.length, 1);
  assert.equal(String(heroOnly.res.body.data[0]._id), String(a._id));
});

test('updateMedia: edits alt text/folder without touching the Cloudinary url/publicId', async () => {
  const media = await WebsiteMedia.create({ url: 'u1', publicId: 'p1', folder: 'general', uploadedBy: user._id });
  const { err } = await run(mediaController.updateMedia, { user, params: { id: media._id }, body: { altEn: 'New alt text', folder: 'projects' } });
  assert.equal(err, undefined);
  const updated = await WebsiteMedia.findById(media._id);
  assert.equal(updated.altEn, 'New alt text');
  assert.equal(updated.folder, 'projects');
  assert.equal(updated.url, 'u1');
  assert.equal(updated.publicId, 'p1');
});

test('deleteMedia: soft-removes from the library (isActive:false), never a hard delete - a section may still reference the URL', async () => {
  const media = await WebsiteMedia.create({ url: 'u1', publicId: 'p1', uploadedBy: user._id });
  const { err } = await run(mediaController.deleteMedia, { user, params: { id: media._id } });
  assert.equal(err, undefined);
  const stillExists = await WebsiteMedia.findById(media._id);
  assert.ok(stillExists);
  assert.equal(stillExists.isActive, false);
});

test('deleteMedia: 404s for a media id that does not exist', async () => {
  const { err } = await run(mediaController.deleteMedia, { user, params: { id: new mongoose.Types.ObjectId() } });
  assert.ok(err);
  assert.equal(err.statusCode, 404);
});
