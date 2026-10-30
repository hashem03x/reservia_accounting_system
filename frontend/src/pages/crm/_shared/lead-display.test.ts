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
