const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

// Website Management - the public content feed (GET /website/public/site), site settings, and the
// website-pages seed script. The feed must only ever carry PUBLISHED snapshots: a draft edit, an
// unpublished page or a deleted page never reaches it.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_website_public';

let WebsitePage, WebsiteSection, WebsiteRevision, WebsiteSettings, WebsiteActivityLog, User;
let pageController, publicSiteController, settingsController, seedScript;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  WebsitePage = require('../../models/website/websitePageModel');
  WebsiteSection = require('../../models/website/websiteSectionModel');
  WebsiteRevision = require('../../models/website/websiteRevisionModel');
  WebsiteSettings = require('../../models/website/websiteSettingsModel');
  WebsiteActivityLog = require('../../models/website/websiteActivityLogModel');
  User = require('../../models/userModel');
  pageController = require('../../controller/website/pageController');
  publicSiteController = require('../../controller/website/publicSiteController');
  settingsController = require('../../controller/website/settingsController');
  seedScript = require('../../scripts/seedWebsitePages');
  await Promise.all([WebsitePage.init(), WebsiteSection.init(), WebsiteRevision.init(), WebsiteActivityLog.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([
    WebsitePage.deleteMany({}),
    WebsiteSection.deleteMany({}),
    WebsiteRevision.deleteMany({}),
    WebsiteSettings.deleteMany({}),
    WebsiteActivityLog.deleteMany({}),
    User.deleteMany({}),
  ]);
});

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const ok = err => { if (err) throw err; };

let seq = 0;
async function makeAdmin(websiteRole = 'admin') {
  seq += 1;
  return User.create({
    name: `Website Admin ${seq}`,
    email: `website-admin-${seq}-${Date.now()}@example.com`,
    role: 'admin',
    type: 'online',
    systemMemberships: [{ system: 'WEBSITE', role: websiteRole, isActive: true }],
  });
}

async function call(fn, req) {
  const res = mockRes();
  let nextErr;
  await fn(req, res, err => { nextErr = err; });
  if (nextErr) throw nextErr;
  return res;
}

async function createPage(user, body) {
  return (await call(pageController.createPage, { user, body })).body.data;
}
const publish = (user, id) => call(pageController.publishPage, { user, params: { id }, body: {} });
const feed = async () => (await call(publicSiteController.getPublicSite, { query: {} })).body.data;

const SEO = { titleEn: 'About Reservia', titleAr: 'عن ريزيرفيا', descriptionEn: 'Who we are and how we work.', descriptionAr: 'من نحن وكيف نعمل.' };

test('public feed: empty site -> no pages, Arabic default, schema version', async () => {
  const data = await feed();
  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(data.pages, []);
  assert.equal(data.settings.defaultLocale, 'ar');
});

test('public feed: only published pages appear, built from the PUBLISHED snapshot, never the draft', async () => {
  const user = await makeAdmin();
  await call(settingsController.updateSettings, { user, body: { publicSiteUrl: 'https://reservia-energy.com' } });
  const about = await createPage(user, { slug: 'about', path: '/about', seo: SEO });
  await createPage(user, { slug: 'draft-only', path: '/draft-only', seo: SEO });
  await publish(user, about._id);

  // Draft edit after publishing - must NOT be in the feed.
  await call(pageController.updatePage, { user, params: { id: about._id }, body: { seo: { titleAr: 'عنوان غير منشور' }, locales: ['ar'] } });

  const data = await feed();
  assert.deepEqual(data.pages.map(p => p.slug), ['about'], 'the never-published page is absent');
  const page = data.pages[0];
  assert.equal(page.seo.ar.title, 'عن ريزيرفيا');
  assert.deepEqual(page.locales, ['ar', 'en'], 'languages come from the snapshot too');
  assert.equal(page.seo.ar.canonical, 'https://reservia-energy.com/ar/about');
  assert.equal(page.seo.ar.alternates.find(a => a.hreflang === 'x-default').href, 'https://reservia-energy.com/ar/about');
  assert.equal(page.seo.ar.robots, 'index,follow');
});

