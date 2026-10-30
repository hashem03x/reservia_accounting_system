const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// Reservia backend - the GLOBAL, credentialed CORS policy (server/app.js), exercised against the
// REAL `cors` middleware and a REAL HTTP server (not a mock req/res) - a preflight's exact
// response headers depend on the `cors` npm package's own OPTIONS short-circuit behavior
// (res.end() before any route/auth middleware ever runs), which is the actual thing this test
// needs to prove, not just "the allow-list array contains the origin".
//
// Covers: the production error this fixes (an `Idempotency-Key` preflight from
// https://www.reservia-energy.com against /api/v1/crm/leads was rejected), the apex domain, the
// existing FRONTEND_URL/dev origins (no regression), and that an unapproved origin is still
// rejected (no wildcard was introduced).

const path = require('path');

function freshApp(env) {
  const serverDirMarker = `${path.sep}server${path.sep}`;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(serverDirMarker)) delete require.cache[key];
  }
  const previous = { FRONTEND_URL: process.env.FRONTEND_URL, VERCEL: process.env.VERCEL };
  if (env.FRONTEND_URL === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = env.FRONTEND_URL;
  process.env.VERCEL = '1'; // skip the backup scheduler / any local-only startup side effects
  const app = require('../../app');
  return { app, restore: () => { process.env.FRONTEND_URL = previous.FRONTEND_URL; process.env.VERCEL = previous.VERCEL; } };
}

let server, baseUrl, restoreEnv;

before(() => {
  const { app, restore } = freshApp({ FRONTEND_URL: 'https://reserviafrontend.vercel.app' });
  restoreEnv = restore;
  server = http.createServer(app);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  restoreEnv();
  return new Promise(resolve => server.close(resolve));
});

function preflight(origin, { path = '/api/v1/crm/leads', headers = 'content-type,idempotency-key', method = 'POST' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}${path}`,
      {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': method,
          'Access-Control-Request-Headers': headers,
        },
      },
      res => {
        res.resume();
        res.on('end', () => resolve(res));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('preflight from https://www.reservia-energy.com requesting content-type,idempotency-key succeeds with the right headers', async () => {
  const res = await preflight('https://www.reservia-energy.com');
  assert.ok(res.statusCode < 300, `expected a successful preflight, got ${res.statusCode}`);
  assert.equal(res.headers['access-control-allow-origin'], 'https://www.reservia-energy.com');
  const allowHeaders = (res.headers['access-control-allow-headers'] || '').toLowerCase();
  assert.ok(allowHeaders.includes('content-type'), `Content-Type missing from: ${allowHeaders}`);
  assert.ok(allowHeaders.includes('idempotency-key'), `Idempotency-Key missing from: ${allowHeaders}`);
  const allowMethods = (res.headers['access-control-allow-methods'] || '').toUpperCase();
  assert.ok(allowMethods.includes('POST'));
});

test('preflight from the apex domain https://reservia-energy.com gets the same successful treatment', async () => {
  const res = await preflight('https://reservia-energy.com');
  assert.ok(res.statusCode < 300);
  assert.equal(res.headers['access-control-allow-origin'], 'https://reservia-energy.com');
  assert.ok((res.headers['access-control-allow-headers'] || '').toLowerCase().includes('idempotency-key'));
});

test('Authorization is still an allowed header - adding Idempotency-Key did not remove it', async () => {
  const res = await preflight('https://www.reservia-energy.com', { headers: 'content-type,authorization' });
  const allowHeaders = (res.headers['access-control-allow-headers'] || '').toLowerCase();
  assert.ok(allowHeaders.includes('authorization'));
  assert.ok(allowHeaders.includes('content-type'));
});

test('the existing FRONTEND_URL (Central Portal frontend) origin still preflights successfully - no regression', async () => {
  const res = await preflight('https://reserviafrontend.vercel.app');
  assert.equal(res.headers['access-control-allow-origin'], 'https://reserviafrontend.vercel.app');
});

test('the existing local dev origin still preflights successfully', async () => {
  const res = await preflight('http://localhost:5173');
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
});

test('an unapproved third-party origin gets no Access-Control-Allow-Origin header - no wildcard was introduced', async () => {
  const res = await preflight('https://evil.example.com');
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('credentials are still only reflected for allowed origins (Access-Control-Allow-Credentials true for the allowed origin, absent for a rejected one)', async () => {
  const allowed = await preflight('https://www.reservia-energy.com');
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
  const rejected = await preflight('https://evil.example.com');
  assert.equal(rejected.headers['access-control-allow-credentials'], undefined);
});

test('POST and OPTIONS are both still in Access-Control-Allow-Methods for the production website origin (other existing methods are untouched)', async () => {
  const res = await preflight('https://www.reservia-energy.com');
  const allowMethods = (res.headers['access-control-allow-methods'] || '').toUpperCase().split(',').map(s => s.trim());
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.ok(allowMethods.includes(m), `${m} missing from Access-Control-Allow-Methods: ${allowMethods}`);
  }
});
