const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');

// Website Visual Editor API - HTTP-level, through the real routers and permission gates: draft
// isolation, signed editor/preview tokens, conflict detection, validation (no CSS/script
// injection), capability rules (global design / code), publish, version history, restore and
// rollback, and the code workspace's guards. Needs a local MongoDB replica set.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_website_visual';
process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || crypto.randomBytes(24).toString('hex');
process.env.FRONTEND_URL = 'https://dashboard.example.com';
process.env.WEBSITE_PUBLIC_URL = 'https://site.example.com';
delete process.env.WEBSITE_PUBLISH_DEPLOY_HOOK_URL;
delete process.env.WEBSITE_GITHUB_TOKEN;
delete process.env.WEBSITE_GITHUB_REPO;

let server;
let base;
const tokens = {};
let Visual;

async function api(method, path, { as, body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}
const feedVisual = async () => (await api('GET', '/api/v1/website/public/site')).body.data.visual;
const draft = async () => (await api('GET', '/api/v1/website/visual/draft', { as: 'viewer' })).body.data;

const HERO = 'Home.9';
const cfg = (over = {}) => ({ v: 1, tokens: {}, rules: {}, css: '', nodes: {}, routes: { '/': { el: { [HERO]: { text: { en: 'Power with the sun' }, styles: { all: { color: '#123456' }, desktop: { fontSize: '64px' } } } } } }, ...over });

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  const User = require('../../models/userModel');
  Visual = require('../../models/website/websiteVisualModel');
  await Visual.WebsiteVisualRevision.init();
  const app = express();
  app.use(express.json({ limit: '3mb' }));
  app.use(require('express-mongo-sanitize')()); // exactly as app.js: request bodies lose '.'/'$' keys
  app.use('/api/v1/website', require('../../routes/website/siteRoute'));
  app.use('/api/v1/website/public', require('../../routes/website/publicSiteRoute'));
  app.use(require('../../middleware/errorMiddleware'));
  await new Promise(r => {
    server = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, role] of [['admin', 'admin'], ['editor', 'editor'], ['viewer', 'viewer']]) {
    const u = await User.create({ name: `VE ${k}`, email: `ve-${k}-${Date.now()}@example.com`, role: 'admin', type: 'online', systemMemberships: [{ system: 'WEBSITE', role, isActive: true }] });
    tokens[k] = jwt.sign({ userId: u._id }, process.env.JWT_SECRET_KEY, { expiresIn: '1h' });
  }
});
after(async () => {
  await new Promise(r => server.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Visual.WebsiteVisual.deleteMany({});
  await Visual.WebsiteVisualRevision.deleteMany({});
});

test('draft is private until published; the signed editor token reads it; tampered/expired tokens do not', async () => {
  const saved = await api('PUT', '/api/v1/website/visual/draft', { as: 'editor', body: { configJson: JSON.stringify(cfg()), baseRev: 0 } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.rev, 1);
  assert.deepEqual((await feedVisual()).routes, {}, 'the live site does not see the draft');

  const noOrigin = await api('POST', '/api/v1/website/visual/preview-token', { as: 'viewer', body: { mode: 'edit', path: '/about', lang: 'en' } });
  assert.equal(noOrigin.status, 403, 'the editor can only be opened from the dashboard origin');
  const t = await api('POST', '/api/v1/website/visual/preview-token', { as: 'viewer', body: { mode: 'edit', path: '/about', lang: 'en' }, headers: { Origin: 'https://dashboard.example.com' } });
  assert.equal(t.status, 200);
  assert.match(t.body.data.url, /^https:\/\/site\.example\.com\/en\/about\?__ve=/);
  const pv = await api('GET', `/api/v1/website/public/visual-preview/${encodeURIComponent(t.body.data.token)}`);
  assert.equal(pv.status, 200);
  assert.equal(pv.body.data.editorOrigin, 'https://dashboard.example.com');
  assert.equal(pv.body.data.config.routes['/'].el[HERO].text.en, 'Power with the sun');
  const forged = `${t.body.data.token.split('.')[0]}.x${t.body.data.token.split('.')[1].slice(1)}`;
  assert.equal((await api('GET', `/api/v1/website/public/visual-preview/${encodeURIComponent(forged)}`)).status, 401);
  const { createVisualToken } = require('../../utils/website/previewToken');
  const old = createVisualToken({ mode: 'preview', now: Date.now() - 3600 * 1000 }).token;
  assert.equal((await api('GET', `/api/v1/website/public/visual-preview/${encodeURIComponent(old)}`)).status, 401);
  const preview = await api('POST', '/api/v1/website/visual/preview-token', { as: 'viewer', body: { mode: 'preview', path: '/', lang: 'ar' } });
  assert.match(preview.body.data.url, /\/ar\?__vp=/);
});

test('conflicting saves are refused (409) with the latest version', async () => {
  await api('PUT', '/api/v1/website/visual/draft', { as: 'editor', body: { configJson: JSON.stringify(cfg()), baseRev: 0 } });
  const stale = await api('PUT', '/api/v1/website/visual/draft', { as: 'admin', body: { configJson: JSON.stringify(cfg({ css: '' })), baseRev: 0 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.data.rev, 1);
});

test('validation: only known style properties, no CSS break-outs or scripts, safe links and media', async () => {
  const bad = async c => (await api('PUT', '/api/v1/website/visual/draft', { as: 'admin', body: { configJson: JSON.stringify(c), baseRev: 0 } })).status;
  assert.equal(await bad(cfg({ routes: { '/': { el: { [HERO]: { styles: { all: { behavior: 'x' } } } } } } })), 400);
  assert.equal(await bad(cfg({ routes: { '/': { el: { [HERO]: { styles: { all: { color: 'red;} body{display:none' } } } } } } })), 400);
  assert.equal(await bad(cfg({ routes: { '/': { el: { [HERO]: { styles: { all: { backgroundImage: 'url(javascript:alert(1))' } } } } } } })), 400);
  assert.equal(await bad(cfg({ routes: { '/': { el: { [HERO]: { attrs: { href: 'javascript:alert(1)' } } } } } })), 400);
  assert.equal(await bad(cfg({ routes: { '/': { el: { [HERO]: { attrs: { src: 'http://evil.example.com/a.png' } } } } } })), 400);
  assert.equal(await bad(cfg({ css: 'a{color:red}</style><script>alert(1)</script>' })), 400);
  assert.equal(await bad(cfg({ nodes: { abcd1234: { type: 'script', props: {} } } })), 400);
  assert.equal(await bad({ ...cfg(), routes: { '/x y': { el: {} } } }), 400);
});

test('capabilities: editors edit content and element styles but not global design or code; viewers cannot save', async () => {
  assert.equal((await api('PUT', '/api/v1/website/visual/draft', { as: 'viewer', body: { configJson: JSON.stringify(cfg()), baseRev: 0 } })).status, 403);
  assert.equal((await api('PUT', '/api/v1/website/visual/draft', { as: 'editor', body: { configJson: JSON.stringify(cfg({ tokens: { '--sun': '#ff0000' } })), baseRev: 0 } })).status, 403);
  assert.equal((await api('PUT', '/api/v1/website/visual/draft', { as: 'editor', body: { configJson: JSON.stringify(cfg({ css: '.x{color:red}' })), baseRev: 0 } })).status, 403);
  assert.equal((await api('PUT', '/api/v1/website/visual/draft', { as: 'editor', body: { configJson: JSON.stringify(cfg({ nodes: { abcd1234: { type: 'html', props: { html: '<b>x</b>' } } } })), baseRev: 0 } })).status, 403);
  const admin = await api('PUT', '/api/v1/website/visual/draft', { as: 'admin', body: { configJson: JSON.stringify(cfg({ tokens: { '--sun': '#ff0000', 'dark:--sun': '#00ff00' }, css: '.x{color:red}' })), baseRev: 0 } });
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  // an editor can still save content while the admin's design is in place (unchanged restricted parts)
  const d = await draft();
  const edited = JSON.parse(JSON.stringify(d.config));
  edited.routes['/'].el[HERO].text.en = 'Edited by the editor';
  assert.equal((await api('PUT', '/api/v1/website/visual/draft', { as: 'editor', body: { configJson: JSON.stringify(edited), baseRev: d.rev } })).status, 200);
});

test('publish, versions, restore to draft and rollback of the live site', async () => {
  await api('PUT', '/api/v1/website/visual/draft', { as: 'editor', body: { configJson: JSON.stringify(cfg()), baseRev: 0 } });
  assert.equal((await api('POST', '/api/v1/website/visual/publish', { as: 'editor' })).status, 403);
  const p1 = await api('POST', '/api/v1/website/visual/publish', { as: 'admin', body: {} });
  assert.equal(p1.status, 200);
  assert.equal(p1.body.data.deploy.triggered, false, 'no deploy hook here - reported, not faked');
  assert.equal((await feedVisual()).routes['/'].el[HERO].text.en, 'Power with the sun');

  const d = await draft();
  const v2 = JSON.parse(JSON.stringify(d.config));
  v2.routes['/'].el[HERO].text.en = 'Second version';
  await api('PUT', '/api/v1/website/visual/draft', { as: 'editor', body: { configJson: JSON.stringify(v2), baseRev: d.rev, label: 'v2' } });
  assert.equal((await feedVisual()).routes['/'].el[HERO].text.en, 'Power with the sun', 'saving never changes the live site');
  await api('POST', '/api/v1/website/visual/publish', { as: 'admin', body: {} });
  assert.equal((await feedVisual()).routes['/'].el[HERO].text.en, 'Second version');

  const list = await api('GET', '/api/v1/website/visual/revisions', { as: 'viewer' });
  const publishes = list.body.data.filter(r => r.kind === 'publish');
  assert.equal(publishes.length, 2);
  assert.ok(publishes[0].live && !publishes[1].live, 'the latest publish is marked live');
  assert.equal((await api('POST', `/api/v1/website/visual/revisions/${publishes[1]._id}/rollback`, { as: 'editor' })).status, 403);
  const rb = await api('POST', `/api/v1/website/visual/revisions/${publishes[1]._id}/rollback`, { as: 'admin' });
  assert.equal(rb.status, 200);
  assert.equal((await feedVisual()).routes['/'].el[HERO].text.en, 'Power with the sun', 'rolled back');
  assert.equal((await draft()).config.routes['/'].el[HERO].text.en, 'Second version', 'rollback leaves the draft alone');

  const rs = await api('POST', `/api/v1/website/visual/revisions/${publishes[1]._id}/restore`, { as: 'editor' });
  assert.equal(rs.status, 200);
  assert.equal((await draft()).config.routes['/'].el[HERO].text.en, 'Power with the sun', 'restore copies a version into the draft');
});

test('autosaves are kept as versions at most every two minutes', async () => {
  let rev = 0;
  for (let i = 0; i < 3; i++) {
    const r = await api('PUT', '/api/v1/website/visual/draft', { as: 'editor', body: { configJson: JSON.stringify(cfg({ routes: { '/': { el: { [HERO]: { text: { en: `v${i}` } } } } } })), baseRev: rev, autosave: true } });
    rev = r.body.data.rev;
  }
  assert.equal(rev, 3);
  assert.equal(await Visual.WebsiteVisualRevision.countDocuments({ kind: 'autosave' }), 1);
});

test('code workspace: administrators only, and it says when it is not connected', async () => {
  assert.equal((await api('GET', '/api/v1/website/code/status', { as: 'editor' })).status, 403);
  const s = await api('GET', '/api/v1/website/code/status', { as: 'admin' });
  assert.equal(s.status, 200);
  assert.equal(s.body.data.configured, false);
  assert.equal((await api('GET', '/api/v1/website/code/files', { as: 'admin' })).status, 503);
  assert.equal((await api('POST', '/api/v1/website/code/deploy', { as: 'editor' })).status, 403);
  const gh = require('../../services/website/githubService');
  assert.throws(() => gh.assertEditablePath('.env'), /cannot be edited/);
  assert.throws(() => gh.assertEditablePath('package.json'), /cannot be edited/);
  assert.throws(() => gh.assertEditablePath('vercel.json'), /cannot be edited/);
  assert.throws(() => gh.assertEditablePath('src/../.env'), /cannot be edited/);
  assert.doesNotThrow(() => gh.assertEditablePath('src/pages/Home.tsx'));
  assert.throws(() => gh.validateContent('src/x.json', '{bad'), /Invalid JSON/);
  assert.throws(() => gh.validateContent('src/x.css', 'a{color:red'), /braces/);
  assert.throws(() => gh.validateContent('src/x.ts', "const apiKey = 'sk_live_abcdefghijklmnop1234'"), /secret/);
});