test('public feed: unpublished and deleted pages disappear from it', async () => {
  const user = await makeAdmin();
  const a = await createPage(user, { slug: 'a', path: '/a', seo: SEO });
  const b = await createPage(user, { slug: 'b', path: '/b', seo: { ...SEO, titleEn: 'B', titleAr: 'ب' } });
  await publish(user, a._id);
  await publish(user, b._id);
  assert.equal((await feed()).pages.length, 2);

  await call(pageController.unpublishPage, { user, params: { id: a._id } });
  await call(pageController.deletePage, { user, params: { id: b._id } });
  assert.deepEqual((await feed()).pages, []);
});

test('public feed: exposes no staff data or raw draft fields', async () => {
  const user = await makeAdmin();
  const p = await createPage(user, { slug: 'about', path: '/about', seo: SEO });
  await WebsiteSection.create({ page: p._id, type: 'hero', sortOrder: 0, content: { headingEn: 'Hi', headingAr: 'أهلا' }, createdBy: user._id });
  await WebsiteSection.create({ page: p._id, type: 'cta', sortOrder: 1, isVisible: false, content: { headingEn: 'Hidden' }, createdBy: user._id });
  await publish(user, p._id);

  const data = await feed();
  const json = JSON.stringify(data);
  assert.ok(!json.includes(String(user._id)), 'no user ids');
  assert.ok(!json.includes(user.email), 'no staff emails');
  assert.ok(!json.includes('createdBy') && !json.includes('publishedBy'));
  assert.deepEqual(data.pages[0].sections.map(s => s.type), ['hero'], 'hidden sections are not published');
  assert.ok(!('contact' in data.settings), 'internal contact settings are not in the feed');
});

test('public feed: a legacy page carries no sections and leaves untyped fields to the website', async () => {
  const user = await makeAdmin();
  const p = await createPage(user, { slug: 'contact', path: '/contact', pageType: 'legacy', seo: { titleAr: 'تواصل معنا' } });
  await publish(user, p._id);
  const page = (await feed()).pages[0];
  assert.deepEqual(page.sections, []);
  assert.equal(page.seo.ar.title, 'تواصل معنا');
  assert.equal(page.seo.en.titleSource, 'website');
});

test('settings: partial updates merge, nested organization fields are kept', async () => {
  const user = await makeAdmin();
  await call(settingsController.updateSettings, { user, body: { siteNameAr: 'ريزيرفيا', organization: { legalName: 'Reservia Integrated Energy Solutions', addressCountry: 'EG' } } });
  await call(settingsController.updateSettings, { user, body: { organization: { addressLocality: 'Cairo' } } });
  const s = (await call(settingsController.getSettings, { user })).body.data;
  assert.equal(s.siteNameAr, 'ريزيرفيا');
  assert.equal(s.organization.legalName, 'Reservia Integrated Energy Solutions');
  assert.equal(s.organization.addressLocality, 'Cairo');
  assert.equal(s.defaultLocale, 'ar');
  assert.equal(await WebsiteActivityLog.countDocuments({ action: 'settings.update' }), 2);
});

async function runValidators(validators, body) {
  const req = { body };
  // The last entry is validatorMiddleware (it would send a response) - run only the checks.
  for (const v of validators.slice(0, -1)) await v.run(req);
  return validationResult(req).array().map(e => e.msg);
}

test('settings validators: https origin only, %s exactly once, default language must be enabled', async () => {
  const { updateSettingsValidators } = require('../../utils/validators/website/settingsValidators');
  assert.deepEqual(await runValidators(updateSettingsValidators, { publicSiteUrl: 'https://reservia-energy.com', titleTemplateEn: '%s | Reservia' }), []);
  assert.ok((await runValidators(updateSettingsValidators, { publicSiteUrl: 'http://reservia-energy.com' })).some(m => /https/.test(m)));
  assert.ok((await runValidators(updateSettingsValidators, { publicSiteUrl: 'https://reservia-energy.com/en' })).some(m => /no path/.test(m)));
  assert.ok((await runValidators(updateSettingsValidators, { titleTemplateEn: 'Reservia' })).some(m => /%s/.test(m)));
  assert.ok((await runValidators(updateSettingsValidators, { defaultLocale: 'ar', enabledLocales: ['en'] })).some(m => /default language/.test(m)));
});

