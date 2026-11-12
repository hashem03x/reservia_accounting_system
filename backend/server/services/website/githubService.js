'use strict';

const ApiError = require('../../utils/apiError');

// Website Management - the protected source-code workflow for the public website repository
// (administrators only, code.manage). Every change is a commit on a separate WORK branch - never on
// the production branch; the hosting provider builds a preview deployment of that branch; going
// live is an explicit pull request + merge. Rollback = revert a file to an earlier commit or reset
// the work branch to production. Nothing is executed on this server.
//
// Configuration (none of it is ever sent to the browser):
//   WEBSITE_GITHUB_TOKEN        fine-grained token: Contents read/write + Pull requests read/write
//                               on the website repository only
//   WEBSITE_GITHUB_REPO         owner/name, e.g. hashem03x/reservia_website
//   WEBSITE_GITHUB_BASE_BRANCH  production branch (default: main)
//   WEBSITE_GITHUB_WORK_BRANCH  editing branch (default: website-code-edits)

const API = 'https://api.github.com';
const MAX_FILE_BYTES = 300 * 1024;
// Editable: the site's own source, styles, static assets and the HTML template. Never: secrets,
// build/deploy configuration, dependencies.
const EDITABLE = /^(src\/[A-Za-z0-9_\-./[\]]+|public\/[A-Za-z0-9_\-./]+|index\.html)$/;
const TEXT_EXT = /\.(tsx?|jsx?|css|json|svg|html|md|txt|xml|webmanifest)$/i;
const DENY = /(^|\/)\.env|(^|\/)\.[^/]+$|\.\.(\/|$)/;

const cfg = () => ({
  token: process.env.WEBSITE_GITHUB_TOKEN || '',
  repo: process.env.WEBSITE_GITHUB_REPO || '',
  base: process.env.WEBSITE_GITHUB_BASE_BRANCH || 'main',
  work: process.env.WEBSITE_GITHUB_WORK_BRANCH || 'website-code-edits',
});

function configured() {
  const c = cfg();
  return !!(c.token && /^[\w.-]+\/[\w.-]+$/.test(c.repo));
}

function assertConfigured() {
  if (!configured()) throw new ApiError('The code workspace is not connected to the website repository yet. A system administrator needs to set WEBSITE_GITHUB_TOKEN and WEBSITE_GITHUB_REPO on the server.', 503);
  const c = cfg();
  if (c.work === c.base) throw new ApiError('The work branch must be different from the production branch.', 500);
}

async function gh(method, path, body, { allow404 = false } = {}) {
  const c = cfg();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'reservia-website-cms', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (allow404 && res.status === 404) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.message || `GitHub responded with HTTP ${res.status}`;
    throw new ApiError(`Repository: ${msg}`, res.status === 409 ? 409 : res.status === 422 ? 400 : res.status === 401 || res.status === 403 ? 502 : 502);
  }
  return json;
}

const repoPath = () => `/repos/${cfg().repo}`;
const enc = p => p.split('/').map(encodeURIComponent).join('/');

function assertEditablePath(path) {
  if (typeof path !== 'string' || !EDITABLE.test(path) || DENY.test(path)) throw new ApiError('This file cannot be edited from the dashboard (only src/, public/ and index.html; never configuration or secrets).', 403);
  if (!TEXT_EXT.test(path)) throw new ApiError('Only text source files can be edited here.', 400);
}

/** Static checks before committing (the preview build is the full check). */
function validateContent(path, content) {
  if (typeof content !== 'string') throw new ApiError('content must be text.', 400);
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new ApiError(`Files are limited to ${MAX_FILE_BYTES / 1024} KB here.`, 400);
  if (content.includes('\u0000')) throw new ApiError('The file contains a null character.', 400);
  if (/\.(json|webmanifest)$/i.test(path)) {
    try {
      JSON.parse(content);
    } catch (err) {
      throw new ApiError(`Invalid JSON: ${err.message}`, 400);
    }
  }
  if (/\.css$/i.test(path)) {
    let depth = 0;
    for (const ch of content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""')) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth < 0) break;
    }
    if (depth !== 0) throw new ApiError('The CSS has unbalanced { } braces.', 400);
  }
  if (/\.(env|pem|key)$/i.test(path) || /(api[_-]?key|secret|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i.test(content)) {
    throw new ApiError('The file looks like it contains a secret. Secrets belong in the hosting environment settings, never in source code.', 400);
  }
}

async function branchSha(name) {
  const ref = await gh('GET', `${repoPath()}/git/ref/heads/${enc(name)}`, null, { allow404: true });
  return ref ? ref.object.sha : null;
}

async function ensureWorkBranch() {
  assertConfigured();
  const c = cfg();
  const existing = await branchSha(c.work);
  if (existing) return { sha: existing, created: false };
  const base = await branchSha(c.base);
  if (!base) throw new ApiError(`The production branch "${c.base}" was not found.`, 502);
  await gh('POST', `${repoPath()}/git/refs`, { ref: `refs/heads/${c.work}`, sha: base });
  return { sha: base, created: true };
}

async function status() {
  if (!configured()) return { configured: false };
  const c = cfg();
  const work = await branchSha(c.work);
  const out = { configured: true, repo: c.repo, base: c.base, work: c.work, workExists: !!work, aheadBy: 0, behindBy: 0, commits: [], pullRequest: null, checks: null, preview: null };
  if (!work) return out;
  const cmp = await gh('GET', `${repoPath()}/compare/${enc(c.base)}...${enc(c.work)}`);
  out.aheadBy = cmp.ahead_by;
  out.behindBy = cmp.behind_by;
  out.commits = (cmp.commits || []).slice(-30).reverse().map(x => ({ sha: x.sha, message: x.commit.message, author: x.commit.author?.name, date: x.commit.author?.date }));
  out.files = (cmp.files || []).map(f => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }));
  const owner = c.repo.split('/')[0];
  const prs = await gh('GET', `${repoPath()}/pulls?state=open&head=${encodeURIComponent(`${owner}:${c.work}`)}&base=${encodeURIComponent(c.base)}`);
  if (prs && prs[0]) out.pullRequest = { number: prs[0].number, url: prs[0].html_url, title: prs[0].title, mergeable: prs[0].mergeable_state };
  const st = await gh('GET', `${repoPath()}/commits/${work}/status`, null, { allow404: true });
  if (st) out.checks = { state: st.state, statuses: (st.statuses || []).map(s => ({ context: s.context, state: s.state, description: s.description, url: s.target_url })) };
  const deps = await gh('GET', `${repoPath()}/deployments?ref=${encodeURIComponent(c.work)}&per_page=1`, null, { allow404: true });
  if (deps && deps[0]) {
    const ds = await gh('GET', `${repoPath()}/deployments/${deps[0].id}/statuses?per_page=1`, null, { allow404: true });
    out.preview = { environment: deps[0].environment, state: ds?.[0]?.state || 'pending', url: ds?.[0]?.environment_url || ds?.[0]?.target_url || null, createdAt: deps[0].created_at };
  }
  return out;
}

