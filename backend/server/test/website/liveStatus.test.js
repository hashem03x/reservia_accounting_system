const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');

// Website CMS - "is the live website built from what is published?" (GET /website/live-status)
// and the published feed's content hash + no-store caching that it relies on. The live website is
// a local stub serving /cms-build.json (the stamp the website's scripts/build-site.mjs writes).
// Local MongoDB only (own database).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_website_live';
process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || crypto.randomBytes(24).toString('hex');
delete process.env.WEBSITE_PUBLISH_DEPLOY_HOOK_URL;

let server;
let base;
let site;
let stamp = null; // what the stub live website serves at /cms-build.json (null = 404)
let User, WebsiteActivityLog;
const tokens = {};
const ids = {};

async function api(method, path, { as, body } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}
const status = async (as = 'viewer') => (await api('GET', '/api/v1/website/live-status', { as })).body.data;
const feed = async () => api('GET', '/api/v1/website/public/site');
const logRebuild = (minutesAgo, action = 'visual.publish') =>
  WebsiteActivityLog.create({ actor: ids.admin, actorName: 'Admin', action, targetType: 'WebsiteVisual', createdAt: new Date(Date.now() - minutesAgo * 60000) });

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  WebsiteActivityLog = require('../../models/website/websiteActivityLogModel');

  site = http.createServer((req, res) => {
    if (req.url === '/cms-build.json' && stamp) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(stamp));
    }
    res.writeHead(404).end();
  });
  await new Promise(r => site.listen(0, '127.0.0.1', r));
  process.env.WEBSITE_PUBLIC_URL = `http://127.0.0.1:${site.address().port}`;

  const app = express();
  app.use(express.json());
  app.use('/api/v1/website', require('../../routes/website/siteRoute'));
  app.use('/api/v1/website/public', require('../../routes/website/publicSiteRoute'));
  app.use(require('../../middleware/errorMiddleware'));
  await new Promise(r => {
    server = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const mk = async (key, role) => {
    const u = await User.create({ name: `Live ${key}`, email: `live-${key}-${Date.now()}@example.com`, role: 'admin', type: 'online', systemMemberships: role ? [{ system: 'WEBSITE', role, isActive: true }] : [] });
    ids[key] = u._id;
    tokens[key] = jwt.sign({ userId: u._id }, process.env.JWT_SECRET_KEY, { expiresIn: '1h' });
  };
  await mk('admin', 'admin');
  await mk('viewer', 'viewer');
  await mk('outsider', null);
});

after(async () => {
  delete process.env.WEBSITE_PUBLIC_URL;
  delete process.env.WEBSITE_PUBLISH_DEPLOY_HOOK_URL;
  await new Promise(r => server.close(r));
  await new Promise(r => site.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  stamp = null;
  delete process.env.WEBSITE_PUBLISH_DEPLOY_HOOK_URL;
  for (const m of ['websiteActivityLogModel', 'websiteNavigationModel', 'websitePageModel']) await require(`../../models/website/${m}`).deleteMany({});
});

test('feed: carries a stable content hash, is never cached, and the hash follows published changes', async () => {
  const a = await feed();
  assert.equal(a.status, 200);
  assert.match(a.headers.get('cache-control'), /no-store/);
  assert.match(a.body.data.contentHash, /^[a-f0-9]{32}$/);
  const b = await feed();
  assert.equal(b.body.data.contentHash, a.body.data.contentHash, 'same content -> same hash (generatedAt is excluded)');
  assert.notEqual(b.body.data.generatedAt, undefined);
  const nav = await api('PUT', '/api/v1/website/navigation', { as: 'admin', body: { headerEntries: [{ type: 'link', labelEn: 'Our story', labelAr: 'قصتنا', linkType: 'external', externalUrl: '/about' }] } });
  assert.equal(nav.status, 200, JSON.stringify(nav.body));
  assert.notEqual((await feed()).body.data.contentHash, a.body.data.contentHash, 'a menu change changes what the website renders');
});

test('live-status: requires Website access (viewer can read, outsider cannot)', async () => {
  assert.equal((await api('GET', '/api/v1/website/live-status')).status, 401);
  assert.equal((await api('GET', '/api/v1/website/live-status', { as: 'outsider' })).status, 403);
  assert.equal((await api('GET', '/api/v1/website/live-status', { as: 'viewer' })).status, 200);
});

test('live-status: up_to_date only when the live build stamp matches the published content', async () => {
  const hash = (await feed()).body.data.contentHash;
  stamp = { schemaVersion: 1, cms: true, contentHash: hash, builtAt: new Date().toISOString() };
  const s = await status();
  assert.equal(s.state, 'up_to_date');
  assert.equal(s.liveHash, hash);
  assert.equal(s.publishedHash, hash);
});

test('live-status: a requested rebuild that has not gone live is "updating", then "behind" after the grace period', async () => {
  process.env.WEBSITE_PUBLISH_DEPLOY_HOOK_URL = 'http://127.0.0.1:9/never-called';
  stamp = { schemaVersion: 1, cms: true, contentHash: 'f'.repeat(32), builtAt: new Date(Date.now() - 3600000).toISOString() };
  await logRebuild(2);
  assert.equal((await status()).state, 'updating');
  await WebsiteActivityLog.deleteMany({});
  await logRebuild(20);
  assert.equal((await status()).state, 'behind', 'a build that never went live is reported, not hidden');
});

test('live-status: without a deploy hook an out-of-date site is "behind" straight away', async () => {
  stamp = { schemaVersion: 1, cms: true, contentHash: 'f'.repeat(32) };
  await logRebuild(1);
  assert.equal((await status()).state, 'behind');
});

test('live-status: a build made without CMS_API_URL is reported as no_cms', async () => {
  stamp = { schemaVersion: 1, cms: false, builtAt: new Date().toISOString() };
  assert.equal((await status()).state, 'no_cms');
});

test('live-status: a live build without a stamp is no_stamp; an unreachable site is unreachable', async () => {
  stamp = null;
  assert.equal((await status()).state, 'no_stamp');
  const saved = process.env.WEBSITE_PUBLIC_URL;
  process.env.WEBSITE_PUBLIC_URL = 'http://127.0.0.1:9';
  try {
    assert.equal((await status()).state, 'unreachable');
  } finally {
    process.env.WEBSITE_PUBLIC_URL = saved;
  }
});

test('live-status: never exposes the deploy hook URL', async () => {
  process.env.WEBSITE_PUBLISH_DEPLOY_HOOK_URL = 'https://api.vercel.com/v1/integrations/deploy/prj_secret/abc123secret';
  const r = await api('GET', '/api/v1/website/live-status', { as: 'admin' });
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.body).includes('abc123secret'));
  assert.equal(r.body.data.deployConfigured, true);
});
