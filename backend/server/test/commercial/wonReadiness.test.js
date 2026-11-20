const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Won to ERP Handover, Changes Required (19 Nov 2026), W1-W3 / CRM Pending Fixes item 12. Reads
// only (findOne/find) - no transaction, runs for real against a throwaway local database.

const DB_URI = 'mongodb://127.0.0.1:27017/won_readiness_test';

let CommercialProject, CommercialRevision, CommercialProposal, User, wonReadiness;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  CommercialProject = require('../../models/commercial/commercialProjectModel');
  CommercialRevision = require('../../models/commercial/commercialRevisionModel');
  CommercialProposal = require('../../models/commercial/commercialProposalModel');
  ({ wonReadiness } = require('../../services/crm/commercialHandoffService'));
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([CommercialProject.deleteMany({}), CommercialRevision.deleteMany({}), CommercialProposal.deleteMany({}), User.deleteMany({})]);
});

const PRICED_LINES = [
  { lineNo: 1, component: 'PV Modules', unit: 'pcs', total: 100000 },
  { lineNo: 2, component: 'Installation', unit: 'kWp', total: 5000 },
  { lineNo: 3, component: 'Transportation', unit: 'lot', total: 2000 },
];

async function makeProjectWithRevision(revisionOverrides = {}) {
  const customer = await User.create({ name: 'Test Customer', email: `c${Date.now()}@test.local`, password: 'x', role: 'user', type: 'online' });
  const project = await CommercialProject.create({ projectCode: `ONG-WT${Date.now()}`, name: 'Won Readiness Test', customer: customer._id, country: 'Egypt', category: 'On-Grid C&I' });
  const revision = await CommercialRevision.create({
    project: project._id, revisionNumber: 1, isCurrent: true, boqLines: PRICED_LINES, releaseStatus: 'NOT RELEASED', ...revisionOverrides,
  });
  project.currentRevision = revision._id;
  await project.save();
  return { project, revision };
}

test('W1: no issued proposal at all -> blocked, naming the real reason', async () => {
  const { project } = await makeProjectWithRevision({ releaseStatus: 'APPROVED FOR ISSUE' });
  const blocker = await wonReadiness(project);
  assert.match(blocker, /no proposal has been issued/);
});

test('W2: an issued proposal exists, but the revision itself is NOT RELEASED (approvals pending) -> blocked', async () => {
  const { project, revision } = await makeProjectWithRevision({ releaseStatus: 'NOT RELEASED' });
  await CommercialProposal.create({ revision: revision._id, project: project._id, version: 1, proposalNumber: 'DEAL-2026-999-P01', issuedAt: new Date(), validUntil: new Date(Date.now() + 30 * 86400000), boqLinesSnapshot: [], pricingSnapshot: {}, issuedBy: new mongoose.Types.ObjectId() });
  const blocker = await wonReadiness(project);
  assert.match(blocker, /NOT RELEASED/);
});

test('W2: the issued proposal belongs to an OLDER, superseded revision, not the current one -> blocked', async () => {
  const { project } = await makeProjectWithRevision({ releaseStatus: 'APPROVED FOR ISSUE' });
  // A proposal issued against some other (e.g. earlier) revision id - never the current one.
  await CommercialProposal.create({ revision: new mongoose.Types.ObjectId(), project: project._id, version: 1, proposalNumber: 'DEAL-2026-999-P01', issuedAt: new Date(), validUntil: new Date(Date.now() + 30 * 86400000), boqLinesSnapshot: [], pricingSnapshot: {}, issuedBy: new mongoose.Types.ObjectId() });
  const blocker = await wonReadiness(project);
  assert.match(blocker, /earlier revision/);
});

