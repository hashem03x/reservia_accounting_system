const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const teamService = require('../../services/crm/teamService');

exports.listTeam = asyncHandler(async (req, res) => {
  const team = await teamService.listCrmTeam();
  res.status(200).json(apiResponse('CRM team retrieved successfully', true, team));
});