async function listFiles() {
  assertConfigured();
  const c = cfg();
  const ref = (await branchSha(c.work)) ? c.work : c.base;
  const tree = await gh('GET', `${repoPath()}/git/trees/${enc(ref)}?recursive=1`);
  return {
    ref,
    files: (tree.tree || [])
      .filter(t => t.type === 'blob' && EDITABLE.test(t.path) && !DENY.test(t.path) && TEXT_EXT.test(t.path))
      .map(t => ({ path: t.path, size: t.size })),
  };
}

async function readFile(path, ref) {
  assertConfigured();
  assertEditablePath(path);
  const c = cfg();
  const at = ref || ((await branchSha(c.work)) ? c.work : c.base);
  const f = await gh('GET', `${repoPath()}/contents/${enc(path)}?ref=${encodeURIComponent(at)}`, null, { allow404: true });
  if (!f) throw new ApiError('File not found.', 404);
  return { path, sha: f.sha, ref: at, content: Buffer.from(f.content || '', 'base64').toString('utf8') };
}

async function writeFile(path, content, sha, message) {
  assertEditablePath(path);
  validateContent(path, content);
  await ensureWorkBranch();
  const c = cfg();
  const current = await gh('GET', `${repoPath()}/contents/${enc(path)}?ref=${encodeURIComponent(c.work)}`, null, { allow404: true });
  if (current && sha && current.sha !== sha) throw new ApiError('This file changed since you opened it. Reload it before saving.', 409);
  const res = await gh('PUT', `${repoPath()}/contents/${enc(path)}`, {
    message: (message || `Edit ${path}`).slice(0, 200),
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: c.work,
    ...(current ? { sha: current.sha } : {}),
  });
  return { commit: res.commit?.sha, sha: res.content?.sha };
}

async function fileHistory(path) {
  assertConfigured();
  assertEditablePath(path);
  const c = cfg();
  const ref = (await branchSha(c.work)) ? c.work : c.base;
  const commits = await gh('GET', `${repoPath()}/commits?sha=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}&per_page=20`);
  return commits.map(x => ({ sha: x.sha, message: x.commit.message, author: x.commit.author?.name, date: x.commit.author?.date }));
}

async function revertFile(path, toSha) {
  if (!/^[a-f0-9]{7,40}$/i.test(String(toSha))) throw new ApiError('Choose a version to restore.', 400);
  const old = await readFile(path, toSha);
  return writeFile(path, old.content, null, `Restore ${path} to ${String(toSha).slice(0, 7)}`);
}

/** Throws away every unpublished change: the work branch goes back to production. */
async function discardAll() {
  assertConfigured();
  const c = cfg();
  const base = await branchSha(c.base);
  if (!(await branchSha(c.work))) return { reset: false };
  await gh('PATCH', `${repoPath()}/git/refs/heads/${enc(c.work)}`, { sha: base, force: true });
  return { reset: true };
}

async function openPullRequest(title) {
  assertConfigured();
  const c = cfg();
  const s = await status();
  if (!s.workExists || !s.aheadBy) throw new ApiError('There are no code changes to publish.', 400);
  if (s.pullRequest) return s.pullRequest;
  const pr = await gh('POST', `${repoPath()}/pulls`, { title: (title || 'Website code changes from the dashboard').slice(0, 200), head: c.work, base: c.base, body: 'Created from Reservia Website Management (code workspace). Review the preview deployment before merging.' });
  return { number: pr.number, url: pr.html_url, title: pr.title };
}

/** The explicit "go live": merges the pull request into the production branch. */
async function mergePullRequest() {
  assertConfigured();
  const s = await status();
  if (!s.pullRequest) throw new ApiError('Open a pull request for the changes first.', 400);
  if (s.checks && s.checks.state === 'failure') throw new ApiError('The preview build of these changes failed. Fix it before publishing.', 400);
  const r = await gh('PUT', `${repoPath()}/pulls/${s.pullRequest.number}/merge`, { merge_method: 'squash' });
  return { merged: !!r.merged, sha: r.sha };
}

module.exports = { configured, status, listFiles, readFile, writeFile, fileHistory, revertFile, discardAll, openPullRequest, mergePullRequest, ensureWorkBranch, validateContent, assertEditablePath };
