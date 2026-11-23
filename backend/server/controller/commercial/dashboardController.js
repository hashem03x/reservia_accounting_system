const asyncHandler = require('express-async-handler');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const apiResponse = require('../../utils/apiResponse');
const { widestLevel, canView, PROJECT_TAB_MATRIX } = require('../../utils/commercial/dealEnginePermissions');

// Reservia Commercial dashboard - every KPI here is computed from persisted CommercialProject/
// CommercialRevision documents at request time; nothing is hardcoded or sampled (the project's
// own explicit rule against fabricated dashboard statistics).
exports.getDashboard = asyncHandler(async (req, res) => {
  const [totalProjects, draftProjects, byCategory, pendingEngineering, pendingCommercial, approved, recentProjects] = await Promise.all([
    CommercialProject.countDocuments({ archived: false }),
    CommercialProject.countDocuments({ archived: false, currentRevision: null }),
    CommercialProject.aggregate([{ $match: { archived: false } }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
    CommercialProject.countDocuments({ archived: false, engineeringApprovalRollup: 'PENDING' }),
    CommercialProject.countDocuments({ archived: false, commercialApprovalRollup: 'PENDING' }),
    CommercialProject.countDocuments({ archived: false, engineeringApprovalRollup: 'APPROVED', commercialApprovalRollup: 'APPROVED' }),
    CommercialProject.find({ archived: false }).sort({ createdAt: -1 }).limit(10).select('projectCode name category createdAt updatedAt'),
  ]);

  const currentRevisions = await CommercialRevision.find({ isCurrent: true }).select('project pricing boqTotal');
  const totals = currentRevisions.reduce(
    (acc, r) => {
      acc.estimatedProjectValue += r.pricing?.grossInclVat || 0;
      acc.estimatedMaterialCost += r.boqTotal || 0;
      acc.expectedGrossProfit += r.pricing?.grossProfit || 0;
      if (r.pricing?.grossProfitPct != null) { acc.marginSum += r.pricing.grossProfitPct; acc.marginCount += 1; }
      return acc;
    },
    { estimatedProjectValue: 0, estimatedMaterialCost: 0, expectedGrossProfit: 0, marginSum: 0, marginCount: 0 }
  );

  const data = {
    totalProjects,
    draftProjects, // no revision yet, i.e. engineering inputs not entered
    pendingEngineeringApproval: pendingEngineering,
    pendingCommercialApproval: pendingCommercial,
    approvedProjects: approved,
    totalEstimatedProjectValue: totals.estimatedProjectValue,
    totalEstimatedMaterialCost: totals.estimatedMaterialCost,
    expectedGrossProfit: totals.expectedGrossProfit,
    averageMarginPct: totals.marginCount ? totals.marginSum / totals.marginCount : null,
    projectsByCategory: byCategory.map(c => ({ category: c._id, count: c.count })),
    recentProjects,
  };

  // Go-live Developer Pack section 5.4: Technical Engineer "must never... see gross profit" -
  // this endpoint had no redaction at all, leaking net value/GP/margin to every Commercial-access
  // role (technical, procurement, member). Same gate as the Overview tab's price section.
  if (!canView(widestLevel(PROJECT_TAB_MATRIX.overviewPricing, req.commercialRoles))) {
    delete data.totalEstimatedProjectValue;
    delete data.expectedGrossProfit;
    delete data.averageMarginPct;
  }

  res.status(200).json(apiResponse('Dashboard retrieved successfully', true, data));
});
