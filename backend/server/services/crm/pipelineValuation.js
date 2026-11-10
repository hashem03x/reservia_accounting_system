'use strict';

const { STAGE_WEIGHTS } = require('../../utils/crm/constants');
const { OPEN_STAGES, STAGES } = require('../../utils/crm/stageRules');

// Reservia CRM - pipeline valuation (Change Request 2, item 4: "Pipeline value shows 495,000 EGP
// for one 900,000 EGP lead at Proposal sent (55%). The label does not say it is weighted. Show
// both figures"). The ONE calculation behind the Dashboard's Pipeline block and the Pipeline
// board's summary, so the two can never disagree:
//
//   Pipeline value          = sum of valueEgp over OPEN (not won/lost/archived) leads
//   Weighted pipeline value = sum over open leads of valueEgp x probability(stage)
//
// Probabilities come only from utils/crm/constants.js#STAGE_WEIGHTS. A stage with no configured
// probability is NEVER silently weighted at 0 - it is reported in `unconfiguredStages` and its
// weighted value is null, so a missing configuration is visible instead of hidden in a total.

/** Every open stage's configured probability (0-1), or null when not configured. */
function stageProbabilities() {
  return OPEN_STAGES.map(stage => ({
    stage,
    probability: typeof STAGE_WEIGHTS[stage] === 'number' ? STAGE_WEIGHTS[stage] : null,
  }));
}

/** Open stages with no configured probability (should be empty - see the header comment). */
function unconfiguredStages() {
  return stageProbabilities()
    .filter(s => s.probability == null)
    .map(s => s.stage);
}

/**
 * @param {Array<{_id: string, count: number, valueEgp: number}>} rows - a `$group` by stage over
 *   NON-archived leads (each caller applies its own owner filter first)
 * @param {object} [opts]
 * @param {boolean} [opts.includeClosedStages] - also list won/lost rows (Pipeline board), which
 *   never contribute to either open-pipeline total
 */
function valuePipeline(rows, { includeClosedStages = false } = {}) {
  const byStage = Object.fromEntries(rows.map(r => [r._id, { count: r.count || 0, valueEgp: r.valueEgp || 0 }]));
  const stageList = includeClosedStages ? STAGES : OPEN_STAGES;
  const stages = stageList.map(stage => {
    const isOpen = OPEN_STAGES.includes(stage);
    const probability = isOpen && typeof STAGE_WEIGHTS[stage] === 'number' ? STAGE_WEIGHTS[stage] : null;
    const valueEgp = byStage[stage]?.valueEgp || 0;
    let weightedValueEgp;
    if (!isOpen) weightedValueEgp = 0; // won/lost are not a forecast
    else weightedValueEgp = probability == null ? null : Math.round(valueEgp * probability);
    return { stage, count: byStage[stage]?.count || 0, valueEgp, probability, weightedValueEgp, open: isOpen };
  });
  const open = stages.filter(s => s.open);
  return {
    stages,
    openLeadCount: open.reduce((sum, s) => sum + s.count, 0),
    totalValueEgp: open.reduce((sum, s) => sum + s.valueEgp, 0),
    totalWeightedValueEgp: open.reduce((sum, s) => sum + (s.weightedValueEgp || 0), 0),
    unconfiguredStages: open.filter(s => s.probability == null).map(s => s.stage),
  };
}

module.exports = { stageProbabilities, unconfiguredStages, valuePipeline };
