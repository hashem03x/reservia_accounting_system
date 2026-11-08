const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Website Management - Pages controller, exercised directly with a mock req/res (this repo's
// established convention for controller-level tests - see test/portal/portalApi.test.js). Covers
// create/update/duplicate/delete, and critically the publish/revision/revert lifecycle: a publish
// snapshots the CURRENT draft into a WebsiteRevision and the live site is meant to read ONLY from
// that frozen snapshot, never from the live (possibly newer) WebsiteSection docs directly.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_website_pages';

let WebsitePage, WebsiteSection, WebsiteRevision, WebsiteActivityLog, User;
let pageController;
let seq = 0;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  WebsitePage = require('../../models/website/websitePageModel');
  WebsiteSection = require('../../models/website/websiteSectionModel');
  WebsiteRevision = require('../../models/website/websiteRevisionModel');
  WebsiteActivityLog = require('../../models/website/websiteActivityLogModel');
  User = require('../../models/userModel');
  pageController = require('../../controller/website/pageController');
  await Promise.all([WebsitePage.init(), WebsiteSection.init(), WebsiteRevision.init(), WebsiteActivityLog.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([WebsitePage.deleteMany({}), WebsiteSection.deleteMany({}), WebsiteRevision.deleteMany({}), WebsiteActivityLog.deleteMany({}), User.deleteMany({})]);
});

function mockRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

async function makeAdmin() {
  seq += 1;
  return User.create({ name: `Website Admin ${seq}`, email: `website-admin-${seq}-${Date.now()}@example.com`, role: 'admin', type: 'online' });
}

async function createPage(user, overrides = {}) {
  const req = { user, body: { slug: `page-${Date.now()}-${Math.random().toString(36).slice(2)}`, path: '/test', ...overrides } };
  const res = mockRes();
  let nextErr;
  await pageController.createPage(req, res, err => { nextErr = err; });
  if (nextErr) throw nextErr;
  return res.body.data;
}

test('createPage: creates a page and logs the activity', async () => {
  const user = await makeAdmin();
  const page = await createPage(user, { slug: 'about-us', path: '/about' });
  assert.equal(page.slug, 'about-us');
  assert.equal(page.status, 'never_published');
  const logs = await WebsiteActivityLog.find({ action: 'page.create' });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].targetLabel, 'about-us');
});

test('createPage: a duplicate slug is rejected with a clean 400, not a raw MongoServerError', async () => {
  const user = await makeAdmin();
  await createPage(user, { slug: 'duplicate-slug', path: '/a' });
  const req = { user, body: { slug: 'duplicate-slug', path: '/b' } };
  const res = mockRes();
  let nextErr;
  await pageController.createPage(req, res, err => { nextErr = err; });
  assert.ok(nextErr);
  assert.equal(nextErr.statusCode, 400);
  assert.match(nextErr.message, /already exists/);
});

test('publishPage: refuses to publish without an English SEO title and description', async () => {
  const user = await makeAdmin();
  const page = await createPage(user);
  const req = { user, params: { id: page._id }, body: {} };
  const res = mockRes();
  let nextErr;
  await pageController.publishPage(req, res, err => { nextErr = err; });
  assert.ok(nextErr);
  assert.equal(nextErr.statusCode, 400);
  assert.match(nextErr.message, /SEO title and description/);
});

test('publishPage: snapshots the current sections+seo into a WebsiteRevision and flips status/publishedRevision', async () => {
  const user = await makeAdmin();
  const page = await createPage(user, { seo: { titleEn: 'About Reservia', descriptionEn: 'Learn about us.' } });
  await WebsiteSection.create({ page: page._id, type: 'hero', sortOrder: 0, content: { headingEn: 'Welcome', headingAr: 'أهلا' }, createdBy: user._id });

  const req = { user, params: { id: page._id }, body: { label: 'first release' } };
  const res = mockRes();
  let nextErr;
  await pageController.publishPage(req, res, err => { nextErr = err; });
  assert.equal(nextErr, undefined);
  assert.equal(res.statusCode, 200);

  const updated = await WebsitePage.findById(page._id);
  assert.equal(updated.status, 'published');
  assert.ok(updated.publishedRevision);

  const revision = await WebsiteRevision.findById(updated.publishedRevision);
  assert.equal(revision.label, 'first release');
  assert.equal(revision.snapshot.sections.length, 1);
  assert.equal(revision.snapshot.sections[0].content.headingEn, 'Welcome');
  assert.equal(revision.snapshot.seo.titleEn, 'About Reservia');

  const logs = await WebsiteActivityLog.find({ action: 'page.publish' });
  assert.equal(logs.length, 1);
});

test('publishPage: a draft edit AFTER publishing does not retroactively change the already-published revision snapshot', async () => {
  const user = await makeAdmin();
  const page = await createPage(user, { seo: { titleEn: 'T', descriptionEn: 'D' } });
  const section = await WebsiteSection.create({ page: page._id, type: 'hero', sortOrder: 0, content: { headingEn: 'Original' }, createdBy: user._id });

  await pageController.publishPage({ user, params: { id: page._id }, body: {} }, mockRes(), err => { if (err) throw err; });
  const firstRevisionId = (await WebsitePage.findById(page._id)).publishedRevision;

  // Edit the live draft section AFTER publishing - the frozen revision must stay exactly as it was.
  section.content = { headingEn: 'Edited after publish' };
  await section.save();

  const revision = await WebsiteRevision.findById(firstRevisionId);
  assert.equal(revision.snapshot.sections[0].content.headingEn, 'Original', 'the published snapshot never changes retroactively');
});

