const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');

// Website CMS - HTTP-level tests through the REAL routers, the real authController.protect and
// the real websiteAccess capability gates (not mocked req/res): permissions are proven at the
// API boundary, exactly where a viewer/editor could try to bypass the dashboard. Covers the full
// publishing workflow (draft isolation, signed preview, publish, schedule, archive), navigation,
// integrations, custom code, media usage protection and the activity log.
//
// Needs a local MongoDB REPLICA SET (publishing uses transactions), e.g. TEST_DB_URI=
// mongodb://127.0.0.1:27017/reversia_test_website_cms?replicaSet=testset

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_website_cms';
process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || crypto.randomBytes(24).toString('hex');
process.env.CRON_SECRET = 'test-cron-secret-0123456789';
delete process.env.WEBSITE_PUBLISH_DEPLOY_HOOK_URL;
// Media files go to the dev-only local disk driver here (never Cloudinary, never MongoDB).
process.env.WEBSITE_MEDIA_DRIVER = 'local';

let server;
let base;
let User, WebsitePage, WebsiteMedia, WebsiteActivityLog;
const tokens = {};
const ids = {};

const BILINGUAL_SEO = { titleEn: 'Solar farms', descriptionEn: 'Solar pumping for farms in Egypt.', titleAr: 'مزارع شمسية', descriptionAr: 'طاقة شمسية للمزارع في مصر.' };

async function api(method, path, { as, body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json, headers: res.headers };
}

const feed = async () => (await api('GET', '/api/v1/website/public/site')).body.data;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  WebsitePage = require('../../models/website/websitePageModel');
  WebsiteMedia = require('../../models/website/websiteMediaModel');
  WebsiteActivityLog = require('../../models/website/websiteActivityLogModel');
  for (const m of ['websitePageModel', 'websiteSectionModel', 'websiteRevisionModel', 'websiteActivityLogModel', 'websiteMediaModel', 'websiteCustomCodeModel']) await require(`../../models/website/${m}`).init();

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/', express.static(require('path').join(__dirname, '../../../uploads'))); // as app.js serves stored media
  app.use('/api/v1/website/pages', require('../../routes/website/pageRoute'));
  app.use('/api/v1/website/media', require('../../routes/website/mediaRoute'));
  app.use('/api/v1/website/settings', require('../../routes/website/settingsRoute'));
  app.use('/api/v1/website', require('../../routes/website/siteRoute'));
  app.use('/api/v1/website/public', require('../../routes/website/publicSiteRoute'));
  app.use(require('../../middleware/errorMiddleware'));
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const mk = async (key, role) => {
    const u = await User.create({ name: `CMS ${key}`, email: `cms-${key}-${Date.now()}@example.com`, role: 'admin', type: 'online', systemMemberships: role ? [{ system: 'WEBSITE', role, isActive: true }] : [] });
    ids[key] = u._id;
    tokens[key] = jwt.sign({ userId: u._id }, process.env.JWT_SECRET_KEY, { expiresIn: '1h' });
  };
  await mk('admin', 'admin');
  await mk('editor', 'editor');
  await mk('viewer', 'viewer');
  await mk('outsider', null);
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  for (const m of ['websitePageModel', 'websiteSectionModel', 'websiteRevisionModel', 'websiteActivityLogModel', 'websiteMediaModel', 'websiteCustomCodeModel', 'websiteNavigationModel', 'websiteIntegrationModel', 'websiteSettingsModel']) {
    // eslint-disable-next-line no-await-in-loop
    await require(`../../models/website/${m}`).deleteMany({});
  }
});

