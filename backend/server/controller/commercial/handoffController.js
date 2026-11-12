const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const CommercialSyncEvent = require('../../models/commercial/commercialSyncEventModel');
const Lead = require('../../models/crm/leadModel');
const Project = require('../../models/project/projectModel');

// Commercial side of the CRM handoff (QA finding B5).

/** GET /commercial/handoff/:projectId/sync-events - the CRM sync history of one deal. */
exports.getProjectSyncEvents = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.projectId)) return next(new ApiError('Invalid project id.', 400));
  const events = await CommercialSyncEvent.find({ project: req.params.projectId }).sort({ createdAt: -1 }).limit(50).populate({ path: 'actor', select: 'name' }).lean();
  res.status(200).json(apiResponse('CRM sync history', true, events));
});

/**
 * PATCH /commercial/projects/:id/erp-project { erpProject: <ERP Project id> | null }
 *
 * Links the REAL ERP project once the ERP has created it (brief 6.2: "record the ERP project id back
 * on the deal"). The ERP project must exist - nothing is created or fabricated here, and nothing is
 * posted to accounting. The linked ERP number is mirrored onto the CRM lead.
 */
exports.linkErpProject = asyncHandler(async (req, res, next) => {
  const project = await CommercialProject.findById(req.params.id);
  if (!project) return next(new ApiError('Deal Engine project not found.', 404));
  const erpId = req.body.erpProject;
  let erp = null;
  if (erpId) {
    if (!mongoose.isValidObjectId(erpId)) return next(new ApiError('Invalid ERP project id.', 400));
    erp = await Project.findById(erpId).select('_id projectNumber name').lean();
    if (!erp) return next(new ApiError('ERP project not found - create it in the ERP first, then link it here.', 404));
    const taken = await CommercialProject.findOne({ erpProject: erp._id, _id: { $ne: project._id } }).select('projectCode').lean();
    if (taken) return next(new ApiError(`That ERP project is already linked to Deal Engine project ${taken.projectCode}.`, 409));
  }
  project.erpProject = erp ? erp._id : null;
  project.erpProjectNumber = erp ? erp.projectNumber || null : null;
  project.editHistory.push({ at: new Date(), by: req.user._id, byName: req.user.name || null, changes: [{ field: 'erpProject', from: null, to: erp ? erp.projectNumber : null }] });
  await project.save();
  if (project.crmLead) await Lead.updateOne({ _id: project.crmLead }, { $set: { 'commercial.erpProjectNumber': project.erpProjectNumber } });
  res.status(200).json(apiResponse(erp ? `Linked ERP project ${erp.projectNumber}.` : 'ERP project link removed.', true, project));
});