test('unpublishPage: refuses a page that was never published', async () => {
  const user = await makeAdmin();
  const page = await createPage(user);
  const req = { user, params: { id: page._id } };
  const res = mockRes();
  let nextErr;
  await pageController.unpublishPage(req, res, err => { nextErr = err; });
  assert.ok(nextErr);
  assert.equal(nextErr.statusCode, 400);
});

test('unpublishPage: a published page can be unpublished, keeping its publishedRevision as history', async () => {
  const user = await makeAdmin();
  const page = await createPage(user, { seo: { titleEn: 'T', descriptionEn: 'D' } });
  await pageController.publishPage({ user, params: { id: page._id }, body: {} }, mockRes(), err => { if (err) throw err; });

  const req = { user, params: { id: page._id } };
  const res = mockRes();
  let nextErr;
  await pageController.unpublishPage(req, res, err => { nextErr = err; });
  assert.equal(nextErr, undefined);
  const updated = await WebsitePage.findById(page._id);
  assert.equal(updated.status, 'unpublished');
  assert.ok(updated.publishedRevision, 'history is preserved, not erased');
});

test('revertPageToRevision: restores an earlier revision\'s sections onto the live page AND republishes it (test 13 - restored version is live again)', async () => {
  const user = await makeAdmin();
  const page = await createPage(user, { seo: { titleEn: 'T', descriptionEn: 'D' } });
  const section = await WebsiteSection.create({ page: page._id, type: 'hero', sortOrder: 0, content: { headingEn: 'Version A' }, createdBy: user._id });
  await pageController.publishPage({ user, params: { id: page._id }, body: {} }, mockRes(), err => { if (err) throw err; });
  const firstRevisionId = (await WebsitePage.findById(page._id)).publishedRevision;

  section.content = { headingEn: 'Version B' };
  await section.save();
  await pageController.publishPage({ user, params: { id: page._id }, body: {} }, mockRes(), err => { if (err) throw err; });
  assert.equal((await WebsiteSection.findById(section._id)).content.headingEn, 'Version B');

  const req = { user, params: { id: page._id, revisionId: firstRevisionId } };
  const res = mockRes();
  let nextErr;
  await pageController.revertPageToRevision(req, res, err => { nextErr = err; });
  assert.equal(nextErr, undefined);

  const sections = await WebsiteSection.find({ page: page._id });
  assert.equal(sections.length, 1);
  assert.equal(sections[0].content.headingEn, 'Version A', 'the OLD content is restored');

  const updated = await WebsitePage.findById(page._id);
  assert.equal(updated.status, 'published', 'the reverted version is republished, not just restored in the editor');
  assert.notEqual(String(updated.publishedRevision), String(firstRevisionId), 'a NEW revision is created, the old one is never mutated/reused');
});

test('deletePage: soft-deactivates (isActive:false), never a hard delete', async () => {
  const user = await makeAdmin();
  const page = await createPage(user);
  const req = { user, params: { id: page._id } };
  const res = mockRes();
  let nextErr;
  await pageController.deletePage(req, res, err => { nextErr = err; });
  assert.equal(nextErr, undefined);
  const stillExists = await WebsitePage.findById(page._id);
  assert.ok(stillExists, 'the document still exists in the database');
  assert.equal(stillExists.isActive, false);
});

test('deletePage: the home page cannot be deleted', async () => {
  const user = await makeAdmin();
  const page = await createPage(user, { isHomePage: true, slug: 'home' });
  const req = { user, params: { id: page._id } };
  const res = mockRes();
  let nextErr;
  await pageController.deletePage(req, res, err => { nextErr = err; });
  assert.ok(nextErr);
  assert.equal(nextErr.statusCode, 400);
});

test('duplicatePage: copies the page AND its sections as a fresh, unpublished draft', async () => {
  const user = await makeAdmin();
  const original = await createPage(user, { seo: { titleEn: 'Original Title', descriptionEn: 'D' } });
  await WebsiteSection.create({ page: original._id, type: 'hero', sortOrder: 0, content: { headingEn: 'Hi' }, createdBy: user._id });
  await pageController.publishPage({ user, params: { id: original._id }, body: {} }, mockRes(), err => { if (err) throw err; });

  const req = { user, params: { id: original._id }, body: { slug: 'original-copy', path: '/original-copy' } };
  const res = mockRes();
  let nextErr;
  await pageController.duplicatePage(req, res, err => { nextErr = err; });
  assert.equal(nextErr, undefined);

  const copy = res.body.data;
  assert.equal(copy.status, 'never_published', 'a duplicate never inherits the original\'s publish state');
  assert.equal(copy.publishedRevision, null);
  const copiedSections = await WebsiteSection.find({ page: copy._id });
  assert.equal(copiedSections.length, 1);
  assert.equal(copiedSections[0].content.headingEn, 'Hi');
});
