// Run as part of: npm run test:unit (Node's built-in test runner; Node strips the types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLeadOverdue,
  ownerInitials,
  timeAgo,
  stageExtraFieldRequirements,
  isTerminalStage,
  isObviouslyInvalidDropTarget,
  allowedNextStages,
  overrideOnlyStages,
} from "./lead-display.ts";

test("isLeadOverdue: true only when replyDueAt has passed AND there has been no first reply yet", () => {
  assert.equal(isLeadOverdue({ replyDueAt: new Date(Date.now() - 1000).toISOString(), firstReplyAt: null }), true);
  assert.equal(isLeadOverdue({ replyDueAt: new Date(Date.now() - 1000).toISOString(), firstReplyAt: new Date().toISOString() }), false);
  assert.equal(isLeadOverdue({ replyDueAt: new Date(Date.now() + 1000 * 60).toISOString(), firstReplyAt: null }), false);
});

test("ownerInitials: two names -> first+last initial; one name -> its first two letters; none -> a dash, never blank", () => {
  assert.equal(ownerInitials("Ahmed Samir"), "AS");
  assert.equal(ownerInitials("Ahmed"), "AH");
  assert.equal(ownerInitials("  "), "-");
  assert.equal(ownerInitials(null), "-");
  assert.equal(ownerInitials(undefined), "-");
});

test("timeAgo: coarse buckets in English, never throws on edge durations", () => {
  assert.equal(timeAgo(new Date(Date.now() - 5000), "en-US"), "just now");
  assert.equal(timeAgo(new Date(Date.now() - 5 * 60 * 1000), "en-US"), "5m ago");
  assert.equal(timeAgo(new Date(Date.now() - 3 * 60 * 60 * 1000), "en-US"), "3h ago");
  assert.equal(timeAgo(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), "en-US"), "2d ago");
});

test("timeAgo: Arabic strings when the language is Arabic", () => {
  assert.equal(timeAgo(new Date(Date.now() - 5000), "ar-EG"), "الآن");
  assert.match(timeAgo(new Date(Date.now() - 3 * 60 * 60 * 1000), "ar-EG"), /س/);
});

test("stageExtraFieldRequirements: mirrors StageChangeCard's own conditions exactly", () => {
  assert.deepEqual(stageExtraFieldRequirements("lost"), { needsLostReason: true, needsValue: false, needsFollowUp: false });
  assert.deepEqual(stageExtraFieldRequirements("won"), { needsLostReason: false, needsValue: true, needsFollowUp: false });
  assert.deepEqual(stageExtraFieldRequirements("new"), { needsLostReason: false, needsValue: false, needsFollowUp: false });
  assert.deepEqual(stageExtraFieldRequirements("contacted"), { needsLostReason: false, needsValue: false, needsFollowUp: false });
  assert.deepEqual(stageExtraFieldRequirements("qualified"), { needsLostReason: false, needsValue: false, needsFollowUp: true });
  assert.deepEqual(stageExtraFieldRequirements("site_survey"), { needsLostReason: false, needsValue: false, needsFollowUp: true });
  assert.deepEqual(stageExtraFieldRequirements("proposal_sent"), { needsLostReason: false, needsValue: false, needsFollowUp: true });
  assert.deepEqual(stageExtraFieldRequirements("negotiation"), { needsLostReason: false, needsValue: false, needsFollowUp: true });
});

test("isTerminalStage: only 'won' is terminal (a card can still be dragged OUT of 'lost', e.g. reopening)", () => {
  assert.equal(isTerminalStage("won"), true);
  assert.equal(isTerminalStage("lost"), false);
  assert.equal(isTerminalStage("new"), false);
});

test("isObviouslyInvalidDropTarget: same stage, out of Won, or Lost to anywhere but Contacted", () => {
  assert.equal(isObviouslyInvalidDropTarget("new", "new"), true);
  assert.equal(isObviouslyInvalidDropTarget("won", "negotiation"), true);
  assert.equal(isObviouslyInvalidDropTarget("lost", "qualified"), true);
  assert.equal(isObviouslyInvalidDropTarget("lost", "contacted"), false);
  assert.equal(isObviouslyInvalidDropTarget("new", "contacted"), false);
  assert.equal(isObviouslyInvalidDropTarget("negotiation", "new"), false);
});

