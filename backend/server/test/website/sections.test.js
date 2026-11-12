const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Website Management - Sections controller (the Visual Editor's real data), exercised directly
// with a mock req/res (this repo's established convention). Covers the controlled section-type
// registry (utils/website/sectionTypes.js) actually being enforced, drag-and-drop reorder
// (one bulkWrite, rejects a mismatched order list), and duplicate's sortOrder shifting.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_website_sections';

let WebsitePage, WebsiteSection, WebsiteActivityLog, User;
let sectionController;
let page, user;
let seq = 0;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  WebsitePage = require('../../models/website/websitePageModel');
  WebsiteSection = require('../../models/website/websiteSectionModel');
  WebsiteActivityLog = require('../../models/website/websiteActivityLogModel');
  User = require('../../models/userModel');
  sectionController = require('../../controller/website/sectionController');
  await Promise.all([WebsitePage.init(), WebsiteSection.init(), WebsiteActivityLog.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([WebsitePage.deleteMany({}), WebsiteSection.deleteMany({}), WebsiteActivityLog.deleteMany({}), User.deleteMany({})]);
  seq += 1;
  user = await User.create({ name: `Website Editor ${seq}`, email: `website-editor-${seq}-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  page = await WebsitePage.create({ slug: `page-${seq}-${Date.now()}`, path: '/test', createdBy: user._id });
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

test('createSection: rejects an unknown section type - the registry is a controlled list, not arbitrary', async () => {
  const { err } = await run(sectionController.createSection, { params: { pageId: page._id }, user, body: { type: 'not-a-real-type', content: {} } });
  assert.ok(err);
  assert.equal(err.statusCode, 400);
});

test('required fields: a NEW section may start empty, but saving an edit without them is rejected', async () => {
  // 'hero' requires headingEn - see utils/website/sectionTypes.js. Adding a section to fill in next
  // is allowed (the page builder adds it, then the editor fills it in); an incomplete section can
  // never be saved over a complete one, and publishing refuses incomplete sections
  // (test/website/cmsApi.test.js).
  const created = await run(sectionController.createSection, { params: { pageId: page._id }, user, body: { type: 'hero', content: { subheadingEn: 'no heading yet' } } });
  assert.equal(created.err, undefined);
  const { err } = await run(sectionController.updateSection, { params: { pageId: page._id, id: created.res.body.data._id }, user, body: { content: { subheadingEn: 'still no heading' } } });
  assert.ok(err);
  assert.equal(err.statusCode, 400);
  assert.match(err.message, /headingEn/);
});

test('createSection: rejects a text field over its maxLength', async () => {
  const { err } = await run(sectionController.createSection, { params: { pageId: page._id }, user, body: { type: 'hero', content: { headingEn: 'x'.repeat(200) } } });
  assert.ok(err);
  assert.equal(err.statusCode, 400);
  assert.match(err.message, /exceeds/);
});

test('createSection: a valid section is created, appended at the end (sortOrder), and logged', async () => {
  const { res, err } = await run(sectionController.createSection, { params: { pageId: page._id }, user, body: { type: 'hero', content: { headingEn: 'Welcome', headingAr: 'أهلا' } } });
  assert.equal(err, undefined);
  assert.equal(res.body.data.sortOrder, 0);
  const second = await run(sectionController.createSection, { params: { pageId: page._id }, user, body: { type: 'about', content: { headingEn: 'About', bodyEn: 'Body text' } } });
  assert.equal(second.res.body.data.sortOrder, 1);
  const logs = await WebsiteActivityLog.find({ action: 'section.create' });
  assert.equal(logs.length, 2);
});

test('createSection: 404s for a page that does not exist', async () => {
  const { err } = await run(sectionController.createSection, { params: { pageId: new mongoose.Types.ObjectId() }, user, body: { type: 'hero', content: { headingEn: 'x' } } });
  assert.ok(err);
  assert.equal(err.statusCode, 404);
});

test('updateSection: re-validates content against the section\'s own type on every edit', async () => {
  const created = await WebsiteSection.create({ page: page._id, type: 'faq', sortOrder: 0, content: { items: [{ questionEn: 'Q', answerEn: 'A' }] }, createdBy: user._id });
  const { err } = await run(sectionController.updateSection, { params: { pageId: page._id, id: created._id }, user, body: { content: { items: 'not-an-array' } } });
  assert.ok(err);
  assert.equal(err.statusCode, 400);
});

test('updateSection: isVisible can be toggled without touching content (hide without deleting)', async () => {
  const created = await WebsiteSection.create({ page: page._id, type: 'hero', sortOrder: 0, content: { headingEn: 'x' }, createdBy: user._id });
  const { err } = await run(sectionController.updateSection, { params: { pageId: page._id, id: created._id }, user, body: { isVisible: false } });
  assert.equal(err, undefined);
  const updated = await WebsiteSection.findById(created._id);
  assert.equal(updated.isVisible, false);
  assert.equal(updated.content.headingEn, 'x', 'content is untouched');
});

test('reorderSections: applies the new order in one bulkWrite', async () => {
  const a = await WebsiteSection.create({ page: page._id, type: 'hero', sortOrder: 0, content: { headingEn: 'A' }, createdBy: user._id });
  const b = await WebsiteSection.create({ page: page._id, type: 'about', sortOrder: 1, content: { headingEn: 'B', bodyEn: 'b' }, createdBy: user._id });
  const c = await WebsiteSection.create({ page: page._id, type: 'cta', sortOrder: 2, content: { headingEn: 'C' }, createdBy: user._id });

  const { res, err } = await run(sectionController.reorderSections, { params: { pageId: page._id }, user, body: { order: [c._id, a._id, b._id] } });
  assert.equal(err, undefined);
  assert.deepEqual(res.body.data.map(s => String(s._id)), [String(c._id), String(a._id), String(b._id)]);
  assert.equal((await WebsiteSection.findById(c._id)).sortOrder, 0);
  assert.equal((await WebsiteSection.findById(a._id)).sortOrder, 1);
  assert.equal((await WebsiteSection.findById(b._id)).sortOrder, 2);
});

test('reorderSections: rejects a list that does not contain EXACTLY this page\'s own sections', async () => {
  const a = await WebsiteSection.create({ page: page._id, type: 'hero', sortOrder: 0, content: { headingEn: 'A' }, createdBy: user._id });
  await WebsiteSection.create({ page: page._id, type: 'about', sortOrder: 1, content: { headingEn: 'B', bodyEn: 'b' }, createdBy: user._id });

  // Missing the second section.
  const missing = await run(sectionController.reorderSections, { params: { pageId: page._id }, user, body: { order: [a._id] } });
  assert.ok(missing.err);
  assert.equal(missing.err.statusCode, 400);

  // A section from a DIFFERENT page must never be acceptable here.
  const otherPage = await WebsitePage.create({ slug: `other-${Date.now()}`, path: '/other', createdBy: user._id });
  const foreign = await WebsiteSection.create({ page: otherPage._id, type: 'hero', sortOrder: 0, content: { headingEn: 'X' }, createdBy: user._id });
  const wrongPage = await run(sectionController.reorderSections, { params: { pageId: page._id }, user, body: { order: [a._id, foreign._id] } });
  assert.ok(wrongPage.err);
  assert.equal(wrongPage.err.statusCode, 400);
});

test('duplicateSection: inserts the copy immediately after the original and shifts every later section down', async () => {
  const a = await WebsiteSection.create({ page: page._id, type: 'hero', sortOrder: 0, content: { headingEn: 'A' }, createdBy: user._id });
  const b = await WebsiteSection.create({ page: page._id, type: 'about', sortOrder: 1, content: { headingEn: 'B', bodyEn: 'b' }, createdBy: user._id });

  const { res, err } = await run(sectionController.duplicateSection, { params: { pageId: page._id, id: a._id }, user });
  assert.equal(err, undefined);
  assert.equal(res.body.data.sortOrder, 1);
  assert.equal(res.body.data.type, 'hero');
  assert.equal((await WebsiteSection.findById(b._id)).sortOrder, 2, 'the later section shifted down to make room');
});

test('deleteSection: removes exactly the targeted section, scoped to its own page', async () => {
  const a = await WebsiteSection.create({ page: page._id, type: 'hero', sortOrder: 0, content: { headingEn: 'A' }, createdBy: user._id });
  const otherPage = await WebsitePage.create({ slug: `other2-${Date.now()}`, path: '/other2', createdBy: user._id });
  const foreign = await WebsiteSection.create({ page: otherPage._id, type: 'hero', sortOrder: 0, content: { headingEn: 'X' }, createdBy: user._id });

  // Cannot delete a section through the wrong page's id.
  const wrongScope = await run(sectionController.deleteSection, { params: { pageId: otherPage._id, id: a._id }, user });
  assert.ok(wrongScope.err);
  assert.equal(wrongScope.err.statusCode, 404);

  const { err } = await run(sectionController.deleteSection, { params: { pageId: page._id, id: a._id }, user });
  assert.equal(err, undefined);
  assert.equal(await WebsiteSection.findById(a._id), null);
  assert.ok(await WebsiteSection.findById(foreign._id), 'the other page\'s section is untouched');
});
