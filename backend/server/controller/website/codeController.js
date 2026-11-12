const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const gh = require('../../services/website/githubService');
const { logWebsiteActivity } = require('../../utils/website/activityLog');

// Website Management - code workspace (administrators only: every route requires code.manage;
// publishing additionally requires publish). See services/website/githubService.js.

const status = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Code workspace', true, await gh.status()));
});

const files = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Files', true, await gh.listFiles()));
});

const readFile = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('File', true, await gh.readFile(String(req.query.path || ''), req.query.ref ? String(req.query.ref) : undefined)));
});

const history = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('History', true, await gh.fileHistory(String(req.query.path || ''))));
});

const saveFile = asyncHandler(async (req, res) => {
  const { path, content, sha, message } = req.body || {};
  const out = await gh.writeFile(path, content, sha, message);
  await logWebsiteActivity({ actor: req.user, action: 'code.commit', targetType: 'WebsiteCode', targetLabel: path, after: { commit: out.commit, message } });
  res.status(200).json(apiResponse('Saved to the work branch. A preview build starts automatically.', true, out));
});

const revertFile = asyncHandler(async (req, res) => {
  const { path, sha } = req.body || {};
  const out = await gh.revertFile(path, sha);
  await logWebsiteActivity({ actor: req.user, action: 'code.revert', targetType: 'WebsiteCode', targetLabel: path, after: { to: sha, commit: out.commit } });
  res.status(200).json(apiResponse('File restored to that version (as a new change on the work branch).', true, out));
});

const discard = asyncHandler(async (req, res) => {
  const out = await gh.discardAll();
  await logWebsiteActivity({ actor: req.user, action: 'code.revert', targetType: 'WebsiteCode', targetLabel: 'All unpublished code changes discarded' });
  res.status(200).json(apiResponse('Unpublished code changes discarded.', true, out));
});

const pullRequest = asyncHandler(async (req, res) => {
  const pr = await gh.openPullRequest(req.body?.title);
  await logWebsiteActivity({ actor: req.user, action: 'code.pullRequest', targetType: 'WebsiteCode', targetLabel: `Pull request #${pr.number}`, after: pr });
  res.status(200).json(apiResponse('Pull request ready for review.', true, pr));
});

const deploy = asyncHandler(async (req, res) => {
  const out = await gh.mergePullRequest();
  await logWebsiteActivity({ actor: req.user, action: 'code.deploy', targetType: 'WebsiteCode', targetLabel: 'Code changes merged to production', after: out });
  res.status(200).json(apiResponse('Merged. The production website is being rebuilt from the new code.', true, out));
});

module.exports = { status, files, readFile, history, saveFile, revertFile, discard, pullRequest, deploy };