// Acceptance report finding 3: "Only allowed next stages are displayed. Won is unavailable unless
// the lead has reached Proposal Sent. Lost is displayed only when permitted. Moving backward
// follows the existing back-one-stage-at-a-time rule." - mirrors
// backend/server/utils/crm/stageRules.js#validateStageTransition exactly.
test("allowedNextStages: Won is a dead end - no next stages at all", () => {
  assert.deepEqual(allowedNextStages("won", "sales"), []);
  assert.deepEqual(allowedNextStages("won", "md"), []);
});

test("allowedNextStages: Won only appears once the lead has reached Proposal Sent or Negotiation", () => {
  assert.ok(!allowedNextStages("new", "sales").includes("won"));
  assert.ok(!allowedNextStages("qualified", "sales").includes("won"));
  assert.ok(!allowedNextStages("site_survey", "sales").includes("won"));
  assert.ok(allowedNextStages("proposal_sent", "sales").includes("won"));
  assert.ok(allowedNextStages("negotiation", "sales").includes("won"));
});

test("allowedNextStages: Lost can be reopened to Contacted only, and only by admin/md", () => {
  assert.deepEqual(allowedNextStages("lost", "sales"), []);
  assert.deepEqual(allowedNextStages("lost", "technical"), []);
  assert.deepEqual(allowedNextStages("lost", "admin"), ["contacted"]);
  assert.deepEqual(allowedNextStages("lost", "md"), ["contacted"]);
});

test("allowedNextStages: moving backward is capped at one stage; Change Request 2 - forward is capped at one stage too", () => {
  const fromNegotiation = allowedNextStages("negotiation", "md");
  assert.ok(fromNegotiation.includes("proposal_sent"), "one stage back is fine");
  assert.ok(!fromNegotiation.includes("site_survey"), "two stages back is not");
  assert.ok(!fromNegotiation.includes("qualified"), "three stages back is not");
  assert.ok(!fromNegotiation.includes("new"), "four stages back is not");
  // Change Request 2, item 1: no more skipping (the old "New can reach Negotiation directly").
  assert.ok(!allowedNextStages("new", "md").includes("negotiation"));
  assert.ok(!allowedNextStages("contacted", "sales").includes("site_survey"), "Contacted -> Site survey skips Qualified");
  assert.ok(allowedNextStages("contacted", "sales").includes("qualified"));
});

test("overrideOnlyStages: only the MD is offered override targets, and they are exactly the blocked path moves", () => {
  assert.deepEqual(overrideOnlyStages("contacted", "sales"), []);
  assert.deepEqual(overrideOnlyStages("contacted", "admin"), []);
  assert.deepEqual(overrideOnlyStages("contacted", "md"), ["site_survey", "proposal_sent", "negotiation", "won"]);
  assert.deepEqual(overrideOnlyStages("won", "md"), [], "a won deal stays won");
  assert.ok(!overrideOnlyStages("qualified", "md").includes("lost"), "Lost is always a normal move");
});

test("allowedNextStages: Lost is always offered as a destination from any open stage", () => {
  for (const stage of ["new", "contacted", "qualified", "site_survey", "proposal_sent", "negotiation"]) {
    assert.ok(allowedNextStages(stage, "sales").includes("lost"), `${stage} -> lost should be offered`);
  }
});

test("allowedNextStages: technical can only move a lead to Site survey or Proposal sent - and only along the path", () => {
  assert.deepEqual(allowedNextStages("new", "technical"), []);
  assert.deepEqual(allowedNextStages("qualified", "technical"), ["site_survey"]);
  assert.deepEqual(allowedNextStages("site_survey", "technical"), ["proposal_sent"]);
  assert.deepEqual(allowedNextStages("negotiation", "technical"), ["proposal_sent"]);
});

test("allowedNextStages: from New a sales/md/admin user sees the next stage and Lost only (Change Request 2)", () => {
  assert.deepEqual(allowedNextStages("new", "sales"), ["contacted", "lost"]);
});