async function newPage(as = 'admin', overrides = {}) {
  const slug = overrides.slug || `p-${crypto.randomBytes(4).toString('hex')}`;
  const r = await api('POST', '/api/v1/website/pages', { as, body: { slug, path: `/${slug}`, pageType: 'managed', titleEn: 'Farms', titleAr: 'المزارع', seo: BILINGUAL_SEO, ...overrides } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}
async function addHero(pageId, heading, as = 'admin') {
  const r = await api('POST', `/api/v1/website/pages/${pageId}/sections`, { as, body: { type: 'hero', content: { headingEn: heading, headingAr: 'عنوان' }, settings: { spacing: { top: 'lg', bottom: 'sm' }, devices: { desktop: true, tablet: true, mobile: false } } } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}

test('auth: no token is 401, a user without Website membership is 403', async () => {
  assert.equal((await api('GET', '/api/v1/website/pages')).status, 401);
  assert.equal((await api('GET', '/api/v1/website/pages', { as: 'outsider' })).status, 403);
  assert.equal((await api('GET', '/api/v1/website/overview', { as: 'outsider' })).status, 403);
});

test('workflow: draft stays private, signed preview shows it, publish puts it live, later edits stay draft', async () => {
  const page = await newPage();
  const hero = await addHero(page._id, 'Draft heading v1');

  // Draft is not public.
  let site = await feed();
  assert.equal(site.pages.find(p => p.slug === page.slug), undefined, 'an unpublished draft must not be in the public feed');

  // Signed preview renders the draft (and only with a valid token).
  const tok = await api('POST', `/api/v1/website/pages/${page._id}/preview-token`, { as: 'viewer', body: { lang: 'en' } });
  assert.equal(tok.status, 200);
  const preview = await api('GET', `/api/v1/website/public/preview/${encodeURIComponent(tok.body.data.token)}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('cache-control'), 'no-store, max-age=0');
  assert.match(preview.headers.get('x-robots-tag'), /noindex/);
  assert.equal(preview.body.data.page.sections[0].content.headingEn, 'Draft heading v1');
  assert.equal(preview.body.data.page.sections[0].settings.devices.mobile, false);
  const forged = `${tok.body.data.token.split('.')[0]}.AAAA${tok.body.data.token.split('.')[1].slice(4)}`;
  assert.equal((await api('GET', `/api/v1/website/public/preview/${encodeURIComponent(forged)}`)).status, 401, 'a tampered token is refused');
  const { createPreviewToken } = require('../../utils/website/previewToken');
  const expired = createPreviewToken(page._id, { now: Date.now() - 2 * 60 * 60 * 1000 }).token;
  assert.equal((await api('GET', `/api/v1/website/public/preview/${encodeURIComponent(expired)}`)).status, 401, 'an expired token is refused');

  // Editors cannot publish; admins can.
  assert.equal((await api('POST', `/api/v1/website/pages/${page._id}/publish`, { as: 'editor', body: {} })).status, 403);
  const pub = await api('POST', `/api/v1/website/pages/${page._id}/publish`, { as: 'admin', body: {} });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  site = await feed();
  const live = site.pages.find(p => p.slug === page.slug);
  assert.ok(live, 'published page is in the feed');
  assert.equal(live.titleEn, 'Farms');
  assert.equal(live.sections[0].content.headingEn, 'Draft heading v1');
  assert.equal(live.sections[0].settings.spacing.top, 'lg');

  // Editing after publishing changes the draft only.
  const upd = await api('PATCH', `/api/v1/website/pages/${page._id}/sections/${hero._id}`, { as: 'editor', body: { content: { headingEn: 'Draft heading v2', headingAr: 'عنوان' } } });
  assert.equal(upd.status, 200);
  site = await feed();
  assert.equal(site.pages.find(p => p.slug === page.slug).sections[0].content.headingEn, 'Draft heading v1', 'unpublished edits never leak into the live feed');
  const got = await api('GET', `/api/v1/website/pages/${page._id}`, { as: 'viewer' });
  assert.equal(got.body.data.hasPendingChanges, true);

  await api('POST', `/api/v1/website/pages/${page._id}/publish`, { as: 'admin', body: {} });
  site = await feed();
  assert.equal(site.pages.find(p => p.slug === page.slug).sections[0].content.headingEn, 'Draft heading v2');
});

test('permissions: viewer is read-only; editor cannot touch navigation, integrations, custom code or HTML sections', async () => {
  const page = await newPage();
  assert.equal((await api('GET', '/api/v1/website/pages', { as: 'viewer' })).status, 200);
  assert.equal((await api('POST', '/api/v1/website/pages', { as: 'viewer', body: { slug: 'nope', path: '/nope' } })).status, 403);
  assert.equal((await api('PATCH', `/api/v1/website/pages/${page._id}`, { as: 'viewer', body: { titleEn: 'x' } })).status, 403);
  assert.equal((await api('POST', `/api/v1/website/pages/${page._id}/sections`, { as: 'viewer', body: { type: 'text', content: { bodyEn: 'x' } } })).status, 403);
  assert.equal((await api('DELETE', `/api/v1/website/pages/${page._id}`, { as: 'viewer' })).status, 403);

  assert.equal((await api('PUT', '/api/v1/website/navigation', { as: 'editor', body: { headerEntries: [] } })).status, 403);
  assert.equal((await api('GET', '/api/v1/website/integrations', { as: 'editor' })).status, 403);
  assert.equal((await api('PUT', '/api/v1/website/integrations', { as: 'editor', body: { ga4: { id: 'G-ABCDEF123', enabled: true } } })).status, 403);
  assert.equal((await api('GET', '/api/v1/website/custom-code', { as: 'editor' })).status, 403);
  assert.equal((await api('POST', '/api/v1/website/custom-code', { as: 'editor', body: { name: 'x', kind: 'js', placement: 'body_end', code: 'console.log(1)' } })).status, 403);
  assert.equal((await api('PUT', '/api/v1/website/settings', { as: 'editor', body: { siteNameEn: 'x' } })).status, 403);
  assert.equal((await api('POST', '/api/v1/website/deploy', { as: 'editor' })).status, 403);
  const html = await api('POST', `/api/v1/website/pages/${page._id}/sections`, { as: 'editor', body: { type: 'customHtml', content: { html: '<b>x</b>' } } });
  assert.equal(html.status, 403, 'only code.manage may create HTML sections');
  const adminHtml = await api('POST', `/api/v1/website/pages/${page._id}/sections`, { as: 'admin', body: { type: 'customHtml', content: { html: '<b>x</b>' } } });
  assert.equal(adminHtml.status, 201);
  assert.equal((await api('PATCH', `/api/v1/website/pages/${page._id}/sections/${adminHtml.body.data._id}`, { as: 'editor', body: { isVisible: false } })).status, 403, 'nor edit them');
  // Section types are readable by everyone with access.
  const types = await api('GET', '/api/v1/website/section-types', { as: 'viewer' });
  assert.equal(types.status, 200);
  assert.ok(types.body.data.types.length >= 18);
});

test('publishing refuses a page with an incomplete (never filled in) section', async () => {
  const page = await newPage();
  await addHero(page._id, 'Complete');
  const empty = await api('POST', `/api/v1/website/pages/${page._id}/sections`, { as: 'editor', body: { type: 'faq', content: {} } });
  assert.equal(empty.status, 201, 'adding an empty section to fill in is allowed');
  const item = await api('PATCH', `/api/v1/website/pages/${page._id}/sections/${empty.body.data._id}`, { as: 'editor', body: { content: { items: [{ questionEn: 'Q?' }] } } });
  assert.equal(item.status, 400, 'an FAQ item without its required answer cannot be saved');
  await require('../../models/website/websiteSectionModel').updateOne({ _id: empty.body.data._id }, { $set: { type: 'hero', content: {} } });
  const pub = await api('POST', `/api/v1/website/pages/${page._id}/publish`, { as: 'admin', body: {} });
  assert.equal(pub.status, 400);
  assert.match(pub.body.message, /section 2/);
  assert.equal((await feed()).pages.length, 0);
});

test('validation: unsafe links and unknown types are rejected server-side', async () => {
  const page = await newPage();
  const bad = await api('POST', `/api/v1/website/pages/${page._id}/sections`, { as: 'editor', body: { type: 'cta', content: { headingEn: 'Go', ctaLabelEn: 'Click', ctaHref: 'javascript:alert(1)' } } });
  assert.equal(bad.status, 400);
  assert.equal((await api('POST', `/api/v1/website/pages/${page._id}/sections`, { as: 'editor', body: { type: 'iframeEverything', content: {} } })).status, 400);
});

test('scheduling: freezes the draft, the cron tick needs CRON_SECRET, applies it once', async () => {
  const page = await newPage();
  await addHero(page._id, 'Scheduled heading');
  const soon = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  assert.equal((await api('POST', `/api/v1/website/pages/${page._id}/schedule`, { as: 'editor', body: { publishAt: soon } })).status, 403);
  const s = await api('POST', `/api/v1/website/pages/${page._id}/schedule`, { as: 'admin', body: { publishAt: soon } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const listed = await api('GET', '/api/v1/website/pages?status=scheduled', { as: 'viewer' });
  assert.equal(listed.body.data.length, 1);
  assert.equal(listed.body.data[0].displayStatus, 'scheduled');

  assert.equal((await feed()).pages.length, 0, 'not live before its time');
  // Move the schedule into the past (as if the time had come).
  await WebsitePage.updateOne({ _id: page._id }, { $set: { scheduledPublishAt: new Date(Date.now() - 1000) } });
  assert.equal((await api('GET', '/api/v1/website/pages/cron/scheduled', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const tick = await api('GET', '/api/v1/website/pages/cron/scheduled', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  assert.equal(tick.status, 200);
  assert.deepEqual(tick.body.data.published, [page.slug]);
  const again = await api('GET', '/api/v1/website/pages/cron/scheduled', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  assert.deepEqual(again.body.data.published, [], 'applied exactly once');
  assert.equal((await feed()).pages[0].sections[0].content.headingEn, 'Scheduled heading');
});

test('navigation: validated on save; the public menus only link to published pages; archive removes the link', async () => {
  const live = await newPage('admin', { slug: 'live-page' });
  await addHero(live._id, 'Live');
  await api('POST', `/api/v1/website/pages/${live._id}/publish`, { as: 'admin', body: {} });
  await newPage('admin', { slug: 'draft-page' });

  assert.equal((await api('PUT', '/api/v1/website/navigation', { as: 'admin', body: { headerEntries: [{ type: 'link', labelEn: 'X', linkType: 'page', pageSlug: 'missing' }] } })).status, 400);
  assert.equal((await api('PUT', '/api/v1/website/navigation', { as: 'admin', body: { headerEntries: [{ type: 'link', labelEn: 'X', linkType: 'external', externalUrl: 'javascript:alert(1)' }] } })).status, 400);
  const saved = await api('PUT', '/api/v1/website/navigation', {
    as: 'admin',
    body: {
      headerEntries: [
        { type: 'link', labelEn: 'Live', labelAr: 'مباشر', linkType: 'page', pageSlug: 'live-page' },
        { type: 'link', labelEn: 'Draft', linkType: 'page', pageSlug: 'draft-page' },
        { type: 'group', labelEn: 'More', items: [{ type: 'link', labelEn: 'Docs', linkType: 'external', externalUrl: 'https://example.com', target: '_blank' }, { type: 'link', labelEn: 'Hidden', linkType: 'external', externalUrl: '/x', visible: false }] },
      ],
      footerColumns: [{ titleEn: 'Company', items: [{ labelEn: 'Live', linkType: 'page', pageSlug: 'live-page' }] }],
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.ok(saved.body.data.warnings.some(w => /draft-page/.test(w)), 'the editor is told the draft link is hidden');

  let nav = (await feed()).navigation;
  assert.deepEqual(nav.header.map(e => e.labelEn), ['Live', 'More']);
  assert.equal(nav.header[0].href, '/live-page');
  assert.deepEqual(nav.header[1].items.map(e => e.labelEn), ['Docs']);
  assert.equal(nav.header[1].items[0].target, '_blank');
  assert.equal(nav.footer[0].items[0].href, '/live-page');

  const arch = await api('POST', `/api/v1/website/pages/${live._id}/archive`, { as: 'admin' });
  assert.equal(arch.status, 200);
  const site = await feed();
  assert.equal(site.pages.length, 0, 'archived page left the site');
  nav = site.navigation;
  assert.deepEqual(nav.header.map(e => e.labelEn), ['More'], 'and its menu link left with it');
  assert.equal(nav.footer.length, 0, 'an emptied footer column is dropped');

  const restored = await api('POST', `/api/v1/website/pages/${live._id}/restore`, { as: 'admin' });
  assert.equal(restored.body.data.page.status, 'unpublished', 'restore brings it back as a draft, not live');
});

test('integrations: id formats are validated; only enabled ones reach the feed; verification tags are parsed', async () => {
  assert.equal((await api('PUT', '/api/v1/website/integrations', { as: 'admin', body: { ga4: { id: 'UA-1234-1', enabled: true } } })).status, 400);
  assert.equal((await api('PUT', '/api/v1/website/integrations', { as: 'admin', body: { gtm: { id: '', enabled: true } } })).status, 400);
  const ok = await api('PUT', '/api/v1/website/integrations', { as: 'admin', body: { ga4: { id: 'g-abc123xyz9', enabled: true }, metaPixel: { id: '123456789012345', enabled: false }, verification: { google: '<meta name="google-site-verification" content="abcDEF123_-xyz" />' } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.ga4.id, 'G-ABC123XYZ9');
  const { integrations } = await feed();
  assert.equal(integrations.ga4, 'G-ABC123XYZ9');
  assert.equal(integrations.metaPixel, undefined, 'a disabled provider is not injected');
  assert.equal(integrations.verification.google, 'abcDEF123_-xyz');
});

test('custom code: syntax-checked without running, audited, only enabled snippets for published pages reach the feed', async () => {
  globalThis.__cmsSideEffect = false;
  const bad = await api('POST', '/api/v1/website/custom-code', { as: 'admin', body: { name: 'Broken', kind: 'js', placement: 'body_end', code: 'function ( {' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /syntax/i);
  const sneaky = await api('POST', '/api/v1/website/custom-code/validate', { as: 'admin', body: { kind: 'js', placement: 'body_end', code: 'globalThis.__cmsSideEffect = true;' } });
  assert.equal(sneaky.status, 200);
  assert.equal(globalThis.__cmsSideEffect, false, 'validation compiles code, never executes it');
  assert.equal((await api('POST', '/api/v1/website/custom-code', { as: 'admin', body: { name: 'Css', kind: 'css', code: 'a { color: red; </style><script>' } })).status, 400);
  assert.equal((await api('POST', '/api/v1/website/custom-code', { as: 'admin', body: { name: 'Html', kind: 'html', placement: 'head', code: '<script>var a = 1;' } })).status, 400);

  await api('PUT', '/api/v1/website/integrations', { as: 'admin', body: { gtm: { id: 'GTM-ABC1234', enabled: true } } });
  const dup = await api('POST', '/api/v1/website/custom-code', { as: 'admin', body: { name: 'GTM again', kind: 'html', placement: 'head', code: "<script>(function(w,d,s,l,i){})(window,document,'script','dataLayer','GTM-ABC1234');</script>" } });
  assert.equal(dup.status, 201);
  assert.ok(dup.body.data.warnings.some(w => /fire twice/.test(w)), 'duplicated tracking is flagged');

  const draft = await newPage();
  const css = await api('POST', '/api/v1/website/custom-code', { as: 'admin', body: { name: 'Brand CSS', kind: 'css', code: '.hero { color: #fff; }' } });
  assert.equal(css.status, 201);
  const pageOnly = await api('POST', '/api/v1/website/custom-code', { as: 'admin', body: { name: 'Draft page code', kind: 'js', placement: 'body_end', scope: 'page', page: draft._id, code: 'console.log(1);' } });
  assert.equal(pageOnly.status, 201);
  const off = await api('PATCH', `/api/v1/website/custom-code/${dup.body.data._id}`, { as: 'admin', body: { isEnabled: false } });
  assert.equal(off.status, 200);

  const names = (await feed()).customCode.map(c => c.name);
  assert.deepEqual(names, ['Brand CSS'], 'disabled snippets and code for unpublished pages are excluded');
  assert.ok(await WebsiteActivityLog.exists({ action: 'customCode.update' }));

  // The activity log hides code from non-administrators.
  const act = await api('GET', '/api/v1/website/activity?targetType=WebsiteCustomCode', { as: 'editor' });
  assert.equal(act.status, 200);
  assert.ok(act.body.data.length >= 3);
  assert.ok(act.body.data.every(r => r.redacted && r.after === null));
  const actAdmin = await api('GET', '/api/v1/website/activity?targetType=WebsiteCustomCode', { as: 'admin' });
  assert.ok(actAdmin.body.data.some(r => r.after && r.after.code));
});

test('media: a file used by live content cannot be deleted; draft-only use needs confirmation; unused deletes', async () => {
  const mk = name => WebsiteMedia.create({ url: `https://res.cloudinary.com/demo/image/upload/${name}.jpg`, publicId: name, displayName: name, uploadedBy: ids.admin, bytes: 1000 });
  const liveImg = await mk('live');
  const draftImg = await mk('draft');
  const unused = await mk('unused');

  const page = await newPage();
  await api('POST', `/api/v1/website/pages/${page._id}/sections`, { as: 'admin', body: { type: 'imageText', content: { headingEn: 'H', image: { url: liveImg.url, publicId: liveImg.publicId } } } });
  await api('POST', `/api/v1/website/pages/${page._id}/publish`, { as: 'admin', body: {} });
  const page2 = await newPage();
  await api('POST', `/api/v1/website/pages/${page2._id}/sections`, { as: 'admin', body: { type: 'imageText', content: { headingEn: 'H', image: { url: draftImg.url } } } });

  const list = await api('GET', '/api/v1/website/media?usage=used', { as: 'viewer' });
  assert.deepEqual(list.body.data.map(m => m.displayName).sort(), ['draft', 'live']);
  const usage = await api('GET', `/api/v1/website/media/${liveImg._id}/usage`, { as: 'viewer' });
  assert.ok(usage.body.data.live >= 1);

  const delLive = await api('DELETE', `/api/v1/website/media/${liveImg._id}`, { as: 'editor' });
  assert.equal(delLive.status, 409);
  assert.match(delLive.body.message, /live website/);
  assert.equal((await api('DELETE', `/api/v1/website/media/${draftImg._id}`, { as: 'editor' })).status, 409);
  assert.equal((await api('DELETE', `/api/v1/website/media/${draftImg._id}?force=true`, { as: 'editor' })).status, 200);
  assert.equal((await api('DELETE', `/api/v1/website/media/${unused._id}`, { as: 'viewer' })).status, 403);
  assert.equal((await api('DELETE', `/api/v1/website/media/${unused._id}`, { as: 'editor' })).status, 200);

  const renamed = await api('PATCH', `/api/v1/website/media/${liveImg._id}`, { as: 'editor', body: { displayName: 'Hero - farm', folder: 'Hero Images' } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.folder, 'hero-images');
  const search = await api('GET', '/api/v1/website/media?q=farm', { as: 'viewer' });
  assert.equal(search.body.data.length, 1);
});

test('settings + overview: new site-wide fields reach the feed; contact details only when chosen; overview counts are real', async () => {
  const bad = await api('PUT', '/api/v1/website/settings', { as: 'admin', body: { businessHours: [{ day: 'sun', open: '18:00', close: '09:00' }] } });
  assert.equal(bad.status, 400);
  const ok = await api('PUT', '/api/v1/website/settings', {
    as: 'admin',
    body: {
      descriptionEn: 'Solar EPC',
      businessHours: [{ day: 'sun', open: '09:00', close: '17:00' }, { day: 'fri', closed: true }],
      cookieConsent: { enabled: true, messageEn: 'We use cookies.' },
      header: { ctaLabelEn: 'Get a quote', ctaHref: '/contact' },
      contact: { officePhone: '+20 2 1234 5678', salesEmail: 'internal@example.com' },
      robots: { disallowPaths: ['/drafts'] },
    },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  let s = (await feed()).settings;
  assert.equal(s.descriptionEn, 'Solar EPC');
  assert.equal(s.businessHours.length, 2);
  assert.equal(s.cookieConsent.enabled, true);
  assert.equal(s.header.ctaHref, '/contact');
  assert.deepEqual(s.robots.disallowPaths, ['/drafts']);
  assert.equal(s.contact, undefined, 'contact details stay private until an admin chooses to show them');
  await api('PUT', '/api/v1/website/settings', { as: 'admin', body: { publishOrgContacts: true } });
  s = (await feed()).settings;
  assert.equal(s.contact.officePhone, '+20 2 1234 5678');
  assert.equal(s.contact.salesEmail, undefined, 'internal routing addresses are never published');

  const a = await newPage();
  await addHero(a._id, 'A');
  await api('POST', `/api/v1/website/pages/${a._id}/publish`, { as: 'admin', body: {} });
  await newPage();
  const ov = await api('GET', '/api/v1/website/overview', { as: 'viewer' });
  assert.equal(ov.status, 200);
  assert.equal(ov.body.data.pages.total, 2);
  assert.equal(ov.body.data.pages.published, 1);
  assert.equal(ov.body.data.pages.draft, 1);
  assert.equal(ov.body.data.sections, 1);
  assert.equal(ov.body.data.lastPublished.slug, a.slug);

  const dep = await api('POST', '/api/v1/website/deploy', { as: 'admin' });
  assert.equal(dep.status, 200);
  assert.equal(dep.body.data.triggered, false, 'no deploy hook configured here - reported, not faked');
});

test('pages: slug rename follows into navigation; status filters; reorder', async () => {
  const a = await newPage('admin', { slug: 'old-slug' });
  const b = await newPage();
  await api('PUT', '/api/v1/website/navigation', { as: 'admin', body: { headerEntries: [{ type: 'link', labelEn: 'A', linkType: 'page', pageSlug: 'old-slug' }] } });
  const ren = await api('PATCH', `/api/v1/website/pages/${a._id}`, { as: 'editor', body: { slug: 'new-slug' } });
  assert.equal(ren.status, 200, JSON.stringify(ren.body));
  const nav = await api('GET', '/api/v1/website/navigation', { as: 'viewer' });
  assert.equal(nav.body.data.headerEntries[0].pageSlug, 'new-slug');

  const order = await api('PATCH', '/api/v1/website/pages/reorder', { as: 'editor', body: { order: [b._id, a._id] } });
  assert.equal(order.status, 200);
  const list = await api('GET', '/api/v1/website/pages?status=draft', { as: 'viewer' });
  assert.deepEqual(list.body.data.map(p => p.slug), [b.slug, 'new-slug']);
  const q = await api('GET', '/api/v1/website/pages?q=new-sl', { as: 'viewer' });
  assert.equal(q.body.data.length, 1);
});

test('media upload and replace: files are stored outside MongoDB, dimensions are read, drafts follow a replaced file', async () => {
  const sharp = require('sharp');
  const png = async (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#0a3d30' } }).png().toBuffer();
  const form = new FormData();
  form.append('files', new Blob([await png(640, 320)], { type: 'image/png' }), 'hero.png');
  form.append('folder', 'Hero Images');
  const up = await fetch(`${base}/api/v1/website/media`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.editor}` }, body: form });
  const upBody = await up.json();
  assert.equal(up.status, 201, JSON.stringify(upBody));
  const media = upBody.data[0];
  assert.equal(media.width, 640);
  assert.equal(media.height, 320);
  assert.equal(media.folder, 'hero-images');
  assert.equal(media.kind, 'image');
  const doc = await WebsiteMedia.findById(media._id).lean();
  assert.ok(!Object.values(doc).some(v => Buffer.isBuffer(v)), 'no file bytes in the document');
  assert.ok((await fetch(media.url)).ok, 'the file is served from storage');

  const bad = new FormData();
  bad.append('files', new Blob(['MZ...'], { type: 'application/x-msdownload' }), 'evil.exe');
  assert.equal((await fetch(`${base}/api/v1/website/media`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.editor}` }, body: bad })).status, 400, 'only images and videos are accepted');
  const viewerUp = new FormData();
  viewerUp.append('files', new Blob([await png(10, 10)], { type: 'image/png' }), 'v.png');
  assert.equal((await fetch(`${base}/api/v1/website/media`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.viewer}` }, body: viewerUp })).status, 403);

  const page = await newPage();
  const sec = await api('POST', `/api/v1/website/pages/${page._id}/sections`, { as: 'editor', body: { type: 'imageText', content: { headingEn: 'H', image: { url: media.url, publicId: media.publicId } } } });
  assert.equal(sec.status, 201, JSON.stringify(sec.body));

  const rep = new FormData();
  rep.append('file', new Blob([await png(800, 400)], { type: 'image/png' }), 'hero-v2.png');
  const r = await fetch(`${base}/api/v1/website/media/${media._id}/replace`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.editor}` }, body: rep });
  const rBody = await r.json();
  assert.equal(r.status, 200, JSON.stringify(rBody));
  assert.equal(rBody.data.media.width, 800);
  assert.notEqual(rBody.data.media.url, media.url);
  assert.equal(rBody.data.updatedReferences, 1);
  const after = await api('GET', `/api/v1/website/pages/${page._id}/sections`, { as: 'viewer' });
  assert.equal(after.body.data[0].content.image.url, rBody.data.media.url, 'the draft section now uses the new file');
  await fetch(rBody.data.media.url).then(x => assert.ok(x.ok));
  // clean up the files this test wrote
  for (const d of [await WebsiteMedia.findById(media._id).lean()]) await require('../../middleware/websiteMediaUploadMiddleware').destroyAsset(d);
});
