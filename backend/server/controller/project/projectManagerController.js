const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const projectManagerService = require('../../services/project/projectManagerService');

// Project Managers (Admin -> Project Managers). All rules live in services/project/projectManagerService.js.

// GET /project-managers?active=true&keyword=... - `active=true` returns only selectable project
// managers (the Project forms); without it, every one (the admin page).
exports.getProjectManagers = asyncHandler(async (req, res) => {
  const managers = await projectManagerService.listProjectManagers({ activeOnly: req.query.active === 'true', keyword: req.query.keyword });
  res.status(200).json({ results: managers.length, data: managers });
});

exports.getProjectManager = asyncHandler(async (req, res) => {
  res.status(200).json({ data: await projectManagerService.getProjectManager(req.params.id) });
});

exports.createProjectManager = asyncHandler(async (req, res) => {
  const { name, email, phone, isActive } = req.body;
  const manager = await projectManagerService.createProjectManager({ name, email, phone, isActive });
  res.status(201).json(apiResponse('Project manager created successfully', true, manager));
});

exports.updateProjectManager = asyncHandler(async (req, res) => {
  const { name, email, phone, isActive } = req.body;
  const manager = await projectManagerService.updateProjectManager(req.params.id, { name, email, phone, isActive });
  res.status(200).json(apiResponse('Project manager updated successfully', true, manager));
});

exports.deleteProjectManager = asyncHandler(async (req, res) => {
  await projectManagerService.deleteProjectManager(req.params.id);
  res.status(200).json(apiResponse('Project manager deleted successfully', true, null));
});

// GET /project-managers/legacy - project managers projects still reference as staff users (before
// this list existed). POST /project-managers/legacy/import - adds them to the list (projects unchanged).
exports.getLegacyProjectManagers = asyncHandler(async (req, res) => {
  const legacy = await projectManagerService.legacyProjectManagers();
  res.status(200).json({ results: legacy.length, data: legacy });
});

exports.importLegacyProjectManagers = asyncHandler(async (req, res) => {
  const result = await projectManagerService.importLegacyProjectManagers();
  res.status(200).json(apiResponse(`${result.imported.length} project manager(s) imported`, true, result));
});