test('W3: an unpriced BOQ line blocks Won even with a valid issued proposal and RELEASED revision', async () => {
  const { project, revision } = await makeProjectWithRevision({
    releaseStatus: 'APPROVED FOR ISSUE',
    boqLines: [{ lineNo: 1, component: 'PV Modules', unit: 'pcs', total: null }, { lineNo: 2, component: 'Installation', unit: 'kWp', total: 5000 }, { lineNo: 3, component: 'Transportation', unit: 'lot', total: 2000 }],
  });
  await CommercialProposal.create({ revision: revision._id, project: project._id, version: 1, proposalNumber: 'DEAL-2026-999-P01', issuedAt: new Date(), validUntil: new Date(Date.now() + 30 * 86400000), boqLinesSnapshot: [], pricingSnapshot: {}, issuedBy: new mongoose.Types.ObjectId() });
  const blocker = await wonReadiness(project);
  assert.match(blocker, /PV Modules.*no price/);
});

test('W3: a missing Installation line blocks Won', async () => {
  const { project, revision } = await makeProjectWithRevision({
    releaseStatus: 'APPROVED FOR ISSUE',
    boqLines: [{ lineNo: 1, component: 'PV Modules', unit: 'pcs', total: 100000 }, { lineNo: 2, component: 'Transportation', unit: 'lot', total: 2000 }],
  });
  await CommercialProposal.create({ revision: revision._id, project: project._id, version: 1, proposalNumber: 'DEAL-2026-999-P01', issuedAt: new Date(), validUntil: new Date(Date.now() + 30 * 86400000), boqLinesSnapshot: [], pricingSnapshot: {}, issuedBy: new mongoose.Types.ObjectId() });
  const blocker = await wonReadiness(project);
  assert.match(blocker, /no Installation line/);
});

test('W3: a missing Transportation line blocks Won', async () => {
  const { project, revision } = await makeProjectWithRevision({
    releaseStatus: 'APPROVED FOR ISSUE',
    boqLines: [{ lineNo: 1, component: 'PV Modules', unit: 'pcs', total: 100000 }, { lineNo: 2, component: 'Installation', unit: 'kWp', total: 5000 }],
  });
  await CommercialProposal.create({ revision: revision._id, project: project._id, version: 1, proposalNumber: 'DEAL-2026-999-P01', issuedAt: new Date(), validUntil: new Date(Date.now() + 30 * 86400000), boqLinesSnapshot: [], pricingSnapshot: {}, issuedBy: new mongoose.Types.ObjectId() });
  const blocker = await wonReadiness(project);
  assert.match(blocker, /no Transportation line/);
});

test('a fully ready deal (issued proposal on the current, RELEASED revision, fully priced BOQ with install+transport) is NOT blocked', async () => {
  const { project, revision } = await makeProjectWithRevision({ releaseStatus: 'APPROVED FOR ISSUE' });
  await CommercialProposal.create({ revision: revision._id, project: project._id, version: 1, proposalNumber: 'DEAL-2026-999-P01', issuedAt: new Date(), validUntil: new Date(Date.now() + 30 * 86400000), boqLinesSnapshot: [], pricingSnapshot: {}, issuedBy: new mongoose.Types.ObjectId() });
  const blocker = await wonReadiness(project);
  assert.equal(blocker, null);
});

test('reproduces the exact RSV-1011-0009/DEAL-2026-005 complaint: "allowed to go Won with no approvals signed, no proposal issued and three BOQ lines unpriced" - all three must now block it', async () => {
  const { project } = await makeProjectWithRevision({
    releaseStatus: 'NOT RELEASED',
    boqLines: [
      { lineNo: 1, component: 'Submersible pump', unit: 'pcs', total: 97755 },
      { lineNo: 2, component: 'DC cable', unit: 'm', total: null }, // unpriced, per the document
      { lineNo: 3, component: 'Rising main pipe', unit: 'm', total: null },
      { lineNo: 4, component: 'Pump VFD', unit: 'pcs', total: null },
      // No Installation or Transportation line at all, per the document ("no installation or transport lines").
    ],
  });
  // No proposal created at all - per the document.
  const blocker = await wonReadiness(project);
  assert.ok(blocker, 'must be blocked - the document is explicit that this deal should NOT have been allowed to go Won');
  assert.match(blocker, /no proposal has been issued/, 'the FIRST, most fundamental problem is reported');
});