test('page validators: paths, locales and SEO fields', async () => {
  const { updatePageValidators } = require('../../utils/validators/website/pageValidators');
  assert.deepEqual(await runValidators(updatePageValidators, { path: '/oil-gas', locales: ['ar'], seo: { canonicalEn: '/services', twitterCard: 'summary' } }), []);
  assert.ok((await runValidators(updatePageValidators, { path: '/ar/about' })).some(m => /Leave out the language/.test(m)));
  assert.ok((await runValidators(updatePageValidators, { path: '/admin' })).some(m => /reserved/.test(m)));
  assert.ok((await runValidators(updatePageValidators, { path: '/About Us' })).length > 0);
  assert.ok((await runValidators(updatePageValidators, { locales: [] })).length > 0);
  assert.ok((await runValidators(updatePageValidators, { locales: ['fr'] })).length > 0);
  assert.ok((await runValidators(updatePageValidators, { seo: { canonicalEn: '//evil.example.com' } })).length > 0);
  assert.ok((await runValidators(updatePageValidators, { seo: { canonicalEn: 'javascript:alert(1)' } })).length > 0);
  assert.ok((await runValidators(updatePageValidators, { seo: { titleAr: 'x'.repeat(71) } })).some(m => /at most 70/.test(m)));
  assert.ok((await runValidators(updatePageValidators, { seo: { unknownField: 'x' } })).some(m => /not a known SEO field/.test(m)));
});

test('seed script: dry run writes nothing; apply creates unpublished legacy pages; second run is a no-op', async () => {
  const admin = await makeAdmin();
  const logs = [];
  const log = m => logs.push(m);
  const dbName = mongoose.connection.db.databaseName;

  const dry = await seedScript.seedWebsitePages({ connect: false, argv: [], log });
  assert.equal(dry.applied, false);
  assert.equal(await WebsitePage.countDocuments(), 0);

  await assert.rejects(seedScript.seedWebsitePages({ connect: false, argv: ['--apply', `--actor-email=${admin.email}`], log }), /confirm-db/);

  // An existing page with an editor's SEO must be left exactly as it is.
  await createPage(admin, { slug: 'about-reservia', path: '/about', seo: SEO });

  const applied = await seedScript.seedWebsitePages({ connect: false, argv: ['--apply', `--actor-email=${admin.email}`, `--confirm-db=${dbName}`], log });
  assert.equal(applied.applied, true);
  assert.equal(applied.created.length, seedScript.WEBSITE_PAGES.length - 1);
  const about = await WebsitePage.findOne({ path: '/about' });
  assert.equal(about.slug, 'about-reservia');
  assert.equal(about.seo.titleAr, 'عن ريزيرفيا');
  const guide = await WebsitePage.findOne({ slug: 'solar-irrigation-guide' });
  assert.deepEqual([...guide.locales], ['ar']);
  assert.equal(guide.pageType, 'legacy');
  assert.equal(guide.status, 'never_published');
  assert.equal((await WebsitePage.findOne({ slug: 'lp-villas' })).seo.noindex, true);
  assert.deepEqual((await feed()).pages, [], 'nothing is published by the seed');

  const again = await seedScript.seedWebsitePages({ connect: false, argv: ['--apply', `--actor-email=${admin.email}`, `--confirm-db=${dbName}`], log });
  assert.equal(again.create.length, 0);
});

test('seed script: the actor must be an active Website admin', async () => {
  const editor = await makeAdmin('editor');
  const dbName = mongoose.connection.db.databaseName;
  await assert.rejects(
    seedScript.seedWebsitePages({ connect: false, argv: ['--apply', `--actor-email=${editor.email}`, `--confirm-db=${dbName}`], log: () => {} }),
    /not an active Website Management admin/,
  );
  assert.equal(await WebsitePage.countDocuments(), 0);
});
