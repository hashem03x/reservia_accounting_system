const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const groupService = require('../../services/accounting/accountParentGroupService');

// Parent Account Groups (Accounting -> Parent Account Groups). All rules live in
// services/accounting/accountParentGroupService.js.

// GET /account-parent-groups?keyword=&status=active|inactive|all&type=&sort=sortOrder|-nameEn|...&page=&limit=
exports.getAccountParentGroups = asyncHandler(async (req, res) => {
  const { keyword, status, type, sort, page, limit } = req.query;
  res.status(200).json(await groupService.listGroups({ keyword, status, type, sort, page, limit }));
});

// GET /account-parent-groups/selectable?type= - active groups for the Chart of Accounts form.
exports.getSelectableAccountParentGroups = asyncHandler(async (req, res) => {
  const groups = await groupService.getSelectableGroups({ type: req.query.type });
  res.status(200).json(apiResponse('Selectable parent groups retrieved successfully', true, groups));
});

exports.getAccountParentGroup = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Parent group retrieved successfully', true, await groupService.getGroup(req.params.id)));
});

const pickInput = body => ({
  nameEn: body.nameEn,
  nameAr: body.nameAr,
  type: body.type,
  description: body.description,
  sortOrder: body.sortOrder,
  isActive: body.isActive,
});

exports.createAccountParentGroup = asyncHandler(async (req, res) => {
  const group = await groupService.createGroup(pickInput(req.body), req.user?._id);
  res.status(201).json(apiResponse('Parent group created successfully', true, group));
});

exports.updateAccountParentGroup = asyncHandler(async (req, res) => {
  const group = await groupService.updateGroup(req.params.id, pickInput(req.body), req.user?._id);
  res.status(200).json(apiResponse('Parent group updated successfully', true, group));
});

exports.setAccountParentGroupStatus = asyncHandler(async (req, res) => {
  const group = await groupService.setGroupStatus(req.params.id, req.body.isActive, req.user?._id);
  res.status(200).json(apiResponse(group.isActive ? 'Parent group activated successfully' : 'Parent group deactivated successfully', true, group));
});

exports.deleteAccountParentGroup = asyncHandler(async (req, res) => {
  await groupService.deleteGroup(req.params.id, req.user?._id);
  res.status(200).json(apiResponse('Parent group deleted successfully', true, null));
});
