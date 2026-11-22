'use strict';

const Project = require('../../models/project/projectModel');

/**
 * B5 - pushes the Deal Engine project's current Project Manager onto its linked ERP Project, if
 * one exists yet (a deal not yet Won has no ERP project to push to - nothing to do). Called after
 * every CommercialProject save where `projectManager` changed, so the ERP project's manager never
 * drifts from the Deal Engine's own record of who owns it. A no-op, not an error, when there is no
 * ERP project yet - wonToErpService.js#createErpProjectForWonDeal reads the Deal Engine's
 * projectManager directly at creation time instead.
 */
async function syncProjectManagerToErp(commercialProject) {
  if (!commercialProject.erpProject) return;
  const projectManager = commercialProject.projectManager?._id || commercialProject.projectManager || null;
  await Project.updateOne({ _id: commercialProject.erpProject }, { $set: { projectManager } });
}

module.exports = { syncProjectManagerToErp };
