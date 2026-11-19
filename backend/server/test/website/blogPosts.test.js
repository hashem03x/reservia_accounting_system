const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Website Management - Blog Posts controller, exercised directly with a mock req/res (this repo's
// established convention - see test/website/pages.test.js, whose structure this mirrors). Covers
// create/update/delete, the publish/revision/revert lifecycle (a publish snapshots the CURRENT
// draft into a WebsiteBlogPostRevision and the public feed reads ONLY that frozen snapshot, never
// the live draft directly), scheduling via the shared cron tick, and HTML sanitization on save.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_website_blog_posts';

let WebsiteBlogPost, WebsiteBlogPostRevision, WebsiteActivityLog, User;
let blogPostController, pageController, publicSiteController;
let seq = 0;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  WebsiteBlogPost = require('../../models/website/websiteBlogPostModel');
  WebsiteBlogPostRevision = require('../../models/website/websiteBlogPostRevisionModel');
  WebsiteActivityLog = require('../../models/website/websiteActivityLogModel');
  User = require('../../models/userModel');
  blogPostController = require('../../controller/website/blogPostController');
  pageController = require('../../controller/website/pageController');
  publicSiteController = require('../../controller/website/publicSiteController');
  await Promise.all([WebsiteBlogPost.init(), WebsiteBlogPostRevision.init(), WebsiteActivityLog.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([WebsiteBlogPost.deleteMany({}), WebsiteBlogPostRevision.deleteMany({}), WebsiteActivityLog.deleteMany({}), User.deleteMany({})]);
});

function mockRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

async function makeAdmin() {
  seq += 1;
  return User.create({ name: `Website Admin ${seq}`, email: `website-admin-${seq}-${Date.now()}@example.com`, role: 'admin', type: 'online' });
}

async function createBlogPost(user, overrides = {}) {
  const req = { user, body: { slug: `post-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...overrides } };
  const res = mockRes();
  let nextErr;
  await blogPostController.createBlogPost(req, res, err => { nextErr = err; });
  if (nextErr) throw nextErr;
  return res.body.data;
}

async function publish(user, postId, body = {}) {
  let nextErr;
  const res = mockRes();
  await blogPostController.publishBlogPost({ user, params: { id: postId }, body }, res, err => { nextErr = err; });
  if (nextErr) throw nextErr;
  return res.body.data;
}

async function publishError(user, postId) {
  let nextErr;
  await blogPostController.publishBlogPost({ user, params: { id: postId }, body: {} }, mockRes(), err => { nextErr = err; });
  return nextErr;
}

test('createBlogPost: creates a post and logs the activity', async () => {
  const user = await makeAdmin();
  const post = await createBlogPost(user, { slug: 'solar-energy-in-egypt', titleEn: 'Solar Energy in Egypt' });
  assert.equal(post.slug, 'solar-energy-in-egypt');
  assert.equal(post.status, 'never_published');
  const logs = await WebsiteActivityLog.find({ action: 'blogPost.create' });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].targetLabel, 'solar-energy-in-egypt');
});

test('createBlogPost: a duplicate slug is rejected with a clean 400, not a raw MongoServerError', async () => {
  const user = await makeAdmin();
  await createBlogPost(user, { slug: 'duplicate-post' });
  const req = { user, body: { slug: 'duplicate-post' } };
  let nextErr;
  await blogPostController.createBlogPost(req, mockRes(), err => { nextErr = err; });
  assert.ok(nextErr);
  assert.equal(nextErr.statusCode, 400);
  assert.match(nextErr.message, /already exists/);
});

test('createBlogPost: the body is sanitized on save - a <script> tag never reaches the database', async () => {
  const user = await makeAdmin();
  const post = await createBlogPost(user, { bodyEn: '<p>Hello</p><script>alert(1)</script><img src="javascript:alert(2)">' });
  assert.equal(post.bodyEn, '<p>Hello</p><img />');
  const stored = await WebsiteBlogPost.findById(post._id).lean();
  assert.equal(stored.bodyEn, '<p>Hello</p><img />');
});

test('publishBlogPost: refuses a post with no title+body in any of its languages', async () => {
  const user = await makeAdmin();
  const post = await createBlogPost(user);
  const nextErr = await publishError(user, post._id);
  assert.ok(nextErr);
  assert.equal(nextErr.statusCode, 400);
  assert.match(nextErr.message, /title and body/);
});

test('publishBlogPost: a title+body in only one locale is enough to publish', async () => {
  const user = await makeAdmin();
  const post = await createBlogPost(user, { titleEn: 'Benefits of Solar Energy', bodyEn: '<p>Solar panels pay for themselves.</p>' });
  const result = await publish(user, post._id);
  assert.equal(result.post.status, 'published');
  assert.ok(result.revision);
  assert.equal(result.revision.snapshot.titleEn, 'Benefits of Solar Energy');
});

test('publish -> public feed shows the PUBLISHED SNAPSHOT, not a later unpublished draft edit', async () => {
  const user = await makeAdmin();
  const post = await createBlogPost(user, { titleEn: 'Original Title', bodyEn: '<p>Original body.</p>', excerptEn: 'Original excerpt' });
  await publish(user, post._id);

  let feed = await publicSiteController.buildPublicFeed();
  assert.equal(feed.blogPosts.length, 1);
  assert.equal(feed.blogPosts[0].titleEn, 'Original Title');

  // Edit after publish - draft changes, never published.
  let nextErr;
  await blogPostController.updateBlogPost({ user, params: { id: post._id }, body: { titleEn: 'Edited Title (draft)' } }, mockRes(), err => { nextErr = err; });
  assert.equal(nextErr, undefined);

  feed = await publicSiteController.buildPublicFeed();
  assert.equal(feed.blogPosts.length, 1);
  assert.equal(feed.blogPosts[0].titleEn, 'Original Title', 'the feed must still show the published snapshot, not the draft edit');

  // Republish - now the feed catches up.
  await publish(user, post._id);
  feed = await publicSiteController.buildPublicFeed();
  assert.equal(feed.blogPosts[0].titleEn, 'Edited Title (draft)');
});

test('archiveBlogPost: a published post removed from the public feed once archived', async () => {
  const user = await makeAdmin();
  const post = await createBlogPost(user, { titleEn: 'To Be Archived', bodyEn: '<p>Body.</p>' });
  await publish(user, post._id);
  assert.equal((await publicSiteController.buildPublicFeed()).blogPosts.length, 1);

  let nextErr;
  await blogPostController.archiveBlogPost({ user, params: { id: post._id }, body: {} }, mockRes(), err => { nextErr = err; });
  assert.equal(nextErr, undefined);
  assert.equal((await publicSiteController.buildPublicFeed()).blogPosts.length, 0);
});

test('deleteBlogPost: soft-deactivates and removes it from the public feed', async () => {
  const user = await makeAdmin();
  const post = await createBlogPost(user, { titleEn: 'To Be Deleted', bodyEn: '<p>Body.</p>' });
  await publish(user, post._id);

  let nextErr;
  await blogPostController.deleteBlogPost({ user, params: { id: post._id } }, mockRes(), err => { nextErr = err; });
  assert.equal(nextErr, undefined);
  assert.equal((await publicSiteController.buildPublicFeed()).blogPosts.length, 0);
  const stored = await WebsiteBlogPost.findById(post._id).lean();
  assert.equal(stored.isActive, false, 'soft-deactivated, not hard-deleted - revision history is preserved');
});

test('revertBlogPostToRevision: restores an earlier revision and republishes it', async () => {
  const user = await makeAdmin();
  const post = await createBlogPost(user, { titleEn: 'Version 1', bodyEn: '<p>Version 1 body.</p>' });
  const first = await publish(user, post._id);

  let nextErr;
  await blogPostController.updateBlogPost({ user, params: { id: post._id }, body: { titleEn: 'Version 2', bodyEn: '<p>Version 2 body.</p>' } }, mockRes(), err => { nextErr = err; });
  assert.equal(nextErr, undefined);
  await publish(user, post._id);
  assert.equal((await publicSiteController.buildPublicFeed()).blogPosts[0].titleEn, 'Version 2');

  const res = mockRes();
  await blogPostController.revertBlogPostToRevision({ user, params: { id: post._id, revisionId: first.revision._id } }, res, err => { nextErr = err; });
  assert.equal(nextErr, undefined);
  assert.equal(res.body.data.post.titleEn, 'Version 1');
  assert.equal((await publicSiteController.buildPublicFeed()).blogPosts[0].titleEn, 'Version 1', 'reverted AND republished - live again, not just in the editor');
});

test('scheduled publish: runDueBlogSchedules applies a due schedule, via the shared pages cron tick', async () => {
  const user = await makeAdmin();
  const post = await createBlogPost(user, { titleEn: 'Scheduled Post', bodyEn: '<p>Body.</p>' });
  const when = new Date(Date.now() + 2 * 60 * 1000);

  let nextErr;
  const res = mockRes();
  await blogPostController.scheduleBlogPost({ user, params: { id: post._id }, body: { publishAt: when.toISOString() } }, res, err => { nextErr = err; });
  assert.equal(nextErr, undefined);
  assert.equal(res.body.data.post.status, 'never_published', 'not published yet - only scheduled');
  assert.equal((await publicSiteController.buildPublicFeed()).blogPosts.length, 0);

  const blogPublishing = require('../../services/website/blogPublishingService');
  const result = await blogPublishing.runDueBlogSchedules(new Date(when.getTime() + 1000));
  assert.deepEqual(result.published, [post.slug]);
  const feed = await publicSiteController.buildPublicFeed();
  assert.equal(feed.blogPosts.length, 1);
  assert.equal(feed.blogPosts[0].titleEn, 'Scheduled Post');
});

test('getBlogCategorySuggestions: returns distinct, previously-used categories matching the query', async () => {
  const user = await makeAdmin();
  await createBlogPost(user, { category: 'Solar Energy' });
  await createBlogPost(user, { category: 'Solar Energy' });
  await createBlogPost(user, { category: 'Agriculture' });
  const res = mockRes();
  await blogPostController.getBlogCategorySuggestions({ query: { q: 'sol' } }, res);
  assert.deepEqual(res.body.data, ['Solar Energy']);
});

test('runScheduledPublishes (pageController): the cron tick response reports blog posts too', async () => {
  const user = await makeAdmin();
  process.env.CRON_SECRET = 'test-cron-secret-123456789012345';
  const post = await createBlogPost(user, { titleEn: 'Cron Post', bodyEn: '<p>Body.</p>' });
  const soon = new Date(Date.now() + 1100);
  await blogPostController.scheduleBlogPost({ user, params: { id: post._id }, body: { publishAt: soon.toISOString() } }, mockRes(), () => {});
  await new Promise(r => setTimeout(r, 1200));

  const res = mockRes();
  let nextErr;
  await pageController.runScheduledPublishes({ get: () => `Bearer ${process.env.CRON_SECRET}` }, res, err => { nextErr = err; });
  assert.equal(nextErr, undefined);
  assert.ok(Array.isArray(res.body.data.blogPostsPublished));
  assert.ok(res.body.data.blogPostsPublished.includes(post.slug));
  delete process.env.CRON_SECRET;
});
