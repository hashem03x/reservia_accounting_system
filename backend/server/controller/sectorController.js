const asyncHandler = require('express-async-handler');
const apiResponse = require('../utils/apiResponse');
const sectorService = require('../services/project/sectorService');

// Project Sectors (Admin -> Sectors). All rules live in services/project/sectorService.js.

// GET /sectors?active=true&keyword=... - `active=true` returns only selectable sectors (the
// Project form); without it, every sector (the admin page).
exports.getSectors = asyncHandler(async (req, res) => {
  const sectors = await sectorService.listSectors({ activeOnly: req.query.active === 'true', keyword: req.query.keyword });
  res.status(200).json({ results: sectors.length, data: sectors });
});

exports.getSector = asyncHandler(async (req, res) => {
  const sector = await sectorService.getSector(req.params.id);
  res.status(200).json({ data: sector });
});

exports.createSector = asyncHandler(async (req, res) => {
  const sector = await sectorService.createSector({ name: req.body.name, isActive: req.body.isActive });
  res.status(201).json(apiResponse('Sector created successfully', true, sector));
});

exports.updateSector = asyncHandler(async (req, res) => {
  const sector = await sectorService.updateSector(req.params.id, { name: req.body.name, isActive: req.body.isActive });
  res.status(200).json(apiResponse('Sector updated successfully', true, sector));
});

exports.deleteSector = asyncHandler(async (req, res) => {
  await sectorService.deleteSector(req.params.id);
  res.status(200).json(apiResponse('Sector deleted successfully', true, null));
});
